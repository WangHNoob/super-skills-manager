mod bundles;
mod db;
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
use indexer::{full_scan, list_skill_files, now_ms, outline_from_markdown, parse_skill_md};
use models::*;
use parking_lot::Mutex;
use sources::{build_source_infos, default_enabled_ids, load_source_config, normalize_path};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

pub struct AppState {
    pub db: Mutex<Db>,
    pub config: SourceConfigFile,
    pub settings: Mutex<AppSettings>,
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
fn update_settings(state: State<AppState>, settings: AppSettings) -> Result<AppSettings, String> {
    {
        let db = state.db.lock();
        save_settings(&db, &settings)?;
    }
    *state.settings.lock() = settings.clone();
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

#[tauri::command]
fn scan_now(state: State<AppState>) -> Result<usize, String> {
    let settings = state.settings.lock().clone();
    let enabled: HashSet<String> = settings.enabled_source_ids.into_iter().collect();
    let db = state.db.lock();
    let projects = project_paths(&db)?;
    full_scan(&db, &state.config, &enabled, &projects)
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
fn add_project(state: State<AppState>, path: String) -> Result<ProjectRoot, String> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err("路径不是目录".into());
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
        db.upsert_project(&project)?;
        let projects = project_paths(&db)?;
        let _ = full_scan(&db, &state.config, &enabled, &projects);
    }
    Ok(project)
}

#[tauri::command]
fn remove_project(state: State<AppState>, path: String) -> Result<(), String> {
    state.db.lock().remove_project(&path)
}

#[tauri::command]
fn set_target_project(state: State<AppState>, path: String) -> Result<AppSettings, String> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err("路径不是目录".into());
    }
    let norm = normalize_path(&p);
    // ensure registered
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
        })?;
    }
    let mut settings = state.settings.lock().clone();
    settings.target_project = Some(norm);
    {
        let db = state.db.lock();
        save_settings(&db, &settings)?;
    }
    *state.settings.lock() = settings.clone();
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

fn rescan(state: &AppState) -> Result<usize, String> {
    let settings = state.settings.lock().clone();
    let enabled: HashSet<String> = settings.enabled_source_ids.into_iter().collect();
    let db = state.db.lock();
    let projects = project_paths(&db)?;
    let n = full_scan(&db, &state.config, &enabled, &projects)?;
    let _ = health::run_health_for_all(&db);
    Ok(n)
}

#[tauri::command]
fn run_health_scan(state: State<AppState>) -> Result<usize, String> {
    health::run_health_for_all(&state.db.lock())
}

#[tauri::command]
fn run_health_scan_scoped(
    state: State<AppState>,
    project: Option<String>,
    skill_ids: Option<Vec<String>>,
) -> Result<usize, String> {
    let db = state.db.lock();
    if let Some(ids) = skill_ids {
        if !ids.is_empty() {
            return health::run_health_for_ids(&db, &ids);
        }
    }
    if let Some(p) = project {
        if !p.trim().is_empty() {
            return health::run_health_for_project(&db, p.trim());
        }
    }
    health::run_health_for_all(&db)
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
fn list_health_reports(state: State<AppState>) -> Result<Vec<HealthReport>, String> {
    health::list_reports(&state.db.lock())
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

#[tauri::command]
fn registry_list(
    global: bool,
    project: Option<String>,
) -> Result<RegistryCommandResult, String> {
    let cwd = project.as_deref().map(PathBuf::from);
    registry::list_installed(global, cwd.as_deref())
}

#[tauri::command]
fn registry_add(
    package: String,
    global: bool,
    agents: Vec<String>,
    skill: Option<String>,
    project: Option<String>,
) -> Result<RegistryCommandResult, String> {
    let cwd = project.as_deref().map(PathBuf::from);
    registry::add_skill(
        &package,
        global,
        &agents,
        skill.as_deref(),
        cwd.as_deref(),
    )
}

#[tauri::command]
fn registry_update(
    global: bool,
    project: Option<String>,
) -> Result<RegistryCommandResult, String> {
    let cwd = project.as_deref().map(PathBuf::from);
    registry::update_skills(global, cwd.as_deref())
}

#[tauri::command]
fn registry_remove(
    name: String,
    global: bool,
    project: Option<String>,
) -> Result<RegistryCommandResult, String> {
    let cwd = project.as_deref().map(PathBuf::from);
    registry::remove_skill(&name, global, cwd.as_deref())
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
            let db_path = dir.join("ssm.db");
            let db = Db::open(&db_path)?;
            let config = load_source_config();
            let settings = load_settings(&db, &config);
            let state = AppState {
                db: Mutex::new(db),
                config,
                settings: Mutex::new(settings.clone()),
            };
            app.manage(state);

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Some(st) = handle.try_state::<AppState>() {
                    let _ = rescan(&st);
                }
            });

            // Lightweight debounced watch on known skill roots
            let watch_handle = app.handle().clone();
            std::thread::spawn(move || {
                use notify::RecursiveMode;
                use notify_debouncer_mini::{new_debouncer, DebounceEventResult};
                use std::time::Duration;

                let (tx, rx) = std::sync::mpsc::channel::<DebounceEventResult>();
                let mut debouncer = match new_debouncer(Duration::from_millis(500), tx) {
                    Ok(d) => d,
                    Err(_) => return,
                };

                if let Some(st) = watch_handle.try_state::<AppState>() {
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
                            let _ = debouncer
                                .watcher()
                                .watch(std::path::Path::new(&root), RecursiveMode::Recursive);
                        }
                    }
                }

                while let Ok(Ok(_events)) = rx.recv() {
                    if let Some(st) = watch_handle.try_state::<AppState>() {
                        let _ = rescan(&st);
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
