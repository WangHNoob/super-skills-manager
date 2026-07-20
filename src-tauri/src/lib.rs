mod bundles;
mod db;
mod error;
mod hashutil;
mod health;
mod indexer;
mod models;
mod ops;
mod packaging;
mod policy;
mod project;
mod registry;
mod registry_compare;
mod script_risk;
mod sources;

use db::Db;
use error::{AppError, CmdResult};
use indexer::{full_scan, list_skill_files, now_ms, outline_from_markdown, parse_skill_md};
use models::*;
use parking_lot::Mutex;
use sources::{build_source_infos, default_enabled_ids, load_source_config, normalize_path};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use tauri::{AppHandle, Manager, State};

enum WatchControl {
    Rebuild,
}

pub struct AppState {
    pub db: Mutex<Db>,
    pub config: SourceConfigFile,
    pub settings: Mutex<AppSettings>,
    /// 文件变更脏标记：由 watcher 置位，节流线程合并触发 rescan
    pub scan_dirty: AtomicBool,
    watch_tx: Mutex<Option<Sender<WatchControl>>>,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())
}

fn load_settings(db: &Db, cfg: &SourceConfigFile) -> AppSettings {
    let mut s = AppSettings::default();
    s.enabled_source_ids = default_enabled_ids(cfg);
    if let Ok(Some(v)) = db.get_setting("settings") {
        if let Ok(parsed) = serde_json::from_str::<AppSettings>(&v) {
            s = parsed;
            if s.enabled_source_ids.is_empty() {
                s.enabled_source_ids = default_enabled_ids(cfg);
            }
        }
    }
    s
}

fn save_settings(db: &Db, settings: &AppSettings) -> Result<(), String> {
    db.set_setting(
        "settings",
        &serde_json::to_string(settings).map_err(|e| e.to_string())?,
    )
}

fn project_paths(db: &Db) -> Result<Vec<String>, String> {
    Ok(db.list_projects()?.into_iter().map(|p| p.path).collect())
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> AppSettings {
    state.settings.lock().clone()
}

#[tauri::command]
fn update_settings(state: State<AppState>, settings: AppSettings) -> CmdResult<AppSettings> {
    {
        let db = state.db.lock();
        save_settings(&db, &settings).map_err(AppError::from)?;
    }
    *state.settings.lock() = settings.clone();
    request_watch_rebuild(&state);
    Ok(settings)
}

#[tauri::command]
fn list_skills(state: State<AppState>, filter: SkillFilter) -> Result<Vec<SkillRecord>, String> {
    state.db.lock().list_skills(&filter)
}

#[tauri::command]
fn get_skill_detail(state: State<AppState>, id: String) -> Result<SkillDetail, String> {
    let db = state.db.lock();
    let skill = db
        .get_skill(&id)?
        .ok_or_else(|| "skill 不存在".to_string())?;
    let text = fs::read_to_string(&skill.entry_path).unwrap_or_default();
    let (_fm, frontmatter_raw, body_markdown) = parse_skill_md(&text);
    let outline = outline_from_markdown(&body_markdown);
    let files = list_skill_files(std::path::Path::new(&skill.dir_path));
    let twins = if let Some(gid) = &skill.twin_group_id {
        db.list_twin_groups()?
            .into_iter()
            .find(|g| &g.id == gid)
            .map(|g| {
                g.skill_ids
                    .into_iter()
                    .filter_map(|sid| db.get_skill(&sid).ok().flatten())
                    .filter(|s| s.id != skill.id)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let health = db.get_health_report(&id).ok().flatten();
    let script_risks = script_risk::scan_script_risks(std::path::Path::new(&skill.dir_path));
    let content_history = db.list_content_history(&id, 20).unwrap_or_default();
    Ok(SkillDetail {
        skill,
        body_markdown,
        frontmatter_raw,
        outline,
        files,
        twins,
        health,
        script_risks,
        content_history,
    })
}

/// 装机决策卡：description + H2 大纲 + 健康风险；可选 registry 对照（过期徽章）。
#[tauri::command]
fn get_skill_decision_brief(
    state: State<AppState>,
    id: String,
    include_registry: Option<bool>,
) -> Result<SkillDecisionBrief, String> {
    let want_registry = include_registry.unwrap_or(false);
    let (skill, health) = {
        let db = state.db.lock();
        let skill = db
            .get_skill(&id)?
            .ok_or_else(|| "skill 不存在".to_string())?;
        let health = db.get_health_report(&id).ok().flatten();
        (skill, health)
    };
    let text = fs::read_to_string(&skill.entry_path).unwrap_or_default();
    let (_fm, _raw, body) = parse_skill_md(&text);
    let outline: Vec<_> = outline_from_markdown(&body)
        .into_iter()
        .filter(|h| h.level <= 2)
        .take(8)
        .collect();
    let description = skill.description.trim().to_string();
    let description_missing = description.is_empty();
    let registry = if want_registry {
        let info = crate::registry_compare::compare_skill_to_registry(
            &skill.name,
            std::path::Path::new(&skill.dir_path),
        );
        // 仅锁文件中的 skill 暴露对照；手写/未跟踪不标过期
        match info.status.as_str() {
            "untracked" | "no_lock" => None,
            _ => Some(info),
        }
    } else {
        health.as_ref().and_then(|h| h.registry.clone())
    };
    Ok(SkillDecisionBrief {
        skill_id: skill.id,
        name: skill.name,
        description,
        description_missing,
        outline,
        health,
        registry,
    })
}

#[tauri::command]
fn scan_now(state: State<AppState>) -> CmdResult<usize> {
    let settings = state.settings.lock().clone();
    let enabled: HashSet<String> = settings.enabled_source_ids.into_iter().collect();
    let projects = {
        let db = state.db.lock();
        project_paths(&db).map_err(AppError::from)?
    };
    full_scan(&state.db, &state.config, &enabled, &projects).map_err(AppError::from)
}

#[tauri::command]
fn list_sources(state: State<AppState>) -> Result<Vec<SourceInfo>, String> {
    let settings = state.settings.lock().clone();
    let enabled: HashSet<String> = settings.enabled_source_ids.into_iter().collect();
    let db = state.db.lock();
    let projects = project_paths(&db)?;
    let counts = db.source_counts()?;
    Ok(build_source_infos(
        &state.config,
        &enabled,
        &projects,
        &counts,
    ))
}

#[tauri::command]
fn list_twin_groups(state: State<AppState>) -> Result<Vec<TwinGroup>, String> {
    state.db.lock().list_twin_groups()
}

#[tauri::command]
fn list_projects(state: State<AppState>) -> Result<Vec<ProjectRoot>, String> {
    state.db.lock().list_projects()
}

#[tauri::command]
fn add_project(state: State<AppState>, path: String) -> CmdResult<ProjectRoot> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err(AppError::invalid("路径不是目录"));
    }
    let norm = normalize_path(&p);
    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| norm.clone());
    let project = ProjectRoot {
        id: uuid::Uuid::new_v4().to_string(),
        path: norm,
        display_name: name,
        last_used_at: now_ms(),
    };
    let settings = state.settings.lock().clone();
    let enabled: HashSet<String> = settings.enabled_source_ids.into_iter().collect();
    {
        let db = state.db.lock();
        db.upsert_project(&project).map_err(AppError::from)?;
    }
    let projects = {
        let db = state.db.lock();
        project_paths(&db).map_err(AppError::from)?
    };
    let _ = full_scan(&state.db, &state.config, &enabled, &projects);
    request_watch_rebuild(&state);
    Ok(project)
}

#[tauri::command]
fn remove_project(state: State<AppState>, path: String) -> CmdResult<()> {
    state
        .db
        .lock()
        .remove_project(&path)
        .map_err(AppError::from)?;
    request_watch_rebuild(&state);
    Ok(())
}

#[tauri::command]
fn set_target_project(state: State<AppState>, path: String) -> CmdResult<AppSettings> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err(AppError::invalid("路径不是目录"));
    }
    let norm = normalize_path(&p);
    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| norm.clone());
    {
        let db = state.db.lock();
        db.upsert_project(&ProjectRoot {
            id: uuid::Uuid::new_v4().to_string(),
            path: norm.clone(),
            display_name: name,
            last_used_at: now_ms(),
        })
        .map_err(AppError::from)?;
    }
    let mut settings = state.settings.lock().clone();
    settings.target_project = Some(norm);
    {
        let db = state.db.lock();
        save_settings(&db, &settings).map_err(AppError::from)?;
    }
    *state.settings.lock() = settings.clone();
    request_watch_rebuild(&state);
    Ok(settings)
}

#[tauri::command]
fn preview_copy_skills(
    state: State<AppState>,
    skill_ids: Vec<String>,
    project: String,
    runtimes: Vec<String>,
    conflict_policy: String,
    also_write_native_cursor: Option<bool>,
) -> Result<CopyPreview, String> {
    let settings = state.settings.lock().clone();
    let also = also_write_native_cursor.unwrap_or(settings.also_write_native_cursor);
    let block = settings.block_plugin_copy_to_project;
    let policy = if conflict_policy.is_empty() {
        policy::resolve_conflict_policy(&settings)
    } else {
        conflict_policy
    };
    ops::preview_copy(
        &state.db.lock(),
        &skill_ids,
        &project,
        &runtimes,
        &policy,
        also,
        block,
    )
}

#[tauri::command]
fn execute_copy_skills(
    state: State<AppState>,
    preview: CopyPreview,
    conflict_policy: String,
) -> Result<OpLogEntry, String> {
    let entry = {
        let db = state.db.lock();
        ops::execute_copy(&db, &preview, &conflict_policy)?
    };
    rescan(&state)?;
    Ok(entry)
}

#[tauri::command]
fn delete_impact(state: State<AppState>, skill_ids: Vec<String>) -> Result<serde_json::Value, String> {
    ops::resolve_delete_impact(&state.db.lock(), &skill_ids)
}

#[tauri::command]
fn delete_skills_cmd(state: State<AppState>, skill_ids: Vec<String>) -> Result<OpLogEntry, String> {
    let entry = ops::delete_skills(&state.db.lock(), &skill_ids)?;
    Ok(entry)
}

/// 从系统回收站恢复此前删除的技能目录，并重新索引。
#[tauri::command]
fn restore_skills_cmd(state: State<AppState>, paths: Vec<String>) -> Result<OpLogEntry, String> {
    let entry = ops::restore_skills(&state.db.lock(), &paths)?;
    // 恢复后磁盘上重新出现目录，触发一次 rescan 把它们重新纳入索引
    let _ = rescan(&state);
    Ok(entry)
}

#[tauri::command]
fn extract_skill(state: State<AppState>, skill_id: String) -> Result<OpLogEntry, String> {
    let entry = ops::extract_copy(&state.db.lock(), &skill_id)?;
    rescan(&state)?;
    Ok(entry)
}

#[tauri::command]
fn sync_twin_skills(
    state: State<AppState>,
    source_id: String,
    target_id: String,
) -> Result<OpLogEntry, String> {
    ops::sync_twin(
        &state.db.lock(),
        &source_id,
        &target_id,
        &state.config.sources,
    )
}

#[tauri::command]
fn diff_twin_skills(
    state: State<AppState>,
    left_id: String,
    right_id: String,
) -> Result<crate::models::TwinDiff, String> {
    ops::diff_twins(&state.db.lock(), &left_id, &right_id)
}

#[tauri::command]
fn set_skill_tags(
    state: State<AppState>,
    id: String,
    tags: Vec<String>,
) -> Result<(), String> {
    state.db.lock().set_tags(&id, &tags)
}

#[tauri::command]
fn list_skill_tags(state: State<AppState>) -> Result<Vec<String>, String> {
    state.db.lock().list_tags()
}

#[tauri::command]
fn list_bundles(state: State<AppState>) -> Result<Vec<Bundle>, String> {
    state.db.lock().list_bundles()
}

#[tauri::command]
fn create_bundle_cmd(
    state: State<AppState>,
    name: String,
    description: Option<String>,
    skill_ids: Vec<String>,
    default_runtimes: Vec<String>,
) -> Result<Bundle, String> {
    bundles::create_bundle(
        &state.db.lock(),
        name,
        description,
        skill_ids,
        default_runtimes,
    )
}

#[tauri::command]
fn delete_bundle_cmd(state: State<AppState>, id: String) -> Result<(), String> {
    state.db.lock().delete_bundle(&id)
}

#[tauri::command]
fn apply_bundle_cmd(
    state: State<AppState>,
    bundle_id: String,
    project: String,
    runtimes: Option<Vec<String>>,
    conflict_policy: String,
) -> Result<OpLogEntry, String> {
    let also = state.settings.lock().also_write_native_cursor;
    let entry = bundles::apply_bundle(
        &state.db.lock(),
        &bundle_id,
        &project,
        runtimes,
        &conflict_policy,
        also,
    )?;
    rescan(&state)?;
    Ok(entry)
}

#[tauri::command]
fn import_bundle_cmd(state: State<AppState>, json: String) -> Result<Bundle, String> {
    bundles::import_bundle(&state.db.lock(), &json)
}

#[tauri::command]
fn update_bundle_cmd(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    description: Option<Option<String>>,
    skill_ids: Vec<String>,
    default_runtimes: Option<Vec<String>>,
) -> Result<Bundle, String> {
    bundles::update_bundle(
        &state.db.lock(),
        &id,
        name,
        description,
        skill_ids,
        default_runtimes,
    )
}

#[tauri::command]
fn preview_bundle_cmd(
    state: State<AppState>,
    bundle_id: String,
    project: String,
    runtimes: Option<Vec<String>>,
    conflict_policy: String,
) -> Result<serde_json::Value, String> {
    let also = state.settings.lock().also_write_native_cursor;
    let (preview, ids, missing) = bundles::preview_bundle(
        &state.db.lock(),
        &bundle_id,
        &project,
        runtimes,
        &conflict_policy,
        also,
    )?;
    Ok(serde_json::json!({
        "preview": preview,
        "resolvedIds": ids,
        "missing": missing
    }))
}

#[tauri::command]
fn export_bundle_cmd(state: State<AppState>, id: String) -> Result<String, String> {
    bundles::export_bundle(&state.db.lock(), &id)
}

#[tauri::command]
fn list_oplog(state: State<AppState>, limit: Option<i64>) -> Result<Vec<OpLogEntry>, String> {
    state.db.lock().list_oplog(limit.unwrap_or(50))
}

#[tauri::command]
fn set_favorite(state: State<AppState>, id: String, favorite: bool) -> Result<(), String> {
    state.db.lock().set_favorite(&id, favorite)
}

fn request_watch_rebuild(state: &AppState) {
    if let Some(tx) = state.watch_tx.lock().as_ref() {
        let _ = tx.send(WatchControl::Rebuild);
    }
}

fn rescan(state: &AppState) -> Result<usize, String> {
    let settings = state.settings.lock().clone();
    let enabled: HashSet<String> = settings.enabled_source_ids.into_iter().collect();
    let projects = {
        let db = state.db.lock();
        project_paths(&db)?
    };
    // 扫描内部短锁；健康检查先快照再释放锁分析
    let n = full_scan(&state.db, &state.config, &enabled, &projects)?;
    // 自动扫描：走缓存、不做远端对照，避免串行网络阻塞
    let _ = health::run_health_for_all(&state.db, health::HealthRunOpts::default());
    Ok(n)
}

#[tauri::command]
fn run_health_scan(
    state: State<AppState>,
    force: Option<bool>,
    include_registry: Option<bool>,
) -> CmdResult<usize> {
    let opts = health::HealthRunOpts {
        force: force.unwrap_or(false),
        include_registry: include_registry.unwrap_or(false),
    };
    health::run_health_for_all(&state.db, opts).map_err(AppError::from)
}

#[tauri::command]
fn run_health_scan_scoped(
    state: State<AppState>,
    project: Option<String>,
    skill_ids: Option<Vec<String>>,
    force: Option<bool>,
    include_registry: Option<bool>,
) -> CmdResult<usize> {
    let opts = health::HealthRunOpts {
        force: force.unwrap_or(false),
        include_registry: include_registry.unwrap_or(false),
    };
    if let Some(ids) = skill_ids {
        if !ids.is_empty() {
            return health::run_health_for_ids(&state.db, &ids, opts).map_err(AppError::from);
        }
    }
    if let Some(p) = project {
        if !p.trim().is_empty() {
            return health::run_health_for_project(&state.db, p.trim(), opts)
                .map_err(AppError::from);
        }
    }
    health::run_health_for_all(&state.db, opts).map_err(AppError::from)
}

#[tauri::command]
fn scaffold_project(
    project: String,
    folders: Vec<String>,
) -> Result<ScaffoldResult, String> {
    project::scaffold_project(&project, &folders)
}

#[tauri::command]
fn get_health_report(state: State<AppState>, skill_id: String) -> Result<Option<HealthReport>, String> {
    health::get_report(&state.db.lock(), &skill_id)
}

#[tauri::command]
fn list_health_reports(
    state: State<AppState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<HealthReport>, String> {
    health::list_reports(&state.db.lock(), limit, offset)
}

#[tauri::command]
fn apply_health_fix(state: State<AppState>, skill_id: String, rule_id: String) -> Result<SkillRecord, String> {
    match rule_id.as_str() {
        "META003" => {
            let updated = health::apply_metafix_name(&state.db.lock(), &skill_id)?;
            Ok(updated)
        }
        _ => Err(format!("规则 {rule_id} 不支持自动修复")),
    }
}

#[tauri::command]
fn analyze_project(state: State<AppState>, path: String) -> Result<ProjectProfile, String> {
    project::recommend_for_project(&state.db.lock(), &path)
}

#[tauri::command]
fn create_bundle_from_recommendation(
    state: State<AppState>,
    title: String,
    skill_ids: Vec<String>,
) -> Result<Bundle, String> {
    let settings = state.settings.lock().clone();
    bundles::create_bundle(
        &state.db.lock(),
        title,
        Some("由项目就绪向导生成".into()),
        skill_ids,
        settings.write_runtimes,
    )
}

#[tauri::command]
fn registry_find(query: String) -> Result<RegistryCommandResult, String> {
    registry::find_skills(&query)
}

/// 打开交互终端执行 skills CLI（用户自行选择安装选项）。
#[tauri::command]
fn open_skills_cli_terminal(
    action: String,
    package_or_query: Option<String>,
    global: bool,
    project: Option<String>,
) -> Result<String, String> {
    let cwd = project.as_deref().map(PathBuf::from);
    registry::open_skills_action(
        &action,
        package_or_query.as_deref(),
        global,
        cwd.as_deref(),
    )
}

#[tauri::command]
fn registry_list(
    global: bool,
    project: Option<String>,
) -> CmdResult<RegistryCommandResult> {
    let cwd = project.as_deref().map(PathBuf::from);
    registry::list_installed(global, cwd.as_deref()).map_err(|e| {
        if e.starts_with("RegistryTimeout") {
            AppError::timeout(e)
        } else {
            AppError::from(e)
        }
    })
}

#[tauri::command]
fn registry_add(
    package: String,
    global: bool,
    agents: Vec<String>,
    skill: Option<String>,
    project: Option<String>,
) -> CmdResult<RegistryCommandResult> {
    let cwd = project.as_deref().map(PathBuf::from);
    registry::add_skill(
        &package,
        global,
        &agents,
        skill.as_deref(),
        cwd.as_deref(),
    )
    .map_err(|e| {
        if e.starts_with("RegistryTimeout") {
            AppError::timeout(e)
        } else {
            AppError::from(e)
        }
    })
}

#[tauri::command]
fn registry_update(
    global: bool,
    project: Option<String>,
) -> CmdResult<RegistryCommandResult> {
    let cwd = project.as_deref().map(PathBuf::from);
    registry::update_skills(global, cwd.as_deref()).map_err(|e| {
        if e.starts_with("RegistryTimeout") {
            AppError::timeout(e)
        } else {
            AppError::from(e)
        }
    })
}

#[tauri::command]
fn registry_remove(
    name: String,
    global: bool,
    project: Option<String>,
) -> CmdResult<RegistryCommandResult> {
    let cwd = project.as_deref().map(PathBuf::from);
    registry::remove_skill(&name, global, cwd.as_deref()).map_err(|e| {
        if e.starts_with("RegistryTimeout") {
            AppError::timeout(e)
        } else {
            AppError::from(e)
        }
    })
}

fn open_path_impl(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    open_path_impl(&path)
}

#[tauri::command]
fn list_policy_templates() -> Vec<PolicyTemplate> {
    policy::builtin_templates()
}

#[tauri::command]
fn apply_policy_template(
    state: State<AppState>,
    template_id: String,
) -> Result<AppSettings, String> {
    let mut settings = state.settings.lock().clone();
    policy::apply_template(&mut settings, &template_id)?;
    {
        let db = state.db.lock();
        save_settings(&db, &settings)?;
    }
    *state.settings.lock() = settings.clone();
    Ok(settings)
}

#[tauri::command]
fn export_skills_zip_cmd(
    state: State<AppState>,
    skill_ids: Vec<String>,
) -> Result<ExportArtifact, String> {
    packaging::export_skills_zip(&state.db.lock(), &skill_ids)
}

#[tauri::command]
fn import_skills_zip_cmd(
    state: State<AppState>,
    zip_base64: String,
    target_root: Option<String>,
) -> Result<OpLogEntry, String> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let target = target_root.unwrap_or_else(|| {
        home.join(".agents")
            .join("skills")
            .to_string_lossy()
            .to_string()
    });
    let source = state
        .config
        .sources
        .iter()
        .find(|s| s.id == "agents-global-user")
        .cloned()
        .unwrap_or(SourceConfigEntry {
            id: "agents-global-user".into(),
            label: "Agents".into(),
            runtime: "agents".into(),
            scope: "global".into(),
            origin: "local".into(),
            access: "readwrite".into(),
            enabled_by_default: true,
            path_patterns: vec![],
            notes: None,
        });
    let entry = packaging::import_skills_zip(&state.db.lock(), &zip_base64, &target, &source)?;
    let _ = rescan(&state);
    Ok(entry)
}

#[tauri::command]
fn get_usage_insights(state: State<AppState>) -> Result<UsageInsights, String> {
    let db = state.db.lock();
    Ok(UsageInsights {
        favorites: db.list_favorites(50)?,
        recent: db.list_recent(30)?,
    })
}

#[tauri::command]
fn list_content_history_cmd(
    state: State<AppState>,
    skill_id: String,
) -> Result<Vec<ContentHistoryEntry>, String> {
    state.db.lock().list_content_history(&skill_id, 30)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = data_dir(&app.handle())?;
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

            // 日志落到 app_data_dir/ssm.log
            let file_appender = tracing_appender::rolling::never(&dir, "ssm.log");
            let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);
            // 保持 guard 存活：泄漏到进程生命周期即可
            std::mem::forget(_guard);
            let _ = tracing_subscriber::fmt()
                .with_env_filter(
                    tracing_subscriber::EnvFilter::try_from_default_env()
                        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
                )
                .with_writer(non_blocking)
                .with_ansi(false)
                .try_init();

            let db_path = dir.join("ssm.db");
            let db = Db::open(&db_path)?;
            let config = load_source_config();
            let settings = load_settings(&db, &config);
            let (watch_tx, watch_rx) = mpsc::channel::<WatchControl>();
            let state = AppState {
                db: Mutex::new(db),
                config,
                settings: Mutex::new(settings.clone()),
                scan_dirty: AtomicBool::new(false),
                watch_tx: Mutex::new(Some(watch_tx)),
            };
            app.manage(state);

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Some(st) = handle.try_state::<AppState>() {
                    tracing::info!("initial rescan starting");
                    match rescan(&st) {
                        Ok(n) => tracing::info!(skills = n, "initial rescan done"),
                        Err(e) => tracing::error!(error = %e, "initial rescan failed"),
                    }
                }
            });

            // 文件监听：脏标记 + 2s 节流合并扫描；支持动态重建 watch 集合
            let watch_handle = app.handle().clone();
            std::thread::spawn(move || {
                use notify::RecursiveMode;
                use notify_debouncer_mini::{new_debouncer, DebounceEventResult};
                use std::time::Duration;

                let (fs_tx, fs_rx) = mpsc::channel::<DebounceEventResult>();
                let mut debouncer = match new_debouncer(Duration::from_millis(500), fs_tx) {
                    Ok(d) => d,
                    Err(e) => {
                        tracing::warn!(error = %e, "file watcher unavailable");
                        return;
                    }
                };
                let mut watched: Vec<String> = Vec::new();

                let rebuild = |debouncer: &mut notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
                               watched: &mut Vec<String>,
                               st: &AppState| {
                    for old in watched.drain(..) {
                        let _ = debouncer
                            .watcher()
                            .unwatch(std::path::Path::new(&old));
                    }
                    let settings = st.settings.lock().clone();
                    let enabled: HashSet<String> =
                        settings.enabled_source_ids.iter().cloned().collect();
                    let projects = st
                        .db
                        .lock()
                        .list_projects()
                        .unwrap_or_default()
                        .into_iter()
                        .map(|p| p.path)
                        .collect::<Vec<_>>();
                    for src in &st.config.sources {
                        if !enabled.contains(&src.id) {
                            continue;
                        }
                        for root in sources::resolve_roots(src, &projects) {
                            if debouncer
                                .watcher()
                                .watch(std::path::Path::new(&root), RecursiveMode::Recursive)
                                .is_ok()
                            {
                                watched.push(root);
                            }
                        }
                    }
                    tracing::info!(count = watched.len(), "watch set rebuilt");
                    // 重建后兜底扫一次
                    st.scan_dirty.store(true, Ordering::SeqCst);
                };

                if let Some(st) = watch_handle.try_state::<AppState>() {
                    rebuild(&mut debouncer, &mut watched, &st);
                }

                loop {
                    // 合并 FS 事件与重建指令；空闲时每 2s 检查脏标记
                    let mut saw_fs = false;
                    loop {
                        match fs_rx.recv_timeout(Duration::from_millis(200)) {
                            Ok(Ok(_)) => saw_fs = true,
                            Ok(Err(_)) => {}
                            Err(mpsc::RecvTimeoutError::Timeout) => break,
                            Err(mpsc::RecvTimeoutError::Disconnected) => return,
                        }
                    }
                    while let Ok(msg) = watch_rx.try_recv() {
                        match msg {
                            WatchControl::Rebuild => {
                                if let Some(st) = watch_handle.try_state::<AppState>() {
                                    rebuild(&mut debouncer, &mut watched, &st);
                                }
                            }
                        }
                    }
                    if saw_fs {
                        if let Some(st) = watch_handle.try_state::<AppState>() {
                            st.scan_dirty.store(true, Ordering::SeqCst);
                        }
                    }

                    // 2s 节流：仅当脏时扫描
                    static LAST_SCAN: std::sync::OnceLock<Mutex<std::time::Instant>> =
                        std::sync::OnceLock::new();
                    let last = LAST_SCAN.get_or_init(|| Mutex::new(std::time::Instant::now()));
                    let due = {
                        let t = last.lock();
                        t.elapsed() >= Duration::from_secs(2)
                    };
                    if due {
                        if let Some(st) = watch_handle.try_state::<AppState>() {
                            if st.scan_dirty.swap(false, Ordering::SeqCst) {
                                match rescan(&st) {
                                    Ok(n) => tracing::info!(skills = n, "coalesced rescan done"),
                                    Err(e) => {
                                        tracing::error!(error = %e, "coalesced rescan failed")
                                    }
                                }
                                *last.lock() = std::time::Instant::now();
                            }
                        }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            update_settings,
            list_skills,
            get_skill_detail,
            get_skill_decision_brief,
            scan_now,
            list_sources,
            list_twin_groups,
            list_projects,
            add_project,
            remove_project,
            set_target_project,
            preview_copy_skills,
            execute_copy_skills,
            delete_impact,
            delete_skills_cmd,
            restore_skills_cmd,
            extract_skill,
            sync_twin_skills,
            diff_twin_skills,
            set_skill_tags,
            list_skill_tags,
            list_bundles,
            create_bundle_cmd,
            delete_bundle_cmd,
            apply_bundle_cmd,
            import_bundle_cmd,
            update_bundle_cmd,
            preview_bundle_cmd,
            export_bundle_cmd,
            list_oplog,
            set_favorite,
            reveal_in_explorer,
            run_health_scan,
            run_health_scan_scoped,
            scaffold_project,
            get_health_report,
            list_health_reports,
            apply_health_fix,
            analyze_project,
            create_bundle_from_recommendation,
            registry_find,
            open_skills_cli_terminal,
            registry_list,
            registry_add,
            registry_update,
            registry_remove,
            list_policy_templates,
            apply_policy_template,
            export_skills_zip_cmd,
            import_skills_zip_cmd,
            get_usage_insights,
            list_content_history_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
