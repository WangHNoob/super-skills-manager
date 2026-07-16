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
