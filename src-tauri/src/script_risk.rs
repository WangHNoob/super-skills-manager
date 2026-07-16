use crate::models::ScriptRiskFinding;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

struct Rule {
    id: &'static str,
    severity: &'static str,
    needles: &'static [&'static str],
    message: &'static str,
}

const RULES: &[Rule] = &[
    Rule {
        id: "RISK001",
        severity: "warn",
        needles: &["curl ", "curl\t", "invoke-webrequest", "wget ", "fetch("],
        message: "网络请求",
    },
    Rule {
        id: "RISK002",
        severity: "error",
        needles: &["rm -rf /", "remove-item -recurse", "mkfs"],
        message: "危险销毁",
    },
    Rule {
        id: "RISK003",
        severity: "warn",
        needles: &["api_key", "secret", "password=", "token="],
        message: "疑似硬编码凭证",
    },
    Rule {
        id: "RISK004",
        severity: "warn",
        needles: &["sudo ", "runas"],
        message: "提权",
    },
    Rule {
        id: "RISK005",
        severity: "info",
        needles: &["setx ", "reg add", "hkcu\\"],
        message: "修改环境/注册表",
    },
    Rule {
        id: "RISK006",
        severity: "warn",
        needles: &["| iex", "|ie", "| sh", "| bash"],
        message: "远程管道执行",
    },
];

pub fn scan_script_risks(skill_dir: &Path) -> Vec<ScriptRiskFinding> {
    let scripts = skill_dir.join("scripts");
    if !scripts.is_dir() {
        return Vec::new();
    }
    let mut findings = Vec::new();
    for entry in WalkDir::new(&scripts).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(text) = fs::read_to_string(entry.path()) else {
            continue;
        };
        let rel = entry
            .path()
            .strip_prefix(skill_dir)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| entry.path().to_string_lossy().to_string());
        for (idx, line) in text.lines().enumerate() {
            let lower = line.to_lowercase();
            for rule in RULES {
                if rule.needles.iter().any(|n| lower.contains(n)) {
                    findings.push(ScriptRiskFinding {
                        rule_id: rule.id.into(),
                        severity: rule.severity.into(),
                        file: rel.clone(),
                        line: (idx + 1) as u32,
                        snippet: line.trim().chars().take(200).collect(),
                        message: rule.message.into(),
                    });
                }
            }
        }
    }
    findings
}
