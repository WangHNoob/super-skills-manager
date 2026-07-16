use crate::models::*;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::collections::HashMap;

pub struct Db {
    conn: Connection,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| e.to_string())?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                r#"
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  dir_path TEXT NOT NULL UNIQUE,
  entry_path TEXT NOT NULL,
  realpath TEXT NOT NULL,
  is_symlink INTEGER NOT NULL DEFAULT 0,
  source_id TEXT NOT NULL,
  runtime TEXT NOT NULL,
  scope TEXT NOT NULL,
  origin TEXT NOT NULL,
  access TEXT NOT NULL,
  project_root TEXT,
  content_hash TEXT NOT NULL,
  entry_mtime_ms INTEGER NOT NULL,
  has_scripts INTEGER NOT NULL DEFAULT 0,
  frontmatter_json TEXT NOT NULL DEFAULT '{}',
  tags_json TEXT NOT NULL DEFAULT '[]',
  favorite INTEGER NOT NULL DEFAULT 0,
  twin_group_id TEXT,
  health_score REAL,
  indexed_at INTEGER NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
CREATE INDEX IF NOT EXISTS idx_skills_hash ON skills(content_hash);
CREATE INDEX IF NOT EXISTS idx_skills_source ON skills(source_id);

CREATE TABLE IF NOT EXISTS twin_groups (
  id TEXT PRIMARY KEY,
  key_type TEXT NOT NULL,
  key TEXT NOT NULL,
  status TEXT NOT NULL,
  skill_ids_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bundles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  items_json TEXT NOT NULL,
  default_runtimes_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS project_roots (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  last_used_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS op_log (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  op TEXT NOT NULL,
  status TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  targets_json TEXT NOT NULL,
  detail_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_state (
  root_path TEXT PRIMARY KEY,
  last_scan_at INTEGER NOT NULL,
  root_fingerprint TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS health_reports (
  skill_id TEXT PRIMARY KEY,
  skill_name TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL,
  grade TEXT NOT NULL,
  issues_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  registry_json TEXT,
  updated_at INTEGER NOT NULL
);
"#,
            )
            .map_err(|e| e.to_string())?;
        // lightweight migrations for older DBs
        let _ = self
            .conn
            .execute("ALTER TABLE health_reports ADD COLUMN skill_name TEXT NOT NULL DEFAULT ''", []);
        let _ = self
            .conn
            .execute("ALTER TABLE health_reports ADD COLUMN registry_json TEXT", []);
        let _ = self
            .conn
            .execute("ALTER TABLE skills ADD COLUMN last_used_at INTEGER", []);
        self.conn
            .execute_batch(
                r#"
CREATE TABLE IF NOT EXISTS content_history (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  event TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_history_skill ON content_history(skill_id, ts DESC);
"#,
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn save_health_report(&self, r: &HealthReport) -> Result<(), String> {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        self.conn
            .execute(
                r#"
INSERT INTO health_reports (skill_id, skill_name, score, grade, issues_json, content_hash, registry_json, updated_at)
VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
ON CONFLICT(skill_id) DO UPDATE SET
  skill_name=excluded.skill_name,
  score=excluded.score,
  grade=excluded.grade,
  issues_json=excluded.issues_json,
  content_hash=excluded.content_hash,
  registry_json=excluded.registry_json,
  updated_at=excluded.updated_at
"#,
                params![
                    r.skill_id,
                    r.skill_name,
                    r.score,
                    r.grade,
                    serde_json::to_string(&r.issues).map_err(|e| e.to_string())?,
                    r.content_hash,
                    r.registry
                        .as_ref()
                        .map(|x| serde_json::to_string(x).unwrap_or_else(|_| "null".into())),
                    ts
                ],
            )
            .map_err(|e| e.to_string())?;
        self.set_skill_health_score(&r.skill_id, r.score)?;
        Ok(())
    }

    pub fn set_skill_health_score(&self, id: &str, score: f64) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE skills SET health_score=?1 WHERE id=?2",
                params![score, id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_health_cache(
        &self,
        skill_id: &str,
        content_hash: &str,
    ) -> Result<Option<HealthReport>, String> {
        let row = self
            .conn
            .query_row(
                "SELECT skill_id, skill_name, score, grade, issues_json, content_hash, registry_json FROM health_reports WHERE skill_id=?1 AND content_hash=?2",
                params![skill_id, content_hash],
                |row| Self::map_health(row),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(row)
    }

    pub fn get_health_report(&self, skill_id: &str) -> Result<Option<HealthReport>, String> {
        self.conn
            .query_row(
                r#"
SELECT
  h.skill_id,
  CASE
    WHEN h.skill_name IS NOT NULL AND trim(h.skill_name) != '' THEN h.skill_name
    ELSE IFNULL(s.name, h.skill_id)
  END AS skill_name,
  h.score,
  h.grade,
  h.issues_json,
  h.content_hash,
  h.registry_json
FROM health_reports h
LEFT JOIN skills s ON s.id = h.skill_id
WHERE h.skill_id=?1
"#,
                params![skill_id],
                |row| Self::map_health(row),
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn list_health_reports(&self) -> Result<Vec<HealthReport>, String> {
        // Prefer skills.name when health_reports.skill_name is empty (legacy cache rows).
        let mut stmt = self
            .conn
            .prepare(
                r#"
SELECT
  h.skill_id,
  CASE
    WHEN h.skill_name IS NOT NULL AND trim(h.skill_name) != '' THEN h.skill_name
    ELSE IFNULL(s.name, h.skill_id)
  END AS skill_name,
  h.score,
  h.grade,
  h.issues_json,
  h.content_hash,
  h.registry_json
FROM health_reports h
LEFT JOIN skills s ON s.id = h.skill_id
ORDER BY h.score ASC, skill_name COLLATE NOCASE
"#,
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Self::map_health(row))
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn touch_health_skill_name(&self, skill_id: &str, skill_name: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE health_reports SET skill_name=?1 WHERE skill_id=?2",
                params![skill_name, skill_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn map_health(row: &rusqlite::Row<'_>) -> rusqlite::Result<HealthReport> {
        let issues: String = row.get(4)?;
        let registry_raw: Option<String> = row.get(6)?;
        let registry = registry_raw
            .as_deref()
            .filter(|s| !s.is_empty() && *s != "null")
            .and_then(|s| serde_json::from_str(s).ok());
        Ok(HealthReport {
            skill_id: row.get(0)?,
            skill_name: row.get(1)?,
            score: row.get(2)?,
            grade: row.get(3)?,
            issues: serde_json::from_str(&issues).unwrap_or_default(),
            content_hash: row.get(5)?,
            registry,
        })
    }

    pub fn upsert_skill(&self, s: &SkillRecord) -> Result<(), String> {
        self.conn
            .execute(
                r#"
INSERT INTO skills (
  id, name, description, dir_path, entry_path, realpath, is_symlink,
  source_id, runtime, scope, origin, access, project_root, content_hash,
  entry_mtime_ms, has_scripts, frontmatter_json, tags_json, favorite,
  twin_group_id, health_score, indexed_at, error
) VALUES (
  ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23
)
ON CONFLICT(dir_path) DO UPDATE SET
  id=excluded.id,
  name=excluded.name,
  description=excluded.description,
  entry_path=excluded.entry_path,
  realpath=excluded.realpath,
  is_symlink=excluded.is_symlink,
  source_id=excluded.source_id,
  runtime=excluded.runtime,
  scope=excluded.scope,
  origin=excluded.origin,
  access=excluded.access,
  project_root=excluded.project_root,
  content_hash=excluded.content_hash,
  entry_mtime_ms=excluded.entry_mtime_ms,
  has_scripts=excluded.has_scripts,
  frontmatter_json=excluded.frontmatter_json,
  twin_group_id=excluded.twin_group_id,
  indexed_at=excluded.indexed_at,
  error=excluded.error
"#,
                params![
                    s.id,
                    s.name,
                    s.description,
                    s.dir_path,
                    s.entry_path,
                    s.realpath,
                    s.is_symlink as i32,
                    s.source_id,
                    s.runtime,
                    s.scope,
                    s.origin,
                    s.access,
                    s.project_root,
                    s.content_hash,
                    s.entry_mtime_ms,
                    s.has_scripts as i32,
                    s.frontmatter_flags.to_string(),
                    serde_json::to_string(&s.tags).unwrap_or_else(|_| "[]".into()),
                    s.favorite as i32,
                    s.twin_group_id,
                    s.health_score,
                    s.indexed_at,
                    s.error,
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_skills_not_in(
        &self,
        source_id: &str,
        project_root: Option<&str>,
        keep_paths: &[String],
    ) -> Result<(), String> {
        let existing: Vec<(String, String)> = {
            let mut stmt = self
                .conn
                .prepare(
                    "SELECT id, dir_path FROM skills WHERE source_id=?1 AND IFNULL(project_root,'')=IFNULL(?2,'')",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![source_id, project_root], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };
        for (id, path) in existing {
            if !keep_paths.iter().any(|p| p.eq_ignore_ascii_case(&path)) {
                self.conn
                    .execute("DELETE FROM skills WHERE id=?1", params![id])
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    pub fn list_skills(&self, filter: &SkillFilter) -> Result<Vec<SkillRecord>, String> {
        let mut sql = String::from("SELECT * FROM skills WHERE 1=1");
        let mut args: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(q) = &filter.query {
            let like = format!("%{}%", q.to_lowercase());
            sql.push_str(" AND (lower(name) LIKE ? OR lower(description) LIKE ? OR lower(dir_path) LIKE ?)");
            args.push(Box::new(like.clone()));
            args.push(Box::new(like.clone()));
            args.push(Box::new(like));
        }
        if filter.twins_only.unwrap_or(false) {
            sql.push_str(" AND twin_group_id IS NOT NULL");
        }
        if filter.favorites_only.unwrap_or(false) {
            sql.push_str(" AND favorite=1");
        }
        if let Some(v) = filter.has_scripts {
            sql.push_str(" AND has_scripts=?");
            args.push(Box::new(v as i32));
        }
        sql.push_str(" ORDER BY name COLLATE NOCASE, runtime");

        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            args.iter().map(|a| a.as_ref()).collect();
        let rows = stmt
            .query_map(params_ref.as_slice(), |row| Self::map_skill(row))
            .map_err(|e| e.to_string())?;

        let mut out = Vec::new();
        for r in rows.flatten() {
            if let Some(runtimes) = &filter.runtimes {
                if !runtimes.is_empty() && !runtimes.iter().any(|x| x == &r.runtime) {
                    continue;
                }
            }
            if let Some(scopes) = &filter.scopes {
                if !scopes.is_empty() && !scopes.iter().any(|x| x == &r.scope) {
                    continue;
                }
            }
            if let Some(origins) = &filter.origins {
                if !origins.is_empty() && !origins.iter().any(|x| x == &r.origin) {
                    continue;
                }
            }
            if let Some(sources) = &filter.source_ids {
                if !sources.is_empty() && !sources.iter().any(|x| x == &r.source_id) {
                    continue;
                }
            }
            if let Some(tag) = &filter.tag {
                let tag = tag.trim();
                if !tag.is_empty() && !r.tags.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
                    continue;
                }
            }
            out.push(r);
        }
        Ok(out)
    }

    pub fn get_skill(&self, id: &str) -> Result<Option<SkillRecord>, String> {
        self.conn
            .query_row("SELECT * FROM skills WHERE id=?1", params![id], |row| {
                Self::map_skill(row)
            })
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn get_skill_by_path(&self, path: &str) -> Result<Option<SkillRecord>, String> {
        self.conn
            .query_row(
                "SELECT * FROM skills WHERE dir_path=?1 COLLATE NOCASE",
                params![path],
                |row| Self::map_skill(row),
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn skills_by_name(&self, name: &str) -> Result<Vec<SkillRecord>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT * FROM skills WHERE lower(name)=lower(?1)")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![name], |row| Self::map_skill(row))
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn all_skills(&self) -> Result<Vec<SkillRecord>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT * FROM skills")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Self::map_skill(row))
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn delete_skill_id(&self, id: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM skills WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn set_favorite(&self, id: &str, favorite: bool) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE skills SET favorite=?1 WHERE id=?2",
                params![favorite as i32, id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn set_tags(&self, id: &str, tags: &[String]) -> Result<(), String> {
        let mut cleaned: Vec<String> = tags
            .iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
        cleaned.sort();
        cleaned.dedup();
        self.conn
            .execute(
                "UPDATE skills SET tags_json=?1 WHERE id=?2",
                params![
                    serde_json::to_string(&cleaned).unwrap_or_else(|_| "[]".into()),
                    id
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_tags(&self) -> Result<Vec<String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT tags_json FROM skills")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let raw: String = row.get(0)?;
                Ok(raw)
            })
            .map_err(|e| e.to_string())?;
        let mut set = std::collections::BTreeSet::new();
        for raw in rows.flatten() {
            let tags: Vec<String> = serde_json::from_str(&raw).unwrap_or_default();
            for t in tags {
                let t = t.trim().to_string();
                if !t.is_empty() {
                    set.insert(t);
                }
            }
        }
        Ok(set.into_iter().collect())
    }

    pub fn clear_twin_groups(&self) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM twin_groups", [])
            .map_err(|e| e.to_string())?;
        self.conn
            .execute("UPDATE skills SET twin_group_id=NULL", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn save_twin_group(&self, g: &TwinGroup) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT OR REPLACE INTO twin_groups (id, key_type, key, status, skill_ids_json) VALUES (?1,?2,?3,?4,?5)",
                params![
                    g.id,
                    g.key_type,
                    g.key,
                    g.status,
                    serde_json::to_string(&g.skill_ids).unwrap_or_else(|_| "[]".into())
                ],
            )
            .map_err(|e| e.to_string())?;
        for sid in &g.skill_ids {
            self.conn
                .execute(
                    "UPDATE skills SET twin_group_id=?1 WHERE id=?2",
                    params![g.id, sid],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn list_twin_groups(&self) -> Result<Vec<TwinGroup>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, key_type, key, status, skill_ids_json FROM twin_groups")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let ids: String = row.get(4)?;
                Ok(TwinGroup {
                    id: row.get(0)?,
                    key_type: row.get(1)?,
                    key: row.get(2)?,
                    status: row.get(3)?,
                    skill_ids: serde_json::from_str(&ids).unwrap_or_default(),
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn source_counts(&self) -> Result<HashMap<String, usize>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT source_id, COUNT(*) FROM skills GROUP BY source_id")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize)))
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn list_projects(&self) -> Result<Vec<ProjectRoot>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, path, display_name, last_used_at FROM project_roots ORDER BY last_used_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ProjectRoot {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    display_name: row.get(2)?,
                    last_used_at: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn upsert_project(&self, p: &ProjectRoot) -> Result<(), String> {
        self.conn
            .execute(
                r#"
INSERT INTO project_roots (id, path, display_name, last_used_at)
VALUES (?1,?2,?3,?4)
ON CONFLICT(path) DO UPDATE SET display_name=excluded.display_name, last_used_at=excluded.last_used_at
"#,
                params![p.id, p.path, p.display_name, p.last_used_at],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_project(&self, path: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM project_roots WHERE path=?1", params![path])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_bundles(&self) -> Result<Vec<Bundle>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, name, description, items_json, default_runtimes_json, created_at, updated_at, version FROM bundles ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Self::map_bundle(row))
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn get_bundle(&self, id: &str) -> Result<Option<Bundle>, String> {
        self.conn
            .query_row(
                "SELECT id, name, description, items_json, default_runtimes_json, created_at, updated_at, version FROM bundles WHERE id=?1",
                params![id],
                |row| Self::map_bundle(row),
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn save_bundle(&self, b: &Bundle) -> Result<(), String> {
        self.conn
            .execute(
                r#"
INSERT INTO bundles (id, name, description, items_json, default_runtimes_json, created_at, updated_at, version)
VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  description=excluded.description,
  items_json=excluded.items_json,
  default_runtimes_json=excluded.default_runtimes_json,
  updated_at=excluded.updated_at,
  version=excluded.version
"#,
                params![
                    b.id,
                    b.name,
                    b.description,
                    serde_json::to_string(&b.items).map_err(|e| e.to_string())?,
                    serde_json::to_string(&b.default_runtimes).map_err(|e| e.to_string())?,
                    b.created_at,
                    b.updated_at,
                    b.version,
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_bundle(&self, id: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM bundles WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn add_oplog(&self, e: &OpLogEntry) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO op_log (id, ts, op, status, sources_json, targets_json, detail_json) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![
                    e.id,
                    e.ts,
                    e.op,
                    e.status,
                    serde_json::to_string(&e.sources).unwrap_or_else(|_| "[]".into()),
                    serde_json::to_string(&e.targets).unwrap_or_else(|_| "[]".into()),
                    e.detail.to_string(),
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_oplog(&self, limit: i64) -> Result<Vec<OpLogEntry>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, ts, op, status, sources_json, targets_json, detail_json FROM op_log ORDER BY ts DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |row| {
                let sources: String = row.get(4)?;
                let targets: String = row.get(5)?;
                let detail: String = row.get(6)?;
                Ok(OpLogEntry {
                    id: row.get(0)?,
                    ts: row.get(1)?,
                    op: row.get(2)?,
                    status: row.get(3)?,
                    sources: serde_json::from_str(&sources).unwrap_or_default(),
                    targets: serde_json::from_str(&targets).unwrap_or_default(),
                    detail: serde_json::from_str(&detail).unwrap_or(serde_json::json!({})),
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        self.conn
            .query_row(
                "SELECT value FROM settings WHERE key=?1",
                params![key],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO settings (key, value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                params![key, value],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn bundles_referencing_skill(&self, skill_id: &str, name: &str) -> Result<Vec<String>, String> {
        let bundles = self.list_bundles()?;
        let mut names = Vec::new();
        for b in bundles {
            for item in &b.items {
                let hit = match &item.skill_ref {
                    SkillRef::Id { value } => value == skill_id,
                    SkillRef::NameHash { name: n, .. } => n.eq_ignore_ascii_case(name),
                };
                if hit {
                    names.push(b.name.clone());
                    break;
                }
            }
        }
        Ok(names)
    }

    fn map_skill(row: &rusqlite::Row<'_>) -> rusqlite::Result<SkillRecord> {
        let frontmatter: String = row.get(16)?;
        let tags: String = row.get(17)?;
        Ok(SkillRecord {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            dir_path: row.get(3)?,
            entry_path: row.get(4)?,
            realpath: row.get(5)?,
            is_symlink: row.get::<_, i32>(6)? != 0,
            source_id: row.get(7)?,
            runtime: row.get(8)?,
            scope: row.get(9)?,
            origin: row.get(10)?,
            access: row.get(11)?,
            project_root: row.get(12)?,
            content_hash: row.get(13)?,
            entry_mtime_ms: row.get(14)?,
            has_scripts: row.get::<_, i32>(15)? != 0,
            frontmatter_flags: serde_json::from_str(&frontmatter).unwrap_or(serde_json::json!({})),
            tags: serde_json::from_str(&tags).unwrap_or_default(),
            favorite: row.get::<_, i32>(18)? != 0,
            twin_group_id: row.get(19)?,
            health_score: row.get(20)?,
            indexed_at: row.get(21)?,
            error: row.get(22)?,
            last_used_at: row.get(23).ok().flatten(),
        })
    }

    pub fn touch_last_used(&self, ids: &[String]) -> Result<(), String> {
        let ts = crate::indexer::now_ms();
        for id in ids {
            self.conn
                .execute(
                    "UPDATE skills SET last_used_at=?1 WHERE id=?2",
                    params![ts, id],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn list_favorites(&self, limit: i64) -> Result<Vec<SkillRecord>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT * FROM skills WHERE favorite=1 ORDER BY name COLLATE NOCASE LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |row| Self::map_skill(row))
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn list_recent(&self, limit: i64) -> Result<Vec<SkillRecord>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT * FROM skills WHERE last_used_at IS NOT NULL ORDER BY last_used_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |row| Self::map_skill(row))
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn record_content_history(
        &self,
        skill_id: &str,
        skill_name: &str,
        content_hash: &str,
        event: &str,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO content_history (id, skill_id, skill_name, content_hash, event, ts) VALUES (?1,?2,?3,?4,?5,?6)",
                params![
                    uuid::Uuid::new_v4().to_string(),
                    skill_id,
                    skill_name,
                    content_hash,
                    event,
                    crate::indexer::now_ms()
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn latest_content_hash(&self, skill_id: &str) -> Result<Option<String>, String> {
        self.conn
            .query_row(
                "SELECT content_hash FROM content_history WHERE skill_id=?1 ORDER BY ts DESC LIMIT 1",
                params![skill_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn list_content_history(
        &self,
        skill_id: &str,
        limit: i64,
    ) -> Result<Vec<ContentHistoryEntry>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, skill_id, skill_name, content_hash, event, ts FROM content_history WHERE skill_id=?1 ORDER BY ts DESC LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![skill_id, limit], |row| {
                Ok(ContentHistoryEntry {
                    id: row.get(0)?,
                    skill_id: row.get(1)?,
                    skill_name: row.get(2)?,
                    content_hash: row.get(3)?,
                    event: row.get(4)?,
                    ts: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    fn map_bundle(row: &rusqlite::Row<'_>) -> rusqlite::Result<Bundle> {
        let items: String = row.get(3)?;
        let runtimes: String = row.get(4)?;
        Ok(Bundle {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            items: serde_json::from_str(&items).unwrap_or_default(),
            default_runtimes: serde_json::from_str(&runtimes).unwrap_or_default(),
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
            version: row.get(7)?,
        })
    }
}
