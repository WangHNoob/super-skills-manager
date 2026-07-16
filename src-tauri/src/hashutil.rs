use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::Path;
use walkdir::WalkDir;

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

pub fn path_id(realpath: &str) -> String {
    sha256_hex(realpath.as_bytes())[..32].to_string()
}

/// Content fingerprint for a skill directory (docs/03-data-model.md).
pub fn content_hash(dir: &Path) -> Result<String, String> {
    let mut parts: Vec<(String, String)> = Vec::new();
    for entry in WalkDir::new(dir)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = entry
            .path()
            .strip_prefix(dir)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let lower = rel.to_lowercase();
        let keep = lower == "skill.md"
            || lower.ends_with(".md")
            || lower.starts_with("scripts/");
        if !keep {
            continue;
        }
        let mut file = fs::File::open(entry.path()).map_err(|e| e.to_string())?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        parts.push((rel, sha256_hex(&buf)));
    }
    parts.sort_by(|a, b| a.0.cmp(&b.0));
    let mut concat = String::new();
    for (path, hash) in parts {
        concat.push_str(&path);
        concat.push('\0');
        concat.push_str(&hash);
        concat.push('\n');
    }
    Ok(sha256_hex(concat.as_bytes()))
}
