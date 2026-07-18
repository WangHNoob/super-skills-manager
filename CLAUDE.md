# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

Super Skills Manager（SSM）是一个 Windows 桌面应用，把散落在 Cursor / Claude Code / Agents / skills.sh 各处的 **AI Agent Skills** 集中索引、浏览、健康检查、组合打包，并一键复用到新项目。数据只留在本机，无云同步。

技术栈：**Tauri 2 · React 19 · TypeScript · Vite 7 · Rust · SQLite（rusqlite bundled）**。

## 常用命令

```bash
npm install              # 安装前端依赖
npm run tauri:dev        # 开发：启动 vite(1420) + Tauri 窗口（日常开发用这个）
npm run tauri:build      # 生产构建 + 打包安装程序（NSIS/MSI）
npm run build            # 仅前端：tsc 类型检查 + vite build → dist/
npm run dev              # 仅前端 dev server（无后端，invoke 会失败，一般不用）

# Rust 后端测试（无 JS 测试框架）
cd src-tauri && cargo test                 # 全部
cd src-tauri && cargo test <test_name>     # 单个测试，例如 cargo test preview_copy_actions_for_policies
cd src-tauri && cargo check                # 快速类型检查
```

构建产物：`src-tauri/target/release/bundle/nsis/SSM_0.1.0_x64-setup.exe`（及同目录 `.msi`）。

> 项目未配置 ESLint / Prettier / JS 测试。前端类型正确性靠 `tsc`（`npm run build` 会跑）。改动后端后务必 `cargo test`。

## 架构总览

### 进程与分层

Tauri 双进程：**Rust 后端**（`src-tauri/src/`）持有 SQLite 与文件系统；**React 前端**（`src/`）通过 `invoke()` 调用后端命令。**列表只绑 SQLite 索引行，打开详情才按需读 `SKILL.md`** —— 这是全项目的性能主线，任何新功能都要遵守。

### 前端（`src/`）

- `main.tsx → App.tsx`：`AppShell` 顶部 Tab 导航（技能库 / 分类浏览 / 组合包 / 健康检查 / 新建项目 / 在线安装 / 设置 / 来源与项目 / 操作记录）。各 view 始终挂载、内部按 `tab` 自显隐，以保留跨 tab 状态（如详情二级窗）。
- `context/CatalogContext.tsx`：全局状态，经 `useCatalog()` Hook 被所有 view 消费；`requestOpenSkill(id)` 会切到「技能库」并弹详情窗（分类浏览等复用）。新增跨页面状态优先放这里。
- `views/`：每个 Tab 一个 view；`SkillsExplorerView.tsx` 是「分类浏览」三级聚合树（runtime → 全局/项目 → 项目 → skill，前端客户端聚合）；`ProjectSetup.tsx` 是「新建项目」单页流水线。
- `api.ts`：**唯一** 的 Tauri 调用层，每个方法 1:1 对应一个后端 `#[tauri::command]`（TS camelCase → Rust snake_case）。前端**不要**直接 `invoke`，加命令就在这里加方法。
- `types.ts`：镜像 Rust `models.rs` 的 TS 类型，保持两端字段一致是硬约束。
- `conflict.ts`（prompt 逐项决策）、`constants.ts`（`RUNTIMES`）、`errMsg.ts`（错误转人读文案）。

### 后端（`src-tauri/src/`）

| 模块 | 职责 |
|------|------|
| `lib.rs` | `run()`：插件、`AppState`、`invoke_handler` 注册全部命令、文件监视线程、`rescan()` |
| `db.rs` | `Db` 封装 rusqlite；**迁移**（`migrate` + v1–v4，`LATEST = 4`，迁移前备份 `ssm.db.bak`）；`open_in_memory()` 供测试 |
| `models.rs` | serde 结构体（`SkillRecord` / `Bundle` / `HealthReport` / `OpLogEntry` / `ProjectRoot` / `WorkspaceRoot` …），前端 `types.ts` 的镜像来源 |
| `indexer.rs` | `full_scan` / `scan_root` / `find_skill_dirs` / `index_skill_dir` / contentHash / TwinGroup |
| `discover.rs` | 工作区根项目发现：`discover_projects_in_workspace`（walkdir `follow_links(false)` + `max_depth(6)` + `SKIP_DIRS` + 祖先进重）；与 indexer 解耦，只找「项目目录」 |
| `sources.rs` | 加载源配置、`resolve_roots`、`write_target_for_runtime`（复制/Bundle 写入路径） |
| `health.rs` | 健康规则评分、CLI 字典探测、按 `content_hash` 缓存 |
| `ops.rs` | `preview_copy` / `execute_copy` / 删除 / 提取 / 同步副本 |
| `registry.rs` / `registry_compare.rs` | skills.sh / `npx skills` 桥接、锁文件远端对照 |
| `bundles.rs` / `packaging.rs` / `policy.rs` / `project.rs` / `script_risk.rs` / `hashutil.rs` / `error.rs` | 组合包 / ZIP 导入导出 / 冲突策略 / 项目脚手架 / 脚本风险 / 哈希 / 错误 |

### 关键运行时结构（`lib.rs::AppState`）

```rust
pub struct AppState {
    pub db: Mutex<Db>,              // SQLite，短锁：扫描内部加锁，健康检查先快照再释放锁分析
    pub config: SourceConfigFile,   // 源路径表（启动加载，不变）
    pub settings: Mutex<AppSettings>, // 用户设置（settings 表里存的 JSON）
    pub scan_dirty: AtomicBool,     // watcher 置位 → 节流线程 2s 合并触发 rescan
    watch_tx: Mutex<Option<Sender<WatchControl>>>, // request_watch_rebuild 动态重建 watch 集
}
```

`run()` 启动后：建 `app_data_dir` → 开 `ssm.db` → 加载 config/settings → manage(state) → 后台线程跑首次 `rescan` → 文件监视线程（`notify-debouncer-mini`，500ms 去抖 + 2s 节流脏标记，非每事件即扫）。

### 扫描 / 索引管线（`indexer.rs` + `lib.rs::rescan`）

`rescan` → 取启用源 × 已登记项目 → `full_scan` 逐源 `resolve_roots` → `find_skill_dirs(root, 3)`（**硬编码深度 3**，不读 config 的 `maxDepthBelowSkillsRoot`）→ `index_skill_dir_with_previous`（旧记录 mtime + hasScripts 未变且旧 hash 非空则**复用旧 hash 跳过 walkdir**）→ 每源/根一笔事务 `with_transaction` upsert → `delete_skills_not_in` 剪枝磁盘已删除项 → `rebuild_twins` → 默认 `health::run_health_for_all`（走缓存、**不**做远端对照）。

**Skill 识别**：目录内存在 `SKILL.md`（Windows 不区分大小写）+ 在启用源根下 + 相对深度 ≤ 3 + 不在排除目录（`.git`/`node_modules`/`__pycache__`/`.venv`）。`contentHash` = 目录相关文件按相对路径排序后 `path + sha256(file)` 再整体 sha256，同 hash ⇒ 内容一致。

### 工作区根自动发现（`discover.rs` + `lib.rs`）

「来源与项目」页可登记**工作区根**（代码根目录，如 `D:\Projects`）。启动时与「重新发现」会调 `scan_all_workspace_roots_sync` → 对每个启用根 `discover_projects_in_workspace`：递归找含 `.claude/skills` / `.agents/skills` / `.cursor/skills` / `.codex/skills` 之一的项目目录（`follow_links(false)`、`max_depth(6)`、跳过 `SKIP_DIRS`、判定为项目后不再下钻其子树）。发现的项目以 `origin='discovered'` 写入 `project_roots`，**随后由现有 project-scope 扫描分支自动扫描其 skills**——即发现只是「把项目塞进 `project_roots`」，不改 `full_scan`。

- 命令：`add_workspace_root` / `remove_workspace_root(cascade)` / `set_workspace_root_enabled` / `scan_workspace_roots` / `list_workspace_roots`（仿 `add_project` 模板：upsert → rescan → `request_watch_rebuild`）。
- 冲突保护：`upsert_project_with_origin` 在同 path 已存在时**不动 origin**，避免把用户手动添加的项目降级为 discovered。
- 级联删除：`remove_workspace_root(cascade=true)` 删 `discovered_from` 匹配的项目并 rescan 剪枝；`cascade=false` 仅置 `discovered_from=NULL`。
- watcher 不监听工作区根本身（避免句柄爆炸）；工作区根下**新建**项目目录需手动「重新发现」或重启触发。

## 重要约定（改代码前必读）

### 前后端契约
- **加命令三处同步**：`lib.rs` 写 `#[tauri::command]` + 注册进 `invoke_handler!` 列表 + `api.ts` 加方法 + `types.ts` 加类型。漏任何一处前端都调不通。
- 后端命令统一返回 `Result<T, String>`，前端用 `errMsg(e)` 转人读文案。

### 源与只读策略（`config/skill-sources.defaults.json`）
- **硬只读源**：`cursor-builtin`、`cursor-plugin-cache` —— 禁止 delete/move/overwrite/drop/edit；只允许 view/search/diff/extractCopy。改 ops 逻辑时要拦这两类。
- 写入映射见 `sources.rs::write_target_for_runtime`（codex 复用 agents 项目目录；cursor 项目默认写 `.agents`，`alsoWriteNativeCursor` 时追加 `.cursor`）。
- 路径变量：`%USERPROFILE%`、`<project>`（已登记项目根）。

### 写操作
- 拖拽/复制一律**先 `preview_copy` 后 `execute_copy`**；冲突策略 `overwrite` / `skip` / `rename` / `prompt`。`prompt` 项必须在前端逐项决策（`action !== "prompt"`），后端对未决策的 prompt 直接拒绝（报「尚未决策」）。
- 删除进**系统回收站**（`trash` crate，`trash::os_limited` 仅 Win/macOS），`delete_impact` 先展示副本数与 Bundle 引用；OpLog 里可「恢复」。
- 写操作（copy/extract/restore/syncTwin/bundleApply/import）执行后触发 `rescan` 重新 upsert，并记入 OpLog。**当前不做撤销**（无可靠回放）。

### SQLite 迁移
- 全部迁移在 `schema_version` 门控下；`db.rs::LATEST = 4`；新增列/表写新 `migrate_vN_*` 并 bump `LATEST`，失败返回错误而非静默忽略。`content_history`（v3）记录 scan/export/import 事件；v4 给 `project_roots` 加 `origin`/`discovered_from` 列并新建 `workspace_roots` 表。

### 健康检查
- 0–100 分，severity 扣分：error −25 / warn −10 / info −3，等级 A≥85 / B 70–84 / C 50–69 / D<50。规则 ID（META/DESC/BODY/DEP/RISK/REG/SRC/BUN）详见 [`docs/04-health-rules.md`](docs/04-health-rules.md)。
- **只提示不自动改写用户文件**；自动修复白名单当前仅 `META003`（写 name=目录名）。
- 远端 skills.sh 对照**仅对锁文件内 skill** 生效（`registry_compare.rs::lock_paths` 依次查 `~/.agents/.skill-lock.json` → `~/.agents/skills-lock.json` → `~/.claude/.skill-lock.json`）；本地手写/未进锁文件的不报 REG、不扣分。远端拉取有 1h 进程内缓存。

### skills.sh 桥接
- 交互类命令（find/add/update/remove）通过 `open_skills_cli_terminal` **打开系统终端**执行，**不预填** `--yes`/`--copy`/`-a`/`-s`；选项由用户在终端选。

## 文档

完整设计记录在 `docs/`（推荐先读 `user-guide.md`）：源路径表(01)、界面 IA(02)、数据模型(03)、健康规则(04)、技术选型(05)、优化(06)、性能(07)。改对应模块前先读相关文档，**以代码为准**（文档标注了多处「声明性默认值未读取」「未实现」等与代码的偏差）。

## codegraph

仓库已初始化 `.codegraph/`。查代码用 codegraph MCP（`codegraph_explore` 为首选单次调用）。若报「No CodeGraph project loaded」，给工具传 `projectPath: "D:/Projects/super-skills-manager"`。
