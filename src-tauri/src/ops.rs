use crate::db::Db;
use crate::indexer::{index_skill_dir, now_ms, rebuild_twins};
use crate::models::*;
use crate::sources::{extract_default_target, write_target_for_runtime};
use std::fs;
use std::path::{Path, PathBuf};

pub fn preview_copy(
    db: &Db,
    skill_ids: &[String],
    project: &str,
    runtimes: &[String],
    conflict_policy: &str,
    also_native_cursor: bool,
    block_plugin_copy: bool,
) -> Result<CopyPreview, String> {
    let project_path = PathBuf::from(project);
    if !project_path.is_dir() {
        return Err("目标项目路径不存在".into());
    }
    let mut items = Vec::new();
    for id in skill_ids {
        let skill = db
            .get_skill(id)?
            .ok_or_else(|| format!("skill 不存在: {id}"))?;
        if block_plugin_copy && skill.origin == "plugin" {
            return Err(format!(
                "策略禁止将插件源 skill「{}」直接复制到项目（请先提取为自有副本）",
                skill.name
            ));
        }
        if block_plugin_copy && skill.origin == "builtin" {
            return Err(format!(
                "策略禁止将内置 skill「{}」直接复制到项目（请先提取为自有副本）",
                skill.name
            ));
        }
        for rt in runtimes {
            let also = also_native_cursor && rt == "cursor";
            for target in write_target_for_runtime(&project_path, rt, &skill.name, also) {
                let exists = target.exists();
                let action = if !exists {
                    "copy".to_string()
                } else {
                    match conflict_policy {
                        "skip" => "skip".into(),
                        "rename" => "rename".into(),
                        "overwrite" => "overwrite".into(),
                        _ => "prompt".into(),
                    }
                };
                items.push(CopyPlanItem {
                    skill_id: skill.id.clone(),
                    skill_name: skill.name.clone(),
                    source_path: skill.dir_path.clone(),
                    target_path: target.to_string_lossy().to_string(),
                    action,
                });
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    items.retain(|i| seen.insert(i.target_path.clone()));
    Ok(CopyPreview { items })
}

fn copy_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_recursive(&entry.path(), &to)?;
        } else {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(entry.path(), &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn execute_copy(
    db: &Db,
    preview: &CopyPreview,
    conflict_policy: &str,
) -> Result<OpLogEntry, String> {
    let mut sources = Vec::new();
    let mut targets = Vec::new();
    let mut errors = Vec::new();

    for item in &preview.items {
        let mut target = PathBuf::from(&item.target_path);
        let action = if item.action == "prompt" {
            conflict_policy
        } else {
            item.action.as_str()
        };

        if target.exists() {
            match action {
                "skip" => continue,
                "rename" => {
                    let mut i = 2;
                    loop {
                        let name = format!("{}-{}", item.skill_name, i);
                        let candidate = target.parent().unwrap_or(Path::new(".")).join(name);
                        if !candidate.exists() {
                            target = candidate;
                            break;
                        }
                        i += 1;
                    }
                }
                "overwrite" => {
                    fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
                }
                _ => {
                    fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
                }
            }
        }

        match copy_recursive(Path::new(&item.source_path), &target) {
            Ok(()) => {
                sources.push(item.source_path.clone());
                targets.push(target.to_string_lossy().to_string());
            }
            Err(e) => errors.push(format!("{}: {e}", item.target_path)),
        }
    }

    let status = if errors.is_empty() {
        "ok"
    } else if targets.is_empty() {
        "failed"
    } else {
        "partial"
    };

    let entry = OpLogEntry {
        id: uuid::Uuid::new_v4().to_string(),
        ts: now_ms(),
        op: "copy".into(),
        status: status.into(),
        sources,
        targets,
        detail: serde_json::json!({ "errors": errors, "policy": conflict_policy }),
    };
    db.add_oplog(&entry)?;
    let ids: Vec<String> = preview
        .items
        .iter()
        .map(|i| i.skill_id.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    let _ = db.touch_last_used(&ids);
    Ok(entry)
}

pub fn delete_skills(db: &Db, skill_ids: &[String]) -> Result<OpLogEntry, String> {
    let mut sources = Vec::new();
    let mut errors = Vec::new();
    let mut blocked = Vec::new();

    for id in skill_ids {
        let Some(skill) = db.get_skill(id)? else {
            errors.push(format!("missing {id}"));
            continue;
        };
        if skill.access == "readonly" {
            blocked.push(skill.dir_path.clone());
            continue;
        }
        match trash::delete(&skill.dir_path) {
            Ok(()) => {
                sources.push(skill.dir_path.clone());
                db.delete_skill_id(&skill.id)?;
            }
            Err(e) => errors.push(format!("{}: {e}", skill.dir_path)),
        }
    }
    rebuild_twins(db)?;
    let status = if !blocked.is_empty() && sources.is_empty() {
        "failed"
    } else if errors.is_empty() && blocked.is_empty() {
        "ok"
    } else {
        "partial"
    };
    let entry = OpLogEntry {
        id: uuid::Uuid::new_v4().to_string(),
        ts: now_ms(),
        op: "delete".into(),
        status: status.into(),
        sources,
        targets: Vec::new(),
        detail: serde_json::json!({ "errors": errors, "blockedReadonly": blocked }),
    };
    db.add_oplog(&entry)?;
    Ok(entry)
}

pub fn extract_copy(db: &Db, skill_id: &str) -> Result<OpLogEntry, String> {
    let skill = db
        .get_skill(skill_id)?
        .ok_or_else(|| "skill 不存在".to_string())?;
    let target = extract_default_target(&skill.name);
    if target.exists() {
        return Err(format!(
            "目标已存在: {}（请先删除或改名）",
            target.display()
        ));
    }
    copy_recursive(Path::new(&skill.dir_path), &target)?;
    let entry = OpLogEntry {
        id: uuid::Uuid::new_v4().to_string(),
        ts: now_ms(),
        op: "extractCopy".into(),
        status: "ok".into(),
        sources: vec![skill.dir_path],
        targets: vec![target.to_string_lossy().to_string()],
        detail: serde_json::json!({}),
    };
    db.add_oplog(&entry)?;
    Ok(entry)
}

pub fn diff_twins(db: &Db, left_id: &str, right_id: &str) -> Result<TwinDiff, String> {
    use crate::registry_compare::unified_diff;

    let left = db
        .get_skill(left_id)?
        .ok_or_else(|| "左侧 skill 不存在".to_string())?;
    let right = db
        .get_skill(right_id)?
        .ok_or_else(|| "右侧 skill 不存在".to_string())?;
    let left_body = fs::read_to_string(&left.entry_path).unwrap_or_default();
    let right_body = fs::read_to_string(&right.entry_path).unwrap_or_default();
    let left_label = format!("{} ({})", left.runtime, left.source_id);
    let right_label = format!("{} ({})", right.runtime, right.source_id);
    let identical = left_body == right_body;
    let diff = if identical {
        String::new()
    } else {
        unified_diff(&left_body, &right_body, &left_label, &right_label)
    };
    Ok(TwinDiff {
        left_id: left.id,
        right_id: right.id,
        left_label,
        right_label,
        identical,
        diff,
    })
}

pub fn sync_twin(
    db: &Db,
    source_id: &str,
    target_id: &str,
    cfg_sources: &[SourceConfigEntry],
) -> Result<OpLogEntry, String> {
    let source = db
        .get_skill(source_id)?
        .ok_or_else(|| "源 skill 不存在".to_string())?;
    let target = db
        .get_skill(target_id)?
        .ok_or_else(|| "目标 skill 不存在".to_string())?;
    if target.access == "readonly" {
        return Err("不能覆盖只读 skill".into());
    }
    let target_path = PathBuf::from(&target.dir_path);
    if target_path.exists() {
        fs::remove_dir_all(&target_path).map_err(|e| e.to_string())?;
    }
    copy_recursive(Path::new(&source.dir_path), &target_path)?;

    if let Some(src_cfg) = cfg_sources.iter().find(|s| s.id == target.source_id) {
        if let Ok(rec) = index_skill_dir(&target_path, src_cfg, target.project_root.as_deref()) {
            db.upsert_skill(&rec)?;
        }
    }
    rebuild_twins(db)?;

    let entry = OpLogEntry {
        id: uuid::Uuid::new_v4().to_string(),
        ts: now_ms(),
        op: "syncTwin".into(),
        status: "ok".into(),
        sources: vec![source.dir_path],
        targets: vec![target.dir_path],
        detail: serde_json::json!({}),
    };
    db.add_oplog(&entry)?;
    Ok(entry)
}

pub fn resolve_delete_impact(db: &Db, skill_ids: &[String]) -> Result<serde_json::Value, String> {
    let mut items = Vec::new();
    for id in skill_ids {
        if let Some(skill) = db.get_skill(id)? {
            let twin_count = if let Some(gid) = &skill.twin_group_id {
                db.list_twin_groups()?
                    .into_iter()
                    .find(|g| &g.id == gid)
                    .map(|g| g.skill_ids.len())
                    .unwrap_or(1)
            } else {
                1
            };
            let bundles = db.bundles_referencing_skill(&skill.id, &skill.name)?;
            items.push(serde_json::json!({
                "id": skill.id,
                "name": skill.name,
                "path": skill.dir_path,
                "access": skill.access,
                "twinCount": twin_count,
                "bundles": bundles,
            }));
        }
    }
    Ok(serde_json::json!({ "items": items }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::indexer::index_skill_dir;
    use crate::models::SourceConfigEntry;
    use std::fs;
    use tempfile::TempDir;

    fn source_cfg(id: &str, access: &str) -> SourceConfigEntry {
        SourceConfigEntry {
            id: id.into(),
            label: id.into(),
            runtime: "agents".into(),
            scope: "user".into(),
            origin: "user".into(),
            access: access.into(),
            enabled_by_default: true,
            path_patterns: vec![],
            notes: None,
        }
    }

    fn write_skill(dir: &Path, name: &str, body: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(
            dir.join("SKILL.md"),
            format!(
                "---\nname: {name}\ndescription: Use when testing the {name} skill copy path.\n---\n\n{body}\n"
            ),
        )
        .unwrap();
    }

    fn index_into(db: &Db, dir: &Path, cfg: &SourceConfigEntry) -> SkillRecord {
        let rec = index_skill_dir(dir, cfg, None).unwrap();
        db.upsert_skill(&rec).unwrap();
        rec
    }

    #[test]
    fn preview_copy_actions_for_policies() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("src").join("demo");
        write_skill(&src, "demo", "# Demo\n\nBody content for tests.");
        let project = tmp.path().join("proj");
        fs::create_dir_all(&project).unwrap();

        let db = Db::open_in_memory().unwrap();
        let cfg = source_cfg("src-user", "readwrite");
        let skill = index_into(&db, &src, &cfg);

        let target = project.join(".agents").join("skills").join("demo");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("SKILL.md"), "old").unwrap();

        for (policy, expected) in [
            ("overwrite", "overwrite"),
            ("skip", "skip"),
            ("rename", "rename"),
            ("prompt", "prompt"),
        ] {
            let preview = preview_copy(
                &db,
                &[skill.id.clone()],
                project.to_str().unwrap(),
                &["agents".into()],
                policy,
                false,
                false,
            )
            .unwrap();
            assert_eq!(preview.items.len(), 1);
            assert_eq!(preview.items[0].action, expected, "policy={policy}");
        }

        // no conflict -> copy
        let empty = tmp.path().join("empty-proj");
        fs::create_dir_all(&empty).unwrap();
        let preview = preview_copy(
            &db,
            &[skill.id.clone()],
            empty.to_str().unwrap(),
            &["agents".into()],
            "overwrite",
            false,
            false,
        )
        .unwrap();
        assert_eq!(preview.items[0].action, "copy");
    }

    #[test]
    fn execute_copy_overwrite_and_rename_and_skip() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("src").join("demo");
        write_skill(&src, "demo", "# New content\n\nFresh body.");
        let project = tmp.path().join("proj");
        fs::create_dir_all(&project).unwrap();

        let db = Db::open_in_memory().unwrap();
        let cfg = source_cfg("src-user", "readwrite");
        let skill = index_into(&db, &src, &cfg);

        let target = project.join(".agents").join("skills").join("demo");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("SKILL.md"), "OLD_CONTENT").unwrap();

        // overwrite
        let preview = preview_copy(
            &db,
            &[skill.id.clone()],
            project.to_str().unwrap(),
            &["agents".into()],
            "overwrite",
            false,
            false,
        )
        .unwrap();
        let entry = execute_copy(&db, &preview, "overwrite").unwrap();
        assert_eq!(entry.status, "ok");
        let text = fs::read_to_string(target.join("SKILL.md")).unwrap();
        assert!(text.contains("Fresh body"));
        assert!(!text.contains("OLD_CONTENT"));

        // skip keeps existing
        fs::write(target.join("SKILL.md"), "KEEP_ME").unwrap();
        let preview = preview_copy(
            &db,
            &[skill.id.clone()],
            project.to_str().unwrap(),
            &["agents".into()],
            "skip",
            false,
            false,
        )
        .unwrap();
        let entry = execute_copy(&db, &preview, "skip").unwrap();
        assert_eq!(entry.status, "ok");
        assert!(entry.targets.is_empty());
        assert_eq!(
            fs::read_to_string(target.join("SKILL.md")).unwrap(),
            "KEEP_ME"
        );

        // rename creates sibling
        let preview = preview_copy(
            &db,
            &[skill.id.clone()],
            project.to_str().unwrap(),
            &["agents".into()],
            "rename",
            false,
            false,
        )
        .unwrap();
        let entry = execute_copy(&db, &preview, "rename").unwrap();
        assert_eq!(entry.status, "ok");
        assert_eq!(entry.targets.len(), 1);
        let renamed = PathBuf::from(&entry.targets[0]);
        assert!(renamed.ends_with("demo-2"));
        assert!(renamed.join("SKILL.md").is_file());
        assert_eq!(
            fs::read_to_string(target.join("SKILL.md")).unwrap(),
            "KEEP_ME"
        );
    }

    #[test]
    fn sync_twin_rejects_readonly_and_overwrites_writable() {
        let tmp = TempDir::new().unwrap();
        let left = tmp.path().join("left").join("twin");
        let right = tmp.path().join("right").join("twin");
        write_skill(&left, "twin", "# Left\n\nSource version.");
        write_skill(&right, "twin", "# Right\n\nOld target.");

        let db = Db::open_in_memory().unwrap();
        let rw = source_cfg("src-rw", "readwrite");
        let ro = source_cfg("src-ro", "readonly");
        let src = index_into(&db, &left, &rw);
        let mut dst_ro = index_skill_dir(&right, &ro, None).unwrap();
        db.upsert_skill(&dst_ro).unwrap();

        let err = sync_twin(&db, &src.id, &dst_ro.id, &[ro.clone()]).unwrap_err();
        assert!(err.contains("只读"));

        dst_ro.access = "readwrite".into();
        dst_ro.source_id = rw.id.clone();
        db.upsert_skill(&dst_ro).unwrap();
        let entry = sync_twin(&db, &src.id, &dst_ro.id, &[rw]).unwrap();
        assert_eq!(entry.status, "ok");
        let text = fs::read_to_string(right.join("SKILL.md")).unwrap();
        assert!(text.contains("Source version"));
    }

    #[test]
    fn resolve_delete_impact_reports_twins_and_bundles() {
        let tmp = TempDir::new().unwrap();
        let a = tmp.path().join("a").join("shared");
        let b = tmp.path().join("b").join("shared");
        write_skill(&a, "shared", "# A");
        write_skill(&b, "shared", "# B");

        let db = Db::open_in_memory().unwrap();
        let cfg = source_cfg("src-user", "readwrite");
        let s1 = index_into(&db, &a, &cfg);
        let s2 = index_into(&db, &b, &cfg);
        crate::indexer::rebuild_twins(&db).unwrap();

        let bundle = Bundle {
            id: "b1".into(),
            name: "Pack".into(),
            description: None,
            items: vec![BundleItem {
                skill_ref: SkillRef::Id {
                    value: s1.id.clone(),
                },
                optional: false,
            }],
            default_runtimes: vec!["agents".into()],
            created_at: 1,
            updated_at: 1,
            version: 1,
        };
        db.save_bundle(&bundle).unwrap();

        let impact = resolve_delete_impact(&db, &[s1.id.clone()]).unwrap();
        let items = impact["items"].as_array().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["twinCount"], 2);
        assert_eq!(items[0]["bundles"][0], "Pack");
        let _ = s2;
    }
}
