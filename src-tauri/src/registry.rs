use crate::models::RegistryCommandResult;
use std::path::Path;
use std::process::Command;

fn run_npx_skills(
    args: &[&str],
    cwd: Option<&Path>,
) -> Result<RegistryCommandResult, String> {
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.arg("/C").arg("npx").arg("--yes").arg("skills");
        for a in args {
            c.arg(a);
        }
        c
    } else {
        let mut c = Command::new("npx");
        c.arg("--yes").arg("skills");
        for a in args {
            c.arg(a);
        }
        c
    };

    if let Some(dir) = cwd {
        if !dir.is_dir() {
            return Err(format!("项目目录不存在: {}", dir.display()));
        }
        cmd.current_dir(dir);
    }

    let output = cmd.output().map_err(|e| {
        format!("无法执行 npx skills（请确认已安装 Node.js）: {e}")
    })?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let code = output.status.code().unwrap_or(-1);
    Ok(RegistryCommandResult {
        ok: output.status.success(),
        stdout,
        stderr,
        code,
    })
}

pub fn find_skills(query: &str) -> Result<RegistryCommandResult, String> {
    if query.trim().is_empty() {
        run_npx_skills(&["find"], None)
    } else {
        run_npx_skills(&["find", query], None)
    }
}

pub fn list_installed(global: bool, project: Option<&Path>) -> Result<RegistryCommandResult, String> {
    if global {
        run_npx_skills(&["list", "-g"], None)
    } else {
        run_npx_skills(&["list"], project)
    }
}

pub fn add_skill(
    package: &str,
    global: bool,
    agents: &[String],
    skill: Option<&str>,
    project: Option<&Path>,
) -> Result<RegistryCommandResult, String> {
    let mut args: Vec<String> = vec!["add".into(), package.into(), "--copy".into(), "-y".into()];
    if global {
        args.push("-g".into());
    }
    for a in agents {
        args.push("-a".into());
        args.push(a.clone());
    }
    if let Some(s) = skill {
        args.push("-s".into());
        args.push(s.into());
    }
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    // 项目安装：不传 -g，并在项目目录下执行
    let cwd = if global { None } else { project };
    if !global && cwd.is_none() {
        return Err("项目级安装需要提供项目路径".into());
    }
    run_npx_skills(&refs, cwd)
}

pub fn update_skills(global: bool, project: Option<&Path>) -> Result<RegistryCommandResult, String> {
    if global {
        run_npx_skills(&["update", "-g", "-y"], None)
    } else {
        if project.is_none() {
            return Err("项目级更新需要提供项目路径".into());
        }
        run_npx_skills(&["update", "-y"], project)
    }
}

pub fn remove_skill(
    name: &str,
    global: bool,
    project: Option<&Path>,
) -> Result<RegistryCommandResult, String> {
    if global {
        run_npx_skills(&["remove", name, "--global", "-y"], None)
    } else {
        if project.is_none() {
            return Err("项目级移除需要提供项目路径".into());
        }
        run_npx_skills(&["remove", name, "-y"], project)
    }
}
