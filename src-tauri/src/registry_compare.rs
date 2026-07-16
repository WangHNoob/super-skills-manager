use crate::hashutil::sha256_hex;
use crate::models::RegistrySyncInfo;
use serde::Deserialize;
use similar::{ChangeTag, TextDiff};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

#[derive(Debug, Clone, Deserialize)]
struct SkillLockFile {
    #[serde(default)]
    skills: HashMap<String, SkillLockEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillLockEntry {
    source: Option<String>,
    source_type: Option<String>,
    source_url: Option<String>,
    skill_path: Option<String>,
    skill_folder_hash: Option<String>,
}

static REMOTE_CACHE: Mutex<Option<(u64, HashMap<String, Result<String, String>>)>> =
    Mutex::new(None);

fn lock_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(home) = dirs::home_dir() {
        paths.push(home.join(".agents").join(".skill-lock.json"));
        paths.push(home.join(".agents").join("skills-lock.json"));
        paths.push(home.join(".claude").join(".skill-lock.json"));
    }
    paths
}

fn load_lock() -> Option<SkillLockFile> {
    for p in lock_paths() {
        if p.is_file() {
            if let Ok(text) = fs::read_to_string(&p) {
                if let Ok(lock) = serde_json::from_str::<SkillLockFile>(&text) {
                    return Some(lock);
                }
            }
        }
    }
    None
}

fn find_entry<'a>(
    lock: &'a SkillLockFile,
    skill_name: &str,
) -> Option<(&'a str, &'a SkillLockEntry)> {
    lock.skills
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(skill_name))
        .map(|(k, v)| (k.as_str(), v))
}

fn github_raw_candidates(source: &str, skill_path: &str) -> Vec<String> {
    // source like "vercel-labs/agent-skills"
    let source = source.trim_end_matches(".git");
    let path = skill_path.trim_start_matches('/');
    let mut out = Vec::new();
    for branch in ["main", "master"] {
        out.push(format!(
            "https://raw.githubusercontent.com/{source}/{branch}/{path}"
        ));
    }
    out
}

fn remote_urls_for(entry: &SkillLockEntry) -> Vec<String> {
    let mut urls = Vec::new();
    let source_type = entry.source_type.as_deref().unwrap_or("");
    if let Some(url) = &entry.source_url {
        if url.ends_with("SKILL.md") || url.contains("/SKILL.md") {
            urls.push(url.clone());
        } else if source_type == "well-known" {
            // sometimes sourceUrl is already the skill md
            urls.push(url.clone());
        }
    }
    if let (Some(source), Some(path)) = (&entry.source, &entry.skill_path) {
        if source_type == "github" || source.contains('/') {
            urls.extend(github_raw_candidates(source, path));
        }
    }
    urls
}

fn fetch_url(url: &str) -> Result<String, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(12))
        .user_agent("SSM-SkillManager/0.1")
        .build();
    let resp = agent
        .get(url)
        .call()
        .map_err(|e| format!("请求失败: {e}"))?;
    if !(200..300).contains(&resp.status()) {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.into_string()
        .map_err(|e| format!("读取响应失败: {e}"))
}

fn fetch_remote_cached(urls: &[String]) -> Result<(String, String), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let cache_key = urls.join("|");

    {
        let guard = REMOTE_CACHE.lock().unwrap();
        if let Some((ts, map)) = guard.as_ref() {
            if now.saturating_sub(*ts) < 3600 {
                if let Some(cached) = map.get(&cache_key) {
                    return cached
                        .clone()
                        .map(|body| (urls.first().cloned().unwrap_or_default(), body));
                }
            }
        }
    }

    let mut last_err = "无可用远端 URL".to_string();
    let mut used_url = String::new();
    let mut body = None;
    for url in urls {
        match fetch_url(url) {
            Ok(text) => {
                used_url = url.clone();
                body = Some(text);
                break;
            }
            Err(e) => last_err = format!("{url}: {e}"),
        }
    }

    let result = match body {
        Some(b) => Ok(b),
        None => Err(last_err),
    };

    {
        let mut guard = REMOTE_CACHE.lock().unwrap();
        let map = match guard.as_mut() {
            Some((ts, m)) if now.saturating_sub(*ts) < 3600 => m,
            _ => {
                *guard = Some((now, HashMap::new()));
                &mut guard.as_mut().unwrap().1
            }
        };
        map.insert(cache_key, result.clone());
    }

    result.map(|b| (used_url, b))
}

pub fn unified_diff(old: &str, new: &str, old_label: &str, new_label: &str) -> String {
    let diff = TextDiff::from_lines(old, new);
    let mut out = String::new();
    out.push_str(&format!("--- {old_label}\n+++ {new_label}\n"));
    for change in diff.iter_all_changes() {
        let sign = match change.tag() {
            ChangeTag::Delete => "-",
            ChangeTag::Insert => "+",
            ChangeTag::Equal => " ",
        };
        let text = change.to_string();
        // change.to_string() already includes newline usually
        if text.ends_with('\n') {
            out.push_str(sign);
            out.push_str(&text);
        } else {
            out.push_str(sign);
            out.push_str(&text);
            out.push('\n');
        }
    }
    out
}

pub fn compare_skill_to_registry(skill_name: &str, local_dir: &Path) -> RegistrySyncInfo {
    let local_entry = local_dir.join("SKILL.md");
    let local_text = fs::read_to_string(&local_entry).unwrap_or_default();
    let local_hash = sha256_hex(local_text.as_bytes());

    let Some(lock) = load_lock() else {
        return RegistrySyncInfo {
            status: "no_lock".into(),
            source: None,
            source_url: None,
            lock_folder_hash: None,
            local_skill_md_hash: local_hash,
            remote_skill_md_hash: None,
            remote_fetched_url: None,
            diff: None,
            message: "未找到 ~/.agents/.skill-lock.json，无法对照 skills.sh 安装记录".into(),
        };
    };

    let Some((_key, entry)) = find_entry(&lock, skill_name) else {
        return RegistrySyncInfo {
            status: "untracked".into(),
            source: None,
            source_url: None,
            lock_folder_hash: None,
            local_skill_md_hash: local_hash,
            remote_skill_md_hash: None,
            remote_fetched_url: None,
            diff: None,
            message: "该 skill 不在 skills CLI 锁文件中（可能是手写/复制，未通过 npx skills 安装）"
                .into(),
        };
    };

    let source = entry.source.clone();
    let lock_hash = entry.skill_folder_hash.clone().filter(|s| !s.is_empty());
    let urls = remote_urls_for(entry);
    if urls.is_empty() {
        return RegistrySyncInfo {
            status: "unsupported".into(),
            source,
            source_url: entry.source_url.clone(),
            lock_folder_hash: lock_hash,
            local_skill_md_hash: local_hash,
            remote_skill_md_hash: None,
            remote_fetched_url: None,
            diff: None,
            message: "锁文件有记录，但无法构造远端 URL（local/git/well-known 等）".into(),
        };
    }

    match fetch_remote_cached(&urls) {
        Ok((used_url, remote_text)) => {
            let remote_hash = sha256_hex(remote_text.as_bytes());
            let same = normalize_text(&local_text) == normalize_text(&remote_text);
            if same {
                RegistrySyncInfo {
                    status: "matched".into(),
                    source,
                    source_url: entry.source_url.clone(),
                    lock_folder_hash: lock_hash,
                    local_skill_md_hash: local_hash,
                    remote_skill_md_hash: Some(remote_hash),
                    remote_fetched_url: Some(used_url),
                    diff: None,
                    message: "本地 SKILL.md 与 skills.sh/GitHub 远端一致".into(),
                }
            } else {
                let diff = unified_diff(
                    &local_text,
                    &remote_text,
                    "local/SKILL.md",
                    "remote/SKILL.md",
                );
                RegistrySyncInfo {
                    status: "diverged".into(),
                    source,
                    source_url: entry.source_url.clone(),
                    lock_folder_hash: lock_hash,
                    local_skill_md_hash: local_hash,
                    remote_skill_md_hash: Some(remote_hash),
                    remote_fetched_url: Some(used_url),
                    diff: Some(diff),
                    message: "本地 SKILL.md 与远端不一致（见 diff：- 本地 / + 远端）".into(),
                }
            }
        }
        Err(err) => RegistrySyncInfo {
            status: "fetch_failed".into(),
            source,
            source_url: entry.source_url.clone(),
            lock_folder_hash: lock_hash,
            local_skill_md_hash: local_hash,
            remote_skill_md_hash: None,
            remote_fetched_url: None,
            diff: None,
            message: format!("无法拉取远端 SKILL.md：{err}"),
        },
    }
}

fn normalize_text(s: &str) -> String {
    s.replace("\r\n", "\n").trim().to_string()
}
