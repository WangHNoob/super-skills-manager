use crate::db::Db;
use crate::indexer::parse_skill_md;
use crate::models::*;
use crate::registry_compare;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use walkdir::WalkDir;

const CLI_DICT: &[&str] = &[
    "gh",
    "git",
    "node",
    "npm",
    "npx",
    "pnpm",
    "python",
    "pip",
    "cargo",
    "docker",
    "kubectl",
    "rg",
    "fd",
    "officecli",
    "agently-cli",
];

fn severity_delta(sev: &str) -> i32 {
    match sev {
        "error" => -25,
        "warn" => -10,
        "info" => -3,
        _ => 0,
    }
}

fn grade(score: f64) -> String {
    if score >= 85.0 {
        "A".into()
    } else if score >= 70.0 {
        "B".into()
    } else if score >= 50.0 {
        "C".into()
    } else {
        "D".into()
    }
}

fn issue(
    rule_id: &str,
    severity: &str,
    message: &str,
    fix_hint: Option<&str>,
    auto_fix: bool,
) -> HealthIssue {
    HealthIssue {
        rule_id: rule_id.into(),
        severity: severity.into(),
        message: message.into(),
        fix_hint: fix_hint.map(|s| s.into()),
        auto_fix,
    }
}

fn command_exists(cmd: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        Command::new("where.exe")
            .arg(cmd)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("which")
            .arg(cmd)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

fn read_scripts_text(dir: &Path) -> String {
    let scripts = dir.join("scripts");
    if !scripts.is_dir() {
        return String::new();
    }
    let mut out = String::new();
    for entry in WalkDir::new(&scripts).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            if let Ok(t) = fs::read_to_string(entry.path()) {
                out.push_str(&t);
                out.push('\n');
            }
        }
    }
    out
}

fn script_names(dir: &Path) -> Vec<String> {
    let scripts = dir.join("scripts");
    if !scripts.is_dir() {
        return Vec::new();
    }
    WalkDir::new(&scripts)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            e.path()
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
        })
        .collect()
}

pub fn analyze_skill(skill: &SkillRecord, twins: &[SkillRecord]) -> HealthReport {
    let mut issues = Vec::new();
    let dir = PathBuf::from(&skill.dir_path);
    let entry = PathBuf::from(&skill.entry_path);

    let registry = registry_compare::compare_skill_to_registry(&skill.name, &dir);
    match registry.status.as_str() {
        "diverged" => {
            issues.push(issue(
                "REG001",
                "warn",
                &format!(
                    "与 skills.sh/GitHub 远端不一致（来源: {}）",
                    registry
                        .source
                        .clone()
                        .unwrap_or_else(|| "unknown".into())
                ),
                Some("展开查看 SKILL.md unified diff；可用 Registry 页执行 npx skills update"),
                false,
            ));
        }
        "untracked" => {
            issues.push(issue(
                "REG002",
                "info",
                "未出现在 skills CLI 锁文件中，无法对照 skills.sh 版本",
                Some("若来自公开仓库，可用 npx skills add 重新纳入追踪"),
                false,
            ));
        }
        "fetch_failed" => {
            issues.push(issue(
                "REG003",
                "info",
                &registry.message,
                Some("检查网络或稍后重试"),
                false,
            ));
        }
        "no_lock" => {
            issues.push(issue(
                "REG004",
                "info",
                &registry.message,
                None,
                false,
            ));
        }
        _ => {}
    }

    if !entry.is_file() {
        issues.push(issue(
            "META001",
            "error",
            "缺少 SKILL.md",
            Some("从索引剔除或补全入口文件"),
            false,
        ));
        return finalize(skill, issues, Some(registry));
    }

    let text = fs::read_to_string(&entry).unwrap_or_default();
    let trimmed = text.trim_start();
    let has_fm = trimmed.starts_with("---");
    let (fm, _yaml, body) = parse_skill_md(&text);

    if has_fm {
        // if yaml section existed but name/desc both none and body equals full text oddly — soft check
        let after = trimmed.trim_start_matches("---");
        let after = after.trim_start_matches(['\r', '\n']);
        if !after.contains("\n---") {
            issues.push(issue(
                "META002",
                "error",
                "frontmatter 无法正确闭合（缺少结束 ---）",
                Some("检查 YAML 分隔符"),
                false,
            ));
        }
    }

    let dir_name = dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    match &fm.name {
        None => {
            issues.push(issue(
                "META003",
                "error",
                "SKILL.md 未声明 name（索引用目录名回退）",
                Some("可用目录名写入 frontmatter name"),
                true,
            ));
        }
        Some(n) if n.trim().is_empty() => {
            issues.push(issue(
                "META003",
                "error",
                "name 为空",
                Some("可用目录名预填 name"),
                true,
            ));
        }
        _ => {}
    }

    let desc = if skill.description.trim().is_empty() {
        fm.description.clone().unwrap_or_default()
    } else {
        skill.description.clone()
    };

    if desc.trim().is_empty() {
        issues.push(issue(
            "META004",
            "error",
            "缺少 description",
            Some("补充触发场景描述，勿自动瞎写"),
            false,
        ));
    }

    if let Some(name) = &fm.name {
        if !name.eq_ignore_ascii_case(&dir_name) {
            issues.push(issue(
                "META005",
                "warn",
                &format!("name「{name}」与目录名「{dir_name}」不一致"),
                Some("统一命名，便于跨 runtime 匹配"),
                false,
            ));
        }
    }

    let desc_trim = desc.trim();
    if !desc_trim.is_empty() {
        if desc_trim.chars().count() < 40 {
            issues.push(issue(
                "DESC001",
                "warn",
                "description 过短（<40），Agent 可能难以自动触发",
                Some("写清何时使用、覆盖哪些任务"),
                false,
            ));
        }
        if desc_trim.chars().count() > 500 {
            issues.push(issue(
                "DESC002",
                "warn",
                "description 过长（>500），可能被截断",
                Some("精简为触发条件 + 核心能力"),
                false,
            ));
        }
        let lower = desc_trim.to_lowercase();
        let has_trigger = ["when", "use", "用", "当", "asks", "if "]
            .iter()
            .any(|k| lower.contains(k));
        if !has_trigger {
            issues.push(issue(
                "DESC003",
                "warn",
                "description 缺少触发语境词（when/use/当/用…）",
                Some("例如：Use when the user asks to…"),
                false,
            ));
        }
        let generic = ["helper", "utils", "general", "杂项", "通用工具"];
        let concrete = [
            "react", "test", "review", "deploy", "design", "security", "git", "api", "前端",
            "审计", "邮件",
        ];
        let is_generic = generic.iter().any(|g| lower.contains(g));
        let has_concrete = concrete.iter().any(|c| lower.contains(c));
        if is_generic && !has_concrete {
            issues.push(issue(
                "DESC004",
                "warn",
                "description 偏泛，缺少具体领域词",
                Some("写明领域与任务，避免 helper/utils 空话"),
                false,
            ));
        }
        if !lower.contains("not")
            && !lower.contains("不要")
            && !lower.contains("避免")
            && !lower.contains("don't")
        {
            issues.push(issue(
                "DESC005",
                "info",
                "未说明反例（什么时候不要用）",
                Some("补充不适用场景可提升触发精度"),
                false,
            ));
        }
    }

    if twins.iter().any(|t| t.description.trim() != skill.description.trim()) {
        issues.push(issue(
            "DESC006",
            "info",
            "同名副本 description 不一致",
            Some("在副本面板对比并同步权威版本"),
            false,
        ));
    }

    let body_trim = body.trim();
    if body_trim.chars().count() < 120 {
        issues.push(issue(
            "BODY001",
            "warn",
            "正文过短（<120 字符）",
            Some("补充步骤与示例"),
            false,
        ));
    }
    if !body.lines().any(|l| l.trim_start().starts_with("## ")) {
        issues.push(issue(
            "BODY002",
            "info",
            "正文无二级标题",
            Some("用 ## 划分 Instructions / Examples"),
            false,
        ));
    }
    let has_step_heading = body.to_lowercase().contains("step")
        || body.contains("步骤")
        || body.contains("Instructions");
    let has_list = body.lines().any(|l| {
        let t = l.trim_start();
        t.starts_with('-') || t.starts_with('*') || t.starts_with("1.")
    });
    if has_step_heading && !has_list {
        issues.push(issue(
            "BODY003",
            "warn",
            "有步骤类标题但缺少列表/编号",
            Some("用有序列表写清操作步骤"),
            false,
        ));
    }
    if body.contains("TODO") || body.contains("TBD") || body.contains("FIXME") {
        issues.push(issue(
            "BODY004",
            "info",
            "正文含 TODO/TBD/FIXME",
            Some("清理未完成标记或完成对应章节"),
            false,
        ));
    }

    let names = script_names(&dir);
    if skill.has_scripts || !names.is_empty() {
        let mentioned = names.iter().any(|n| body.contains(n) || text.contains(n));
        if !mentioned {
            issues.push(issue(
                "DEP001",
                "warn",
                "存在 scripts/ 但正文未引用脚本名",
                Some("在 SKILL.md 中写明何时调用哪个脚本"),
                false,
            ));
        }
    }
    // referenced scripts/foo missing
    for cap in extract_script_refs(&body) {
        let p = dir.join(&cap);
        if !p.is_file() {
            issues.push(issue(
                "DEP002",
                "warn",
                &format!("正文引用 {cap} 但文件不存在"),
                Some("补文件或修正路径"),
                false,
            ));
        }
    }

    let combined = format!("{}\n{}", body, desc);
    for cli in CLI_DICT {
        if regex_lite_contains(&combined, cli) && !command_exists(cli) {
            issues.push(issue(
                "DEP004",
                "warn",
                &format!("正文提到 CLI「{cli}」，但本机 PATH 未找到"),
                Some("安装该工具或修正文档依赖说明"),
                false,
            ));
        }
    }

    if combined.to_lowercase().contains("npx skills")
        || combined.contains("skills.sh")
        || combined.contains("npm install")
    {
        issues.push(issue(
            "DEP006",
            "info",
            "提到网络安装（npx skills / skills.sh）",
            Some("离线环境可能无法使用"),
            false,
        ));
    }

    let scripts_text = read_scripts_text(&dir);
    if !scripts_text.is_empty() {
        let st_lower = scripts_text.to_lowercase();
        if st_lower.contains("curl")
            || st_lower.contains("invoke-webrequest")
            || st_lower.contains("wget")
            || st_lower.contains("fetch(")
        {
            issues.push(issue(
                "RISK001",
                "warn",
                "脚本含网络请求关键字",
                Some("确认目标域名可信"),
                false,
            ));
        }
        if st_lower.contains("rm -rf /")
            || st_lower.contains("remove-item -recurse")
            || st_lower.contains("mkfs")
        {
            issues.push(issue(
                "RISK002",
                "error",
                "脚本含危险销毁命令模式",
                Some("审查 scripts/ 后再使用或复制"),
                false,
            ));
        }
        if scripts_text.contains("API_KEY")
            || scripts_text.contains("SECRET")
            || st_lower.contains("password=")
            || st_lower.contains("token=")
        {
            issues.push(issue(
                "RISK003",
                "warn",
                "脚本可能含硬编码凭证关键字",
                Some("改为环境变量注入"),
                false,
            ));
        }
        if st_lower.contains("sudo") || scripts_text.contains("RunAs") {
            issues.push(issue(
                "RISK004",
                "warn",
                "脚本含提权关键字",
                Some("确认是否必要"),
                false,
            ));
        }
        if st_lower.contains("setx ")
            || st_lower.contains("reg add")
            || st_lower.contains("hkcu\\")
        {
            issues.push(issue(
                "RISK005",
                "info",
                "脚本可能修改注册表/环境变量",
                None,
                false,
            ));
        }
        if st_lower.contains("| iex")
            || st_lower.contains("|ie")
            || st_lower.contains("| sh")
            || st_lower.contains("| bash")
        {
            issues.push(issue(
                "RISK006",
                "warn",
                "脚本含远程管道执行模式（iwr|iex / curl|sh）",
                Some("高风险，建议移除或严格审查"),
                false,
            ));
        }
    }

    if skill.origin == "builtin" || skill.origin == "plugin" {
        if skill.access != "readonly" {
            issues.push(issue(
                "SRC001",
                "error",
                "只读源被标记为可写（内部一致性错误）",
                None,
                false,
            ));
        }
    }
    if skill.is_symlink {
        let real = PathBuf::from(&skill.realpath);
        if !real.exists() {
            issues.push(issue(
                "SRC002",
                "warn",
                "符号链接目标不存在（断链）",
                Some("修复链接或重新安装 skill"),
                false,
            ));
        }
    }
    if skill.origin == "plugin" {
        issues.push(issue(
            "SRC003",
            "info",
            "来自插件缓存，插件更新可能覆盖",
            Some("需要时可提取为自有副本"),
            false,
        ));
    }
    if !twins.is_empty() {
        let max_mtime = twins
            .iter()
            .chain(std::iter::once(skill))
            .map(|s| s.entry_mtime_ms)
            .max()
            .unwrap_or(0);
        let hashes: std::collections::HashSet<_> =
            twins.iter().map(|t| t.content_hash.as_str()).collect();
        if hashes.iter().any(|h| *h != skill.content_hash.as_str())
            && skill.entry_mtime_ms < max_mtime
        {
            issues.push(issue(
                "SRC004",
                "warn",
                "副本组内容有差异，且当前不是最新 mtime",
                Some("在副本面板选择权威侧同步"),
                false,
            ));
        }
    }

    finalize(skill, issues, Some(registry))
}

fn finalize(
    skill: &SkillRecord,
    issues: Vec<HealthIssue>,
    registry: Option<RegistrySyncInfo>,
) -> HealthReport {
    let mut score = 100i32;
    for i in &issues {
        score += severity_delta(&i.severity);
    }
    let score = score.max(0) as f64;
    HealthReport {
        skill_id: skill.id.clone(),
        skill_name: skill.name.clone(),
        score,
        grade: grade(score),
        issues,
        content_hash: skill.content_hash.clone(),
        registry,
    }
}

fn extract_script_refs(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    for token in body.split_whitespace() {
        let t = token.trim_matches(|c: char| c == '`' || c == '"' || c == '\'' || c == ',' || c == ')');
        if t.starts_with("scripts/") {
            out.push(t.to_string());
        }
    }
    out.sort();
    out.dedup();
    out
}

fn regex_lite_contains(hay: &str, needle: &str) -> bool {
    let lower = hay.to_lowercase();
    let n = needle.to_lowercase();
    lower
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_')
        .any(|w| w == n)
}

pub fn run_health_for_all(db: &Db) -> Result<usize, String> {
    let skills = db.all_skills()?;
    let mut n = 0;
    for skill in skills {
        let twins = if let Some(gid) = &skill.twin_group_id {
            db.list_twin_groups()?
                .into_iter()
                .find(|g| &g.id == gid)
                .map(|g| {
                    g.skill_ids
                        .into_iter()
                        .filter_map(|id| db.get_skill(&id).ok().flatten())
                        .filter(|s| s.id != skill.id)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        // Always re-analyze: local rules are cheap; remote SKILL.md fetches are cached ~1h.
        let report = analyze_skill(&skill, &twins);
        db.save_health_report(&report)?;
        n += 1;
    }
    Ok(n)
}

pub fn get_report(db: &Db, skill_id: &str) -> Result<Option<HealthReport>, String> {
    db.get_health_report(skill_id)
}

pub fn list_reports(db: &Db) -> Result<Vec<HealthReport>, String> {
    db.list_health_reports()
}

/// Auto-fix META003: write name from directory into frontmatter.
pub fn apply_metafix_name(db: &Db, skill_id: &str) -> Result<SkillRecord, String> {
    let skill = db
        .get_skill(skill_id)?
        .ok_or_else(|| "skill 不存在".to_string())?;
    if skill.access == "readonly" {
        return Err("只读 skill 不能就地修复，请先提取副本".into());
    }
    let dir = PathBuf::from(&skill.dir_path);
    let dir_name = dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or_else(|| "无效目录".to_string())?;
    let entry = PathBuf::from(&skill.entry_path);
    let text = fs::read_to_string(&entry).map_err(|e| e.to_string())?;
    let new_text = if text.trim_start().starts_with("---") {
        let rest = text.trim_start().trim_start_matches("---");
        let rest = rest.trim_start_matches(['\r', '\n']);
        if let Some(end) = rest.find("\n---") {
            let yaml = &rest[..end];
            let body = &rest[end + 4..];
            let mut yaml_out = yaml.to_string();
            if !yaml.lines().any(|l| l.trim_start().starts_with("name:")) {
                yaml_out = format!("name: {dir_name}\n{yaml_out}");
            } else {
                yaml_out = yaml
                    .lines()
                    .map(|l| {
                        if l.trim_start().starts_with("name:") {
                            format!("name: {dir_name}")
                        } else {
                            l.to_string()
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
            }
            format!("---\n{yaml_out}\n---{body}")
        } else {
            format!("---\nname: {dir_name}\ndescription: \"\"\n---\n\n{text}")
        }
    } else {
        format!("---\nname: {dir_name}\ndescription: \"\"\n---\n\n{text}")
    };
    fs::write(&entry, new_text).map_err(|e| e.to_string())?;
    // reindex single skill lightly by updating name fields
    let mut updated = skill.clone();
    updated.name = dir_name;
    db.upsert_skill(&updated)?;
    let report = analyze_skill(&updated, &[]);
    db.save_health_report(&report)?;
    Ok(updated)
}
