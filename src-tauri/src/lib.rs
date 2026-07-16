mod bundles;
mod db;
mod hashutil;
mod indexer;
mod models;
mod ops;
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
    Ok(SkillDetail {
        skill,
        body_markdown,
        frontmatter_raw,
        outline,
        files,
        twins,
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
) -> Result<CopyPreview, String> {
    let also = state.settings.lock().also_write_native_cursor;
    ops::preview_copy(
        &state.db.lock(),
        &skill_ids,
        &project,
        &runtimes,
        &conflict_policy,
        also,
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
    full_scan(&db, &state.config, &enabled, &projects)
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
            list_bundles,
            create_bundle_cmd,
            delete_bundle_cmd,
            apply_bundle_cmd,
            import_bundle_cmd,
            export_bundle_cmd,
            list_oplog,
            set_favorite,
            reveal_in_explorer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
