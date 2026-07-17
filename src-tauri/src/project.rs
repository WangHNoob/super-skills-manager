use crate::db::Db;
use crate::models::{BundleRecommendation, ProjectProfile, ScaffoldResult};
use std::fs;
use std::path::Path;

pub fn detect_stacks(project: &Path) -> Vec<String> {
    let mut stacks = Vec::new();
    let checks = [
        ("node", &["package.json"][..]),
        ("rust", &["Cargo.toml"][..]),
        ("python", &["pyproject.toml", "requirements.txt", "setup.py"][..]),
        ("go", &["go.mod"][..]),
        ("java", &["pom.xml", "build.gradle", "build.gradle.kts"][..]),
        ("dotnet", &["*.sln", "*.csproj"][..]),
        ("frontend", &["vite.config.ts", "vite.config.js", "next.config.js", "next.config.mjs"][..]),
    ];
    for (name, files) in checks {
        let hit = files.iter().any(|f| {
            if f.contains('*') {
                project
                    .read_dir()
                    .ok()
                    .map(|rd| {
                        rd.filter_map(|e| e.ok()).any(|e| {
                            let n = e.file_name().to_string_lossy().to_string();
                            if f.ends_with(".sln") {
                                n.ends_with(".sln")
                            } else if f.ends_with(".csproj") {
                                n.ends_with(".csproj")
                            } else {
                                false
                            }
                        })
                    })
                    .unwrap_or(false)
            } else {
                project.join(f).exists()
            }
        });
        if hit {
            stacks.push(name.to_string());
        }
    }
    if stacks.iter().any(|s| s == "node")
        && (project.join("src").join("App.tsx").exists()
            || project.join("src").join("main.tsx").exists())
    {
        if !stacks.iter().any(|s| s == "frontend") {
            stacks.push("frontend".into());
        }
    }
    stacks.sort();
    stacks.dedup();
    stacks
}

fn resolve_names(db: &Db, names: &[&str]) -> (Vec<String>, Vec<String>, Vec<String>) {
    let mut ids = Vec::new();
    let mut found_names = Vec::new();
    let mut missing = Vec::new();
    for name in names {
        let candidates = db.skills_by_name(name).unwrap_or_default();
        let chosen = candidates
            .iter()
            .find(|s| s.access == "readwrite")
            .or_else(|| candidates.first());
        if let Some(s) = chosen {
            ids.push(s.id.clone());
            found_names.push((*name).to_string());
        } else {
            missing.push((*name).to_string());
        }
    }
    (ids, found_names, missing)
}

pub fn recommend_for_project(db: &Db, project_path: &str) -> Result<ProjectProfile, String> {
    let path = Path::new(project_path);
    if !path.is_dir() {
        return Err("项目路径不存在".into());
    }
    let stacks = detect_stacks(path);
    let mut recommendations = Vec::new();

    if stacks.iter().any(|s| s == "frontend" || s == "node") {
        let names = [
            "web-design-guidelines",
            "frontend-design",
            "architecture-guard",
        ];
        let (ids, found, missing) = resolve_names(db, &names);
        recommendations.push(BundleRecommendation {
            title: "前端审查包".into(),
            reason: "检测到 Node/前端工程文件".into(),
            skill_names: found,
            matched_skill_ids: ids,
            missing_names: missing,
        });
    }

    if stacks.iter().any(|s| s == "rust" || s == "go" || s == "java" || s == "dotnet")
        || stacks.is_empty()
    {
        let names = ["architecture-guard", "audit"];
        let (ids, found, missing) = resolve_names(db, &names);
        if !found.is_empty() || stacks.is_empty() {
            recommendations.push(BundleRecommendation {
                title: "工程健壮性包".into(),
                reason: if stacks.is_empty() {
                    "未识别到明确栈，提供通用审查组合".into()
                } else {
                    format!("检测到后端/系统栈: {}", stacks.join(", "))
                },
                skill_names: found,
                matched_skill_ids: ids,
                missing_names: missing,
            });
        }
    }

    // Always offer security-ish if audit exists
    let names = ["audit"];
    let (ids, found, missing) = resolve_names(db, &names);
    if !found.is_empty()
        && !recommendations
            .iter()
            .any(|r| r.title.contains("安全") || r.skill_names.iter().any(|n| n == "audit"))
    {
        recommendations.push(BundleRecommendation {
            title: "安全审计包".into(),
            reason: "本地已有 audit skill，适合代码变更审查".into(),
            skill_names: found,
            matched_skill_ids: ids,
            missing_names: missing,
        });
    }

    Ok(ProjectProfile {
        path: project_path.to_string(),
        stacks,
        recommendations,
    })
}

/// 在项目下创建技能目录脚手架。
/// `folders` 取值：`claude` → `.claude/skills`，`agents` → `.agents/skills`，`cursor` → `.cursor/skills`。
pub fn scaffold_project(project_path: &str, folders: &[String]) -> Result<ScaffoldResult, String> {
    let root = Path::new(project_path);
    if !root.is_dir() {
        return Err("项目路径不存在或不是目录".into());
    }
    let mut created = Vec::new();
    let mut skipped = Vec::new();
    for key in folders {
        let rel = match key.as_str() {
            "claude" => ".claude/skills",
            "agents" => ".agents/skills",
            "cursor" => ".cursor/skills",
            other => {
                return Err(format!("未知目录类型: {other}（支持 claude / agents / cursor）"));
            }
        };
        let dir = root.join(rel);
        if dir.is_dir() {
            skipped.push(dir.to_string_lossy().to_string());
            continue;
        }
        fs::create_dir_all(&dir).map_err(|e| format!("创建 {} 失败: {e}", dir.display()))?;
        // 放一个 .gitkeep，方便空目录也能被 git 跟踪
        let keep = dir.join(".gitkeep");
        if !keep.exists() {
            let _ = fs::write(&keep, "");
        }
        created.push(dir.to_string_lossy().to_string());
    }
    Ok(ScaffoldResult {
        project_path: project_path.to_string(),
        created,
        skipped,
    })
}
