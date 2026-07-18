//! 工作区根项目发现：在用户登记的代码根目录下递归查找含 skills 目录的项目。
//!
//! 与 `indexer`（按源扫描 skill 目录）解耦：本模块只负责「找出项目目录」，
//! 找到后由调用方 upsert 进 `project_roots`，复用既有 project-scope 扫描链路。

use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// 判定一个目录为「项目」的 marker：与 `config/skill-sources.defaults.json`
/// 的 project-scope pathPatterns 同源（`<project>\.claude\skills` 等）。任一存在即视为项目。
const PROJECT_MARKERS: &[&str] = &[
    ".claude/skills",
    ".agents/skills",
    ".cursor/skills",
    ".codex/skills",
];

/// 递归遍历时跳过的目录名（构建产物 / 依赖 / 编辑器缓存等）。
/// 注意：不按「点开头」泛化跳过 —— `.claude` / `.agents` 等 marker 本身就在隐藏目录下。
pub const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "__pycache__",
    ".venv",
    "target",
    "dist",
    "build",
    "out",
    ".cache",
    ".next",
    ".turbo",
    ".svelte-kit",
    ".nuxt",
    "vendor",
    "deps",
    ".idea",
    ".vscode",
];

/// 目录是否为「项目」（含任一 skills marker 子目录）。
pub fn is_project_dir(dir: &Path) -> bool {
    for m in PROJECT_MARKERS {
        if dir.join(m).is_dir() {
            return true;
        }
    }
    false
}

/// 在工作区根下递归发现所有「项目」目录。
///
/// - 不跟随符号链接（避免环与跨盘 junction 性能问题）
/// - 最大深度 6（覆盖 `<root>/<lang>/<org>/<repo>` + monorepo `packages/x`）
/// - 跳过 [`SKIP_DIRS`] 列出的目录子树
/// - 祖先进重：某目录被判定为项目后，不再将其内层子项目单独返回
pub fn discover_projects_in_workspace(root: &Path) -> Vec<PathBuf> {
    if !root.is_dir() {
        return Vec::new();
    }
    let mut hits: Vec<PathBuf> = WalkDir::new(root)
        .follow_links(false)
        .max_depth(6)
        .into_iter()
        .filter_entry(|e| {
            if !e.file_type().is_dir() {
                return true;
            }
            let name = e.file_name().to_string_lossy();
            !SKIP_DIRS.contains(&name.as_ref())
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_dir())
        .filter(|e| is_project_dir(e.path()))
        .map(|e| e.path().to_path_buf())
        .collect();

    // 祖先进重：排序后单遍，去掉被更浅命中作为前缀（祖先）的目录
    hits.sort();
    let mut result = Vec::with_capacity(hits.len());
    let mut last: Option<PathBuf> = None;
    for p in hits {
        if matches!(&last, Some(l) if p.starts_with(l)) {
            continue;
        }
        last = Some(p.clone());
        result.push(p);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn mkdir(p: &Path) {
        fs::create_dir_all(p).unwrap();
    }

    fn make_project(dir: &Path, marker: &str) {
        mkdir(&dir.join(marker));
    }

    #[test]
    fn is_project_dir_detects_all_markers() {
        let tmp = TempDir::new().unwrap();
        for m in [
            ".claude/skills",
            ".agents/skills",
            ".cursor/skills",
            ".codex/skills",
        ] {
            let d = tmp.path().join(m.replace('/', "-"));
            make_project(&d, m);
            assert!(is_project_dir(&d), "应识别 {m} 为项目");
        }
        let plain = tmp.path().join("plain");
        mkdir(&plain);
        assert!(!is_project_dir(&plain));
    }

    #[test]
    fn discovers_projects_in_workspace() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        make_project(&root.join("repo-a"), ".agents/skills");
        make_project(&root.join("nested").join("repo-b"), ".claude/skills");

        let found = discover_projects_in_workspace(root);
        assert!(
            found.iter().any(|p| p.ends_with("repo-a")),
            "应发现 repo-a: {found:?}"
        );
        assert!(
            found.iter().any(|p| p.ends_with("repo-b")),
            "应发现 repo-b: {found:?}"
        );
    }

    #[test]
    fn skips_excluded_dirs() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        make_project(&root.join("node_modules").join("pkg"), ".agents/skills");
        make_project(&root.join("target").join("x"), ".claude/skills");
        make_project(&root.join("real"), ".agents/skills");

        let found = discover_projects_in_workspace(root);
        assert_eq!(found.len(), 1, "只应发现 real: {found:?}");
        assert!(found[0].ends_with("real"));
    }

    #[test]
    fn stops_descending_into_project_subtree() {
        // monorepo：外层项目内再嵌套一个项目，只返回外层
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let outer = root.join("monorepo");
        make_project(&outer, ".agents/skills");
        make_project(&outer.join("packages").join("inner"), ".agents/skills");

        let found = discover_projects_in_workspace(root);
        assert_eq!(found.len(), 1, "应只返回外层 monorepo: {found:?}");
        assert!(found[0].ends_with("monorepo"));
    }

    #[test]
    fn nonexistent_root_returns_empty() {
        let found = discover_projects_in_workspace(Path::new("/no/such/dir/should/exist/here"));
        assert!(found.is_empty());
    }
}
