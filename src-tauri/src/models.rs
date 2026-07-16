use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub dir_path: String,
    pub entry_path: String,
    pub realpath: String,
    pub is_symlink: bool,
    pub source_id: String,
    pub runtime: String,
    pub scope: String,
    pub origin: String,
    pub access: String,
    pub project_root: Option<String>,
    pub content_hash: String,
    pub entry_mtime_ms: i64,
    pub has_scripts: bool,
    pub frontmatter_flags: serde_json::Value,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub twin_group_id: Option<String>,
    pub health_score: Option<f64>,
    pub last_used_at: Option<i64>,
    pub indexed_at: i64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDetail {
    pub skill: SkillRecord,
    pub body_markdown: String,
    pub frontmatter_raw: String,
    pub outline: Vec<OutlineHeading>,
    pub files: Vec<String>,
    pub twins: Vec<SkillRecord>,
    pub health: Option<HealthReport>,
    #[serde(default)]
    pub script_risks: Vec<ScriptRiskFinding>,
    #[serde(default)]
    pub content_history: Vec<ContentHistoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineHeading {
    pub level: u8,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TwinGroup {
    pub id: String,
    pub key_type: String,
    pub key: String,
    pub status: String,
    pub skill_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRoot {
    pub id: String,
    pub path: String,
    pub display_name: String,
    pub last_used_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub items: Vec<BundleItem>,
    pub default_runtimes: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub version: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleItem {
    pub skill_ref: SkillRef,
    pub optional: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "by")]
pub enum SkillRef {
    #[serde(rename = "id")]
    Id { value: String },
    #[serde(rename = "name+hash")]
    NameHash {
        name: String,
        #[serde(rename = "contentHash")]
        content_hash: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpLogEntry {
    pub id: String,
    pub ts: i64,
    pub op: String,
    pub status: String,
    pub sources: Vec<String>,
    pub targets: Vec<String>,
    pub detail: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub id: String,
    pub label: String,
    pub runtime: String,
    pub scope: String,
    pub origin: String,
    pub access: String,
    pub enabled: bool,
    pub path_patterns: Vec<String>,
    pub resolved_roots: Vec<String>,
    pub skill_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFilter {
    pub query: Option<String>,
    pub runtimes: Option<Vec<String>>,
    pub scopes: Option<Vec<String>>,
    pub origins: Option<Vec<String>>,
    pub source_ids: Option<Vec<String>>,
    pub has_scripts: Option<bool>,
    pub twins_only: Option<bool>,
    pub favorites_only: Option<bool>,
    pub tag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TwinDiff {
    pub left_id: String,
    pub right_id: String,
    pub left_label: String,
    pub right_label: String,
    pub identical: bool,
    pub diff: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyPlanItem {
    pub skill_id: String,
    pub skill_name: String,
    pub source_path: String,
    pub target_path: String,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyPreview {
    pub items: Vec<CopyPlanItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub multi_runtime_sync: bool,
    pub conflict_policy: String,
    pub also_write_native_cursor: bool,
    pub target_project: Option<String>,
    pub enabled_source_ids: Vec<String>,
    pub write_runtimes: Vec<String>,
    #[serde(default = "default_policy_template")]
    pub policy_template_id: String,
    #[serde(default)]
    pub block_plugin_copy_to_project: bool,
}

fn default_policy_template() -> String {
    "balanced".into()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            multi_runtime_sync: false,
            conflict_policy: "overwrite".into(),
            also_write_native_cursor: true,
            target_project: None,
            enabled_source_ids: Vec::new(),
            write_runtimes: vec!["agents".into(), "claude".into()],
            policy_template_id: "balanced".into(),
            block_plugin_copy_to_project: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub conflict_policy: String,
    pub block_plugin_copy_to_project: bool,
    pub prefer_project_over_global: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportArtifact {
    pub filename: String,
    pub base64: String,
    pub skill_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptRiskFinding {
    pub rule_id: String,
    pub severity: String,
    pub file: String,
    pub line: u32,
    pub snippet: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentHistoryEntry {
    pub id: String,
    pub skill_id: String,
    pub skill_name: String,
    pub content_hash: String,
    pub event: String,
    pub ts: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageInsights {
    pub favorites: Vec<SkillRecord>,
    pub recent: Vec<SkillRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceConfigFile {
    pub version: i32,
    pub sources: Vec<SourceConfigEntry>,
    #[serde(default)]
    pub write_targets: serde_json::Value,
    #[serde(default)]
    pub readonly_policy: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceConfigEntry {
    pub id: String,
    pub label: String,
    pub runtime: String,
    pub scope: String,
    pub origin: String,
    pub access: String,
    #[serde(default = "default_true")]
    pub enabled_by_default: bool,
    pub path_patterns: Vec<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
pub struct SkillFrontmatter {
    pub name: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "disable-model-invocation")]
    pub disable_model_invocation: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthIssue {
    pub rule_id: String,
    pub severity: String,
    pub message: String,
    pub fix_hint: Option<String>,
    pub auto_fix: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthReport {
    pub skill_id: String,
    pub skill_name: String,
    pub score: f64,
    pub grade: String,
    pub issues: Vec<HealthIssue>,
    pub content_hash: String,
    #[serde(default)]
    pub registry: Option<RegistrySyncInfo>,
    #[serde(default)]
    pub dir_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrySyncInfo {
    /// matched | diverged | untracked | no_lock | unsupported | fetch_failed
    pub status: String,
    pub source: Option<String>,
    pub source_url: Option<String>,
    pub lock_folder_hash: Option<String>,
    pub local_skill_md_hash: String,
    pub remote_skill_md_hash: Option<String>,
    pub remote_fetched_url: Option<String>,
    pub diff: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProfile {
    pub path: String,
    pub stacks: Vec<String>,
    pub recommendations: Vec<BundleRecommendation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleRecommendation {
    pub title: String,
    pub reason: String,
    pub skill_names: Vec<String>,
    pub matched_skill_ids: Vec<String>,
    pub missing_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryCommandResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}
