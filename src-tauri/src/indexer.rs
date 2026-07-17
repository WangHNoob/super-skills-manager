use crate::db::Db;
use crate::hashutil::{content_hash, path_id};
use crate::models::*;
use crate::models::SourceConfigFile;
use crate::sources::resolve_roots;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn parse_skill_md(text: &str) -> (SkillFrontmatter, String, String) {
    let trimmed = text.trim_start();
    if !trimmed.starts_with("---") {
        return (
            SkillFrontmatter {
                name: None,
                description: None,
                disable_model_invocation: None,
            },
            String::new(),
            text.to_string(),
        );
    }
    let rest = &trimmed[3..];
    let rest = rest.trim_start_matches('\r').trim_start_matches('\n');
    if let Some(end) = rest.find("\n---") {
        let yaml = &rest[..end];
        let body = rest[end + 4..].trim_start_matches('\r').trim_start_matches('\n');
        let fm: SkillFrontmatter = serde_yaml::from_str(yaml).unwrap_or(SkillFrontmatter {
            name: None,
            description: None,
            disable_model_invocation: None,
        });
        return (fm, yaml.to_string(), body.to_string());
    }
    (
        SkillFrontmatter {
            name: None,
            description: None,
            disable_model_invocation: None,
        },
        String::new(),
        text.to_string(),
    )
}

pub fn outline_from_markdown(body: &str) -> Vec<OutlineHeading> {
    body.lines()
        .filter_map(|line| {
            let t = line.trim();
            if t.starts_with('#') {
                let level = t.chars().take_while(|c| *c == '#').count() as u8;
                if level >= 1 && level <= 6 {
                    let text = t[level as usize..].trim().to_string();
                    if !text.is_empty() {
                        return Some(OutlineHeading { level, text });
                    }
                }
            }
            None
        })
        .collect()
}

pub(crate) fn find_skill_dirs(root: &Path, max_depth: usize) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let walker = WalkDir::new(root)
        .follow_links(true)
        .max_depth(max_depth)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !matches!(
                name.as_ref(),
                ".git" | "node_modules" | "__pycache__" | ".venv"
            )
        });
    for entry in walker.filter_map(|e| e.ok()) {
        if !entry.file_type().is_dir() {
            continue;
        }
        let skill_md = entry.path().join("SKILL.md");
        if skill_md.is_file() {
            found.push(entry.path().to_path_buf());
        }
    }
    found
}

fn mtime_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn index_skill_dir(
    dir: &Path,
    source: &crate::models::SourceConfigEntry,
    project_root: Option<&str>,
) -> Result<SkillRecord, String> {
    let entry = dir.join("SKILL.md");
    let text = fs::read_to_string(&entry).map_err(|e| e.to_string())?;
    let (fm, _yaml, _body) = parse_skill_md(&text);
    let dir_name = dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "skill".into());
    let name = fm.name.unwrap_or_else(|| dir_name.clone());
    let description = fm.description.unwrap_or_default();
    let real = crate::sources::normalize_path(dir);
    let is_symlink = fs::symlink_metadata(dir)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false);
    let hash = content_hash(dir)?;
    let has_scripts = dir.join("scripts").is_dir();
    let mut flags = serde_json::Map::new();
    if let Some(v) = fm.disable_model_invocation {
        flags.insert("disableModelInvocation".into(), serde_json::Value::Bool(v));
    }

    Ok(SkillRecord {
        id: path_id(&real),
        name,
        description,
        dir_path: real.clone(),
        entry_path: crate::sources::normalize_path(&entry),
        realpath: real,
        is_symlink,
        source_id: source.id.clone(),
        runtime: source.runtime.clone(),
        scope: source.scope.clone(),
        origin: source.origin.clone(),
        access: source.access.clone(),
        project_root: project_root.map(|s| s.to_string()),
        content_hash: hash,
        entry_mtime_ms: mtime_ms(&entry),
        has_scripts,
        frontmatter_flags: serde_json::Value::Object(flags),
        tags: Vec::new(),
        favorite: false,
        twin_group_id: None,
        health_score: None,
        last_used_at: None,
        indexed_at: now_ms(),
        error: None,
    })
}

pub fn full_scan(
    db: &Db,
    cfg: &SourceConfigFile,
    enabled: &HashSet<String>,
    projects: &[String],
) -> Result<usize, String> {
    let mut total = 0usize;
    for source in &cfg.sources {
        if !enabled.contains(&source.id) {
            continue;
        }
        if source.scope == "project" {
            for proj in projects {
                let roots = resolve_roots(source, &[proj.clone()]);
                for root in roots {
                    total += scan_root(db, source, &root, Some(proj))?;
                }
            }
        } else {
            let roots = resolve_roots(source, &[]);
            for root in roots {
                total += scan_root(db, source, &root, None)?;
            }
        }
    }
    rebuild_twins(db)?;
    Ok(total)
}

fn scan_root(
    db: &Db,
    source: &crate::models::SourceConfigEntry,
    root: &str,
    project_root: Option<&str>,
) -> Result<usize, String> {
    let root_path = PathBuf::from(root);
    if !root_path.is_dir() {
        return Ok(0);
    }
    let dirs = find_skill_dirs(&root_path, 3);
    let mut keep = Vec::new();
    let mut count = 0;
    for dir in dirs {
        match index_skill_dir(&dir, source, project_root) {
            Ok(mut rec) => {
                // preserve favorite/tags if exists
                if let Ok(Some(old)) = db.get_skill_by_path(&rec.dir_path) {
                    rec.favorite = old.favorite;
                    rec.tags = old.tags;
                    rec.health_score = old.health_score;
                    rec.last_used_at = old.last_used_at;
                }
                keep.push(rec.dir_path.clone());
                db.upsert_skill(&rec)?;
                let _ = crate::packaging::record_hash_if_changed(db, &rec);
                count += 1;
            }
            Err(err) => {
                eprintln!("index error {}: {}", dir.display(), err);
            }
        }
    }
    db.delete_skills_not_in(&source.id, project_root, &keep)?;
    Ok(count)
}

pub fn rebuild_twins(db: &Db) -> Result<(), String> {
    db.clear_twin_groups()?;
    let skills = db.all_skills()?;
    let mut by_name: HashMap<String, Vec<SkillRecord>> = HashMap::new();
    for s in skills {
        by_name
            .entry(s.name.to_lowercase())
            .or_default()
            .push(s);
    }
    for (name, group) in by_name {
        if group.len() < 2 {
            continue;
        }
        let hashes: HashSet<&str> = group.iter().map(|s| s.content_hash.as_str()).collect();
        let status = if hashes.len() == 1 {
            "identical"
        } else {
            "diverged"
        };
        let tg = TwinGroup {
            id: uuid::Uuid::new_v4().to_string(),
            key_type: "name".into(),
            key: name,
            status: status.into(),
            skill_ids: group.iter().map(|s| s.id.clone()).collect(),
        };
        db.save_twin_group(&tg)?;
    }
    Ok(())
}

pub fn list_skill_files(dir: &Path) -> Vec<String> {
    WalkDir::new(dir)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            e.path()
                .strip_prefix(dir)
                .ok()
                .map(|p| p.to_string_lossy().replace('\\', "/"))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::models::SourceConfigEntry;
    use std::fs;
    use tempfile::TempDir;

    fn cfg() -> SourceConfigEntry {
        SourceConfigEntry {
            id: "test".into(),
            label: "Test".into(),
            runtime: "agents".into(),
            scope: "user".into(),
            origin: "user".into(),
            access: "readwrite".into(),
            enabled_by_default: true,
            path_patterns: vec![],
            notes: None,
        }
    }

    fn write_skill(dir: &Path, name: &str, desc: &str, body: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(
            dir.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: {desc}\n---\n\n{body}\n"),
        )
        .unwrap();
    }

    #[test]
    fn parse_skill_md_maps_frontmatter() {
        let (fm, yaml, body) = parse_skill_md(
            "---\nname: demo\ndescription: Use when demoing.\n---\n\n# Title\n",
        );
        assert_eq!(fm.name.as_deref(), Some("demo"));
        assert_eq!(fm.description.as_deref(), Some("Use when demoing."));
        assert!(yaml.contains("name: demo"));
        assert!(body.contains("# Title"));
    }

    #[test]
    fn find_skill_dirs_respects_depth_and_skips() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write_skill(
            &root.join("keep"),
            "keep",
            "Use when keeping skills for discovery tests.",
            "# Keep",
        );
        write_skill(
            &root.join("node_modules").join("pkg"),
            "pkg",
            "Use when nested under node_modules should be ignored.",
            "# Skip",
        );
        write_skill(
            &root.join("deep").join("a").join("b").join("c"),
            "deep",
            "Use when depth limit should exclude deep skills.",
            "# Deep",
        );

        let found = find_skill_dirs(root, 2);
        let names: Vec<_> = found
            .iter()
            .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
            .collect();
        assert!(names.contains(&"keep".to_string()));
        assert!(!names.iter().any(|n| n == "pkg"));
        assert!(!names.iter().any(|n| n == "deep"));
    }

    #[test]
    fn index_skill_dir_field_mapping() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("my-skill");
        write_skill(
            &dir,
            "my-skill",
            "Use when indexing field mapping for unit tests.",
            "# Body",
        );
        fs::create_dir_all(dir.join("scripts")).unwrap();
        fs::write(dir.join("scripts").join("run.sh"), "echo hi").unwrap();

        let rec = index_skill_dir(&dir, &cfg(), Some(r"C:\proj")).unwrap();
        assert_eq!(rec.name, "my-skill");
        assert!(rec.description.contains("indexing"));
        assert!(rec.has_scripts);
        assert_eq!(rec.runtime, "agents");
        assert_eq!(rec.project_root.as_deref(), Some(r"C:\proj"));
        assert!(!rec.content_hash.is_empty());
        assert!(rec.entry_path.ends_with("SKILL.md") || rec.entry_path.ends_with("skill.md"));
    }

    #[test]
    fn rebuild_twins_identical_and_diverged() {
        let tmp = TempDir::new().unwrap();
        let a = tmp.path().join("a").join("same");
        let b = tmp.path().join("b").join("same");
        let c = tmp.path().join("c").join("same");
        write_skill(
            &a,
            "same",
            "Use when testing identical twin detection across paths.",
            "# Same body",
        );
        write_skill(
            &b,
            "same",
            "Use when testing identical twin detection across paths.",
            "# Same body",
        );
        write_skill(
            &c,
            "same",
            "Use when testing identical twin detection across paths.",
            "# Different body",
        );

        let db = Db::open_in_memory().unwrap();
        let source = cfg();
        for dir in [&a, &b] {
            let rec = index_skill_dir(dir, &source, None).unwrap();
            db.upsert_skill(&rec).unwrap();
        }
        rebuild_twins(&db).unwrap();
        let groups = db.list_twin_groups().unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].status, "identical");
        assert_eq!(groups[0].skill_ids.len(), 2);

        let rec = index_skill_dir(&c, &source, None).unwrap();
        db.upsert_skill(&rec).unwrap();
        rebuild_twins(&db).unwrap();
        let groups = db.list_twin_groups().unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].status, "diverged");
        assert_eq!(groups[0].skill_ids.len(), 3);
    }
}
