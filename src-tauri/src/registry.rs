use crate::models::RegistryCommandResult;
use std::path::Path;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NEW_CONSOLE: u32 = 0x00000010;

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

/// 组装会在交互终端里执行的基础命令（不预填 -y / --copy 等选项，全部留给用户在终端选择）。
pub fn build_interactive_command(
    action: &str,
    package_or_query: Option<&str>,
    global: bool,
) -> Result<String, String> {
    let base = "npx skills";
    let cmd = match action {
        "find" => {
            if let Some(q) = package_or_query.map(str::trim).filter(|s| !s.is_empty()) {
                format!("{base} find {}", quote_shell_arg(q))
            } else {
                format!("{base} find")
            }
        }
        "add" => {
            let pkg = package_or_query
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "安装需要填写包名或仓库（如 owner/repo）".to_string())?;
            // 仅带包名；是否 copy / 装哪些 skill / 哪些 agent 均在终端交互
            if global {
                format!("{base} add {} -g", quote_shell_arg(pkg))
            } else {
                format!("{base} add {}", quote_shell_arg(pkg))
            }
        }
        "update" => {
            if global {
                format!("{base} update -g")
            } else {
                format!("{base} update")
            }
        }
        "remove" => {
            if let Some(name) = package_or_query.map(str::trim).filter(|s| !s.is_empty()) {
                if global {
                    format!("{base} remove {} --global", quote_shell_arg(name))
                } else {
                    format!("{base} remove {}", quote_shell_arg(name))
                }
            } else if global {
                format!("{base} remove --global")
            } else {
                format!("{base} remove")
            }
        }
        "list" => {
            if global {
                format!("{base} list -g")
            } else {
                format!("{base} list")
            }
        }
        other => return Err(format!("不支持的动作: {other}")),
    };
    Ok(cmd)
}

fn quote_shell_arg(s: &str) -> String {
    if s.is_empty() {
        return "\"\"".into();
    }
    if s.chars()
        .any(|c| c.is_whitespace() || "\"&|<>^".contains(c))
    {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// 打开交互终端，自动执行基础 skills 命令；用户可在窗口内继续选择选项。
pub fn open_interactive_terminal(
    cwd: Option<&Path>,
    command: &str,
) -> Result<String, String> {
    if let Some(dir) = cwd {
        if !dir.is_dir() {
            return Err(format!("项目目录不存在: {}", dir.display()));
        }
    }

    #[cfg(windows)]
    {
        let loc = cwd
            .map(|d| format!("（目录：{}）", d.display()))
            .unwrap_or_default();

        // 优先 Windows Terminal
        let mut wt = Command::new("wt");
        if let Some(dir) = cwd {
            wt.arg("-d").arg(dir);
        }
        wt.arg("--")
            .arg("cmd")
            .arg("/k")
            .arg(command)
            .creation_flags(CREATE_NEW_CONSOLE);
        if wt.spawn().is_ok() {
            return Ok(format!("已打开终端并执行：{command}{loc}"));
        }

        let mut cmd = Command::new("cmd");
        cmd.arg("/k").arg(command);
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        cmd.creation_flags(CREATE_NEW_CONSOLE)
            .spawn()
            .map_err(|e| format!("无法打开交互终端: {e}"))?;
        return Ok(format!("已打开终端并执行：{command}{loc}"));
    }

    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        let mut cmd = Command::new(&shell);
        // -c 执行后用 exec 进入交互 shell，避免窗口立刻关闭
        let script = format!("{command}; echo; echo '命令已结束，可继续输入或关闭窗口。'; exec {shell} -i");
        cmd.arg("-lc").arg(&script);
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        cmd.spawn()
            .map_err(|e| format!("无法打开交互终端: {e}"))?;
        Ok(format!("已打开终端并执行：{command}"))
    }
}

pub fn open_skills_action(
    action: &str,
    package_or_query: Option<&str>,
    global: bool,
    project: Option<&Path>,
) -> Result<String, String> {
    let command = build_interactive_command(action, package_or_query, global)?;
    let cwd = if global { None } else { project };
    if !global && matches!(action, "add" | "update" | "remove" | "list") && cwd.is_none() {
        return Err("项目级操作需要提供项目路径".into());
    }
    open_interactive_terminal(cwd, &command)
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
