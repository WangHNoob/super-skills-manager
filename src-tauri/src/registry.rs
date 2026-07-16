use crate::models::RegistryCommandResult;
use std::process::Command;

fn run_npx_skills(args: &[&str]) -> Result<RegistryCommandResult, String> {
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
        run_npx_skills(&["find"])
    } else {
        run_npx_skills(&["find", query])
    }
}

pub fn list_installed(global: bool) -> Result<RegistryCommandResult, String> {
    if global {
        run_npx_skills(&["list", "-g"])
    } else {
        run_npx_skills(&["list"])
    }
}

pub fn add_skill(
    package: &str,
    global: bool,
    agents: &[String],
    skill: Option<&str>,
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
    run_npx_skills(&refs)
}

pub fn update_skills(global: bool) -> Result<RegistryCommandResult, String> {
    if global {
        run_npx_skills(&["update", "-g", "-y"])
    } else {
        run_npx_skills(&["update", "-y"])
    }
}

pub fn remove_skill(name: &str, global: bool) -> Result<RegistryCommandResult, String> {
    if global {
        run_npx_skills(&["remove", name, "--global", "-y"])
    } else {
        run_npx_skills(&["remove", name, "-y"])
    }
}
