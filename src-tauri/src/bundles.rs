use crate::db::Db;
use crate::indexer::now_ms;
use crate::models::*;
use crate::ops::{execute_copy, preview_copy};

pub fn create_bundle(
    db: &Db,
    name: String,
    description: Option<String>,
    skill_ids: Vec<String>,
    default_runtimes: Vec<String>,
) -> Result<Bundle, String> {
    let mut items = Vec::new();
    for id in skill_ids {
        let skill = db
            .get_skill(&id)?
            .ok_or_else(|| format!("skill 不存在: {id}"))?;
        items.push(BundleItem {
            skill_ref: SkillRef::NameHash {
                name: skill.name,
                content_hash: skill.content_hash,
            },
            optional: false,
        });
    }
    let ts = now_ms();
    let bundle = Bundle {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        description,
        items,
        default_runtimes: if default_runtimes.is_empty() {
            vec!["agents".into(), "claude".into()]
        } else {
            default_runtimes
        },
        created_at: ts,
        updated_at: ts,
        version: 1,
    };
    db.save_bundle(&bundle)?;
    Ok(bundle)
}

pub fn resolve_bundle_skill_ids(db: &Db, bundle: &Bundle) -> Result<(Vec<String>, Vec<String>), String> {
    let mut ids = Vec::new();
    let mut missing = Vec::new();
    for item in &bundle.items {
        match &item.skill_ref {
            SkillRef::Id { value } => {
                if db.get_skill(value)?.is_some() {
                    ids.push(value.clone());
                } else if item.optional {
                    missing.push(value.clone());
                } else {
                    missing.push(value.clone());
                }
            }
            SkillRef::NameHash { name, content_hash } => {
                let candidates = db.skills_by_name(name)?;
                if let Some(exact) = candidates.iter().find(|s| &s.content_hash == content_hash) {
                    ids.push(exact.id.clone());
                } else if let Some(any) = candidates.first() {
                    ids.push(any.id.clone());
                } else if !item.optional {
                    missing.push(name.clone());
                } else {
                    missing.push(name.clone());
                }
            }
        }
    }
    Ok((ids, missing))
}

pub fn apply_bundle(
    db: &Db,
    bundle_id: &str,
    project: &str,
    runtimes: Option<Vec<String>>,
    conflict_policy: &str,
    also_native_cursor: bool,
) -> Result<OpLogEntry, String> {
    let bundle = db
        .get_bundle(bundle_id)?
        .ok_or_else(|| "Bundle 不存在".to_string())?;
    let (ids, missing) = resolve_bundle_skill_ids(db, &bundle)?;
    if ids.is_empty() {
        return Err(format!("Bundle 无可用 skill，缺失: {:?}", missing));
    }
    let rts = runtimes.unwrap_or(bundle.default_runtimes.clone());
    let preview = preview_copy(
        db,
        &ids,
        project,
        &rts,
        conflict_policy,
        also_native_cursor,
        false,
    )?;
    let mut entry = execute_copy(db, &preview, conflict_policy)?;
    entry.op = "bundleApply".into();
    entry.detail = serde_json::json!({
        "bundleId": bundle_id,
        "bundleName": bundle.name,
        "missing": missing,
        "prevDetail": entry.detail,
    });
    // rewrite oplog row roughly by adding another
    db.add_oplog(&OpLogEntry {
        id: uuid::Uuid::new_v4().to_string(),
        ts: now_ms(),
        op: "bundleApply".into(),
        status: entry.status.clone(),
        sources: entry.sources.clone(),
        targets: entry.targets.clone(),
        detail: entry.detail.clone(),
    })?;
    Ok(entry)
}

pub fn import_bundle(db: &Db, json: &str) -> Result<Bundle, String> {
    let mut bundle: Bundle = serde_json::from_str(json).map_err(|e| e.to_string())?;
    if bundle.id.is_empty() {
        bundle.id = uuid::Uuid::new_v4().to_string();
    }
    let ts = now_ms();
    if bundle.created_at == 0 {
        bundle.created_at = ts;
    }
    bundle.updated_at = ts;
    if bundle.version == 0 {
        bundle.version = 1;
    }
    db.save_bundle(&bundle)?;
    Ok(bundle)
}

/// 更新已有组合包：改名并按 skill_ids 重建 items（保留 id / 时间戳）。
pub fn update_bundle(
    db: &Db,
    id: &str,
    name: Option<String>,
    description: Option<Option<String>>,
    skill_ids: Vec<String>,
    default_runtimes: Option<Vec<String>>,
) -> Result<Bundle, String> {
    let mut bundle = db
        .get_bundle(id)?
        .ok_or_else(|| "Bundle 不存在".to_string())?;
    if let Some(n) = name {
        let n = n.trim();
        if n.is_empty() {
            return Err("组合包名称不能为空".into());
        }
        bundle.name = n.into();
    }
    if let Some(d) = description {
        bundle.description = d;
    }
    if let Some(rts) = default_runtimes {
        bundle.default_runtimes = if rts.is_empty() {
            vec!["agents".into(), "claude".into()]
        } else {
            rts
        };
    }
    let mut items = Vec::new();
    for sid in skill_ids {
        let skill = db
            .get_skill(&sid)?
            .ok_or_else(|| format!("skill 不存在: {sid}"))?;
        items.push(BundleItem {
            skill_ref: SkillRef::NameHash {
                name: skill.name,
                content_hash: skill.content_hash,
            },
            optional: false,
        });
    }
    bundle.items = items;
    bundle.updated_at = now_ms();
    db.save_bundle(&bundle)?;
    Ok(bundle)
}

/// 为组合包生成应用到指定项目的复制预览（不执行）。
pub fn preview_bundle(
    db: &Db,
    bundle_id: &str,
    project: &str,
    runtimes: Option<Vec<String>>,
    conflict_policy: &str,
    also_native_cursor: bool,
) -> Result<(CopyPreview, Vec<String>, Vec<String>), String> {
    let bundle = db
        .get_bundle(bundle_id)?
        .ok_or_else(|| "Bundle 不存在".to_string())?;
    let (ids, missing) = resolve_bundle_skill_ids(db, &bundle)?;
    if ids.is_empty() {
        return Err(format!("Bundle 无可用 skill，缺失: {:?}", missing));
    }
    let rts = runtimes.unwrap_or_else(|| bundle.default_runtimes.clone());
    let preview = crate::ops::preview_copy(
        db,
        &ids,
        project,
        &rts,
        conflict_policy,
        also_native_cursor,
        false,
    )?;
    Ok((preview, ids, missing))
}

pub fn export_bundle(db: &Db, id: &str) -> Result<String, String> {
    let bundle = db
        .get_bundle(id)?
        .ok_or_else(|| "Bundle 不存在".to_string())?;
    serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())
}
