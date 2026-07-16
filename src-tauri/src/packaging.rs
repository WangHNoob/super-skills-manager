use crate::db::Db;
use crate::indexer::{index_skill_dir, now_ms};
use crate::models::*;
use crate::sources::normalize_path;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub fn export_skills_zip(db: &Db, skill_ids: &[String]) -> Result<ExportArtifact, String> {
    let mut skills = Vec::new();
    for id in skill_ids {
        let s = db
            .get_skill(id)?
            .ok_or_else(|| format!("skill 不存在: {id}"))?;
        skills.push(s);
    }
    if skills.is_empty() {
        return Err("未选择 skill".into());
    }

    let tmp = std::env::temp_dir().join(format!("ssm-export-{}.zip", uuid::Uuid::new_v4()));
    let file = File::create(&tmp).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let mut manifest = serde_json::json!({
        "version": 1,
        "exportedAt": now_ms(),
        "skills": []
    });
    let arr = manifest["skills"].as_array_mut().unwrap();

    for skill in &skills {
        let root_name = format!("skills/{}", skill.name);
        for entry in WalkDir::new(&skill.dir_path)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let rel = entry
                .path()
                .strip_prefix(&skill.dir_path)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            let zip_path = format!("{root_name}/{rel}");
            let mut f = File::open(entry.path()).map_err(|e| e.to_string())?;
            let mut buf = Vec::new();
            f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            zip.start_file(&zip_path, opts)
                .map_err(|e| e.to_string())?;
            zip.write_all(&buf).map_err(|e| e.to_string())?;
        }
        arr.push(serde_json::json!({
            "name": skill.name,
            "contentHash": skill.content_hash,
            "runtime": skill.runtime,
            "sourceId": skill.source_id,
        }));
        db.record_content_history(&skill.id, &skill.name, &skill.content_hash, "export")?;
    }

    zip.start_file("manifest.json", opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(manifest.to_string().as_bytes())
        .map_err(|e| e.to_string())?;
    zip.finish().map_err(|e| e.to_string())?;

    let bytes = fs::read(&tmp).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&tmp);
    Ok(ExportArtifact {
        filename: format!("ssm-skills-{}.zip", now_ms()),
        base64: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes),
        skill_count: skills.len(),
    })
}

pub fn import_skills_zip(
    db: &Db,
    zip_base64: &str,
    target_root: &str,
    source_cfg: &SourceConfigEntry,
) -> Result<OpLogEntry, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(zip_base64)
        .map_err(|e| format!("base64 解码失败: {e}"))?;
    let tmp = std::env::temp_dir().join(format!("ssm-import-{}.zip", uuid::Uuid::new_v4()));
    fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;

    let file = File::open(&tmp).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
    let extract_root = std::env::temp_dir().join(format!("ssm-import-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&extract_root).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();
        if name.ends_with('/') {
            continue;
        }
        let out = extract_root.join(name.replace('/', std::path::MAIN_SEPARATOR_STR));
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut outfile = File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
    }

    let skills_root = extract_root.join("skills");
    let target = PathBuf::from(target_root);
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;

    let mut targets = Vec::new();
    let mut errors = Vec::new();
    if skills_root.is_dir() {
        for entry in fs::read_dir(&skills_root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.path().is_dir() {
                continue;
            }
            if !entry.path().join("SKILL.md").is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let dest = target.join(&name);
            if dest.exists() {
                fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
            }
            copy_dir(&entry.path(), &dest)?;
            match index_skill_dir(&dest, source_cfg, None) {
                Ok(rec) => {
                    db.upsert_skill(&rec)?;
                    db.record_content_history(&rec.id, &rec.name, &rec.content_hash, "import")?;
                    targets.push(normalize_path(&dest));
                }
                Err(e) => errors.push(format!("{name}: {e}")),
            }
        }
    }

    let _ = fs::remove_file(&tmp);
    let _ = fs::remove_dir_all(&extract_root);

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
        op: "import".into(),
        status: status.into(),
        sources: vec!["zip".into()],
        targets,
        detail: serde_json::json!({ "errors": errors }),
    };
    db.add_oplog(&entry)?;
    Ok(entry)
}

fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in WalkDir::new(src).into_iter().filter_map(|e| e.ok()) {
        let rel = entry
            .path()
            .strip_prefix(src)
            .map_err(|e| e.to_string())?;
        let to = dst.join(rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&to).map_err(|e| e.to_string())?;
        } else if entry.file_type().is_file() {
            if let Some(p) = to.parent() {
                fs::create_dir_all(p).map_err(|e| e.to_string())?;
            }
            fs::copy(entry.path(), &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn record_hash_if_changed(db: &Db, skill: &SkillRecord) -> Result<(), String> {
    let latest = db.latest_content_hash(&skill.id)?;
    if latest.as_deref() != Some(skill.content_hash.as_str()) {
        db.record_content_history(&skill.id, &skill.name, &skill.content_hash, "scan")?;
    }
    Ok(())
}
