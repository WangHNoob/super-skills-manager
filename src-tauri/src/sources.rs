use crate::models::{SourceConfigEntry, SourceConfigFile, SourceInfo};
use glob::glob;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub fn load_source_config() -> SourceConfigFile {
    let candidates = [
        PathBuf::from("config/skill-sources.defaults.json"),
        PathBuf::from("../config/skill-sources.defaults.json"),
        PathBuf::from("../../config/skill-sources.defaults.json"),
    ];
    for p in candidates {
        if p.exists() {
            if let Ok(text) = std::fs::read_to_string(&p) {
                if let Ok(cfg) = serde_json::from_str::<SourceConfigFile>(&text) {
                    return cfg;
                }
            }
        }
    }
    // Embedded fallback for packaged builds
    serde_json::from_str(include_str!("../../config/skill-sources.defaults.json"))
        .expect("embedded source config must parse")
}

pub fn expand_user_path(pattern: &str) -> String {
    let home = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .to_string_lossy()
        .to_string();
    pattern
        .replace("%USERPROFILE%", &home)
        .replace("~", &home)
}

pub fn resolve_roots(
    entry: &SourceConfigEntry,
    project_roots: &[String],
) -> Vec<String> {
    let mut roots = HashSet::new();
    for pattern in &entry.path_patterns {
        if pattern.contains("<project>") {
            for proj in project_roots {
                let expanded = pattern.replace("<project>", proj);
                let expanded = expand_user_path(&expanded);
                push_resolved(&expanded, &mut roots);
            }
        } else {
            let expanded = expand_user_path(pattern);
            push_resolved(&expanded, &mut roots);
        }
    }
    let mut list: Vec<String> = roots.into_iter().collect();
    list.sort();
    list
}

fn push_resolved(pattern: &str, roots: &mut HashSet<String>) {
    if pattern.contains('*') {
        if let Ok(paths) = glob(pattern) {
            for p in paths.flatten() {
                if p.is_dir() {
                    roots.insert(normalize_path(&p));
                }
            }
        }
    } else {
        let p = PathBuf::from(pattern);
        if p.is_dir() {
            roots.insert(normalize_path(&p));
        }
    }
}

pub fn normalize_path(path: &Path) -> String {
    dunce_simplify(path)
}

fn dunce_simplify(path: &Path) -> String {
    match path.canonicalize() {
        Ok(p) => {
            let s = p.to_string_lossy().to_string();
            // Strip Windows \\?\ prefix
            if let Some(stripped) = s.strip_prefix(r"\\?\") {
                stripped.to_string()
            } else {
                s
            }
        }
        Err(_) => path.to_string_lossy().to_string(),
    }
}

pub fn default_enabled_ids(cfg: &SourceConfigFile) -> Vec<String> {
    cfg.sources
        .iter()
        .filter(|s| s.enabled_by_default)
        .map(|s| s.id.clone())
        .collect()
}

pub fn build_source_infos(
    cfg: &SourceConfigFile,
    enabled: &HashSet<String>,
    projects: &[String],
    counts: &std::collections::HashMap<String, usize>,
) -> Vec<SourceInfo> {
    cfg.sources
        .iter()
        .map(|s| {
            let is_enabled = enabled.contains(&s.id);
            let roots = if is_enabled {
                resolve_roots(s, projects)
            } else {
                Vec::new()
            };
            SourceInfo {
                id: s.id.clone(),
                label: s.label.clone(),
                runtime: s.runtime.clone(),
                scope: s.scope.clone(),
                origin: s.origin.clone(),
                access: s.access.clone(),
                enabled: is_enabled,
                path_patterns: s.path_patterns.clone(),
                resolved_roots: roots,
                skill_count: *counts.get(&s.id).unwrap_or(&0),
            }
        })
        .collect()
}

pub fn write_target_for_runtime(
    project: &Path,
    runtime: &str,
    skill_name: &str,
    also_native_cursor: bool,
) -> Vec<PathBuf> {
    let mut targets = Vec::new();
    match runtime {
        "claude" => {
            targets.push(project.join(".claude").join("skills").join(skill_name));
        }
        "agents" | "codex" => {
            targets.push(project.join(".agents").join("skills").join(skill_name));
        }
        "cursor" => {
            targets.push(project.join(".agents").join("skills").join(skill_name));
            if also_native_cursor {
                targets.push(project.join(".cursor").join("skills").join(skill_name));
            }
        }
        _ => {
            targets.push(project.join(".agents").join("skills").join(skill_name));
        }
    }
    targets
}

pub fn extract_default_target(skill_name: &str) -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".agents")
        .join("skills")
        .join(skill_name)
}
