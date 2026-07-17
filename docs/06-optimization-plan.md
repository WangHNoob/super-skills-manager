# 06 - 优化方案

> **状态：提案。** 基于 v0.1.0 全量代码审计（CodeGraph 符号 + 调用路径分析）形成，尚未实施。
> 目标是在不改变产品形态的前提下，补齐质量保障、修复行为缺陷、解除性能瓶颈、收敛安全面。

## 1. 审计结论速览

SSM 已覆盖「发现 -> 评估 -> 落地 -> 同步 -> 分发」完整闭环，架构分层清晰。主要短板集中在三方面：

- **质量保障缺位**：全仓零测试，`ops.rs` / `indexer.rs` / `health.rs` 等核心模块无任何覆盖。
- **破坏性操作确认链不完整**：`conflict_policy = "prompt"` 在前端被静默降级为 `overwrite`；`sync_twin` / `execute_copy` 的覆盖删除没有在预览阶段显式暴露。
- **并发模型粗糙**：`rescan` 持 DB Mutex 跑全量扫描 + 健康检查，文件监听器每次抖动都触发全量重扫，且 watch 集合在启动后不再更新。

下文按 P0（必修）-> P3（改善）排列，每项给出问题定位、方案、涉及文件与验收标准。

---

## 2. P0 - 必修

### P0-1 搭建测试体系

**问题**：CodeGraph 对几乎所有符号标注「no covering tests found」。`execute_copy` / `sync_twin` / `delete_skills` 直接操作文件系统且有覆盖删除语义，任何回归都没有保护网。

**方案**：

1. 在 `src-tauri/` 引入 `#[cfg(test)]` 模块，优先覆盖纯逻辑与可隔离的 IO：
   - `ops.rs`：用 `tempfile::TempDir` 构造源/目标目录，测试 `preview_copy`（copy/skip/rename/overwrite 四种 action 推导）、`execute_copy`（覆盖删除后内容正确、rename 不撞名、partial 状态聚合）、`sync_twin`（只读目标拒绝、覆盖后内容一致）、`resolve_delete_impact`（twin/bundle 计数）。
   - `indexer.rs`：构造含 `SKILL.md` frontmatter 的临时目录，测试 `index_skill_dir` 字段映射、`find_skill_dirs` 深度与跳过规则、`rebuild_twins` 的 identical/diverged 判定。
   - `health.rs`：对 `analyze_skill` 逐规则构造最小 SKILL.md 样本，断言 issue 的 `rule_id` / `severity` / `score` / `grade`。
   - `db.rs`：内存库（`Connection::open_in_memory`）测试 `upsert_skill` / `delete_skills_not_in` / `list_skills` 过滤组合。
2. `Cargo.toml` 加 `tempfile = "3"` 作为 `[dev-dependencies]`。
3. CI（若接入）跑 `cargo test` 作为合并门禁。

**涉及文件**：`src-tauri/Cargo.toml`、`src-tauri/src/ops.rs`、`src-tauri/src/indexer.rs`、`src-tauri/src/health.rs`、`src-tauri/src/db.rs`。

**验收**：`cargo test` 通过；`ops.rs` 关键路径行覆盖 >= 70%；破坏性操作（覆盖、删除、同步）均有正向 + 反向用例。

### P0-2 修复 conflict_policy "prompt" 静默降级

**问题**：`AppSettings.conflict_policy` 支持 `overwrite/skip/rename/prompt` 四值，但前端在生成预览与执行时把 `prompt` 一律降级为 `overwrite`：

- `src/App.tsx` 的 `buildPreviewFromIds`（约 360 行）、`runCopy`（约 384 行）、`applyBundle`（约 442 行）
- `src/ProjectSetup.tsx` 的 `applySetup`（约 223 行）

用户选了「询问」却得到「直接覆盖」，是行为与预期不符的静默缺陷。

**方案**：二选一，推荐 A。

- **A（推荐）真正实现 prompt**：预览阶段对 `action === "prompt"` 的项不降级，前端在 `CopyPreview` 渲染时对冲突项逐个弹出「覆盖 / 跳过 / 改名」选择，收集用户决策后再 `executeCopy`。后端 `execute_copy` 已支持按 item action 分派（`ops.rs:96`），只需前端不再篡改 policy。
- **B（退路）移除 prompt 选项**：若短期不实现交互，从设置 UI 与 `CONFLICT_LABELS` 中删除 `prompt`，避免误导。

**涉及文件**：`src/App.tsx`、`src/ProjectSetup.tsx`、`src/types.ts`（可选）。

**验收**：选「询问」时，冲突项逐个询问且按用户选择执行；非冲突项仍直接复制；无静默覆盖。

### P0-3 破坏性操作的显式确认

**问题**：

- `execute_copy` 的 overwrite 分支先 `fs::remove_dir_all(&target)` 再复制（`ops.rs:117`）。
- `sync_twin` 直接 `fs::remove_dir_all(&target_path)` 后覆盖（`ops.rs:278`），预览阶段未暴露「将删除已存在目标」。
- `delete_skills` 走回收站（`ops.rs:178`），已有 `confirm`，但 `runDelete` 的确认文案未充分利用 `deleteImpact` 返回的 twin/bundle 全貌。

**方案**：

1. `CopyPlanItem` 增加 `will_overwrite: bool`（预览时由后端根据 `target.exists() && action in {overwrite, prompt}` 填充），前端预览列表对 `will_overwrite` 项标红并附「将替换已有目录」提示；执行前统一二次确认。
2. `sync_twin` 前端在副本面板增加「同步将覆盖目标侧全部内容」的确认对话框；目标为 `readonly` 时后端已拒绝（`ops.rs:273`），UI 应前置禁用同步按钮。
3. `runDelete` 确认文案补全 twin 数量与所属 bundle 名称（`deleteImpact` 已返回 `twinCount` / `bundles`，前端拼装更完整的列表）。

**涉及文件**：`src-tauri/src/models.rs`、`src-tauri/src/ops.rs`、`src/App.tsx`、`src/types.ts`。

**验收**：任何会删除/覆盖已存在目录的操作，执行前都有明确文案告知将删除什么；readonly 目标在 UI 层即不可选同步。

---

## 3. P1 - 重要

### P1-1 扫描与健康检查移出 DB 锁

**问题**：`rescan`（`lib.rs:387`）在 `state.db.lock()` 持锁状态下跑 `full_scan` + `run_health_for_all`。文件监听器每次抖动（`lib.rs:707`）都调 `rescan`，扫描期间前端所有 command 都会阻塞在 `state.db.lock()` 上，技能多时 UI 卡顿。

**方案**：

1. 扫描阶段不持长锁：`full_scan` 内部按 source 短暂加锁写入（`upsert_skill` / `delete_skills_not_in` 已是单次调用），外层不包 `db.lock()` 全程持有。
2. 健康检查 `run_health_for_all` 改为先读取技能快照（一次 `all_skills()`），释放锁后逐个 `analyze_skill`（纯计算 + 局部文件读），最后短锁批量 `save_health_report`。
3. 监听器触发改为「标记脏 + 节流」：抖动只置一个 `AtomicBool dirty`，由后台定时线程（如每 2s 检查）合并触发一次 `rescan`，而非每个 debounce 事件立即全量扫。

**涉及文件**：`src-tauri/src/lib.rs`、`src-tauri/src/indexer.rs`、`src-tauri/src/health.rs`。

**验收**：扫描期间前端 `list_skills` / `get_settings` 等 command 响应 < 50ms；监听器连续抖动只触发一次合并扫描。

### P1-2 文件监听器动态更新 watch 集合

**问题**：watcher 在 `run()` 启动时一次性注册所有 enabled source 的根（`lib.rs:695`）。用户后续在「来源与项目」页 toggle source、或新增/移除项目后，watch 集合不会更新--新目录不被监视，已禁用的目录仍在监视并触发无谓重扫。

**方案**：把 watcher 的 `debouncer` 句柄提升到 `AppState`（或独立 `Mutex<Option<Debouncer>>`），在 `toggleSource` / `add_project` / `remove_project` / `set_target_project` 后调用 `rebuild_watch_set()`：先 `unwatch` 全部旧路径，再按当前 enabled sources + projects 重新 `watch`。监听器线程改为从 channel 接收「重建」指令与「事件」两类消息。

**涉及文件**：`src-tauri/src/lib.rs`、`src-tauri/src/sources.rs`（复用 `resolve_roots`）。

**验收**：toggle 一个 source 后，其目录的文件变动能/不能被正确感知；新增项目后该项目的 skills 目录被纳入监视。

### P1-3 数据库迁移引入版本号

**问题**：`migrate`（`db.rs:23`）靠 `let _ = ALTER TABLE ...` 忽略错误做增量（`db.rs:117`），无版本表、无审计。后续若需字段重命名/类型变更/删除列，无法安全推进。

**方案**：

1. 新增 `schema_version` 表（单行单列），初始读取当前版本。
2. 把现有 `CREATE TABLE IF NOT EXISTS` 视为 v1 基线；已有的 `ALTER TABLE` 作为 v2/v3 迁移步骤，按版本号门控执行。
3. 后续迁移以 `if version < N { ...; set_version(N) }` 形式追加，禁止再写裸 `let _ = ALTER`。

**涉及文件**：`src-tauri/src/db.rs`。

**验收**：旧库升级到新版本后 `schema_version` 正确递增；全新库从 0 一步到最新；迁移失败时返回错误而非静默忽略。

---

## 4. P2 - 改善

### P2-1 收敛 CSP

**问题**：`tauri.conf.json` 的 `app.security.csp` 为 `null`。应用用 `react-markdown` 渲染任意来源的 SKILL.md 正文，关闭 CSP 扩大了注入面。

**方案**：设置最小 CSP，例如 `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'`。`react-markdown` 默认不输出原生 `<script>`，`'unsafe-inline'` 仅留给样式。上线前用各 runtime 的真实技能样本回归渲染，确认无样式/图片加载回归。

**涉及文件**：`src-tauri/tauri.conf.json`。

**验收**：技能详情页 markdown 正常渲染（标题、列表、代码块、内联图片）；DevTools 无 CSP 违规报告；无外部脚本执行。

### P2-2 command_exists 异步化与缓存

**问题**：`command_exists`（`health.rs:65`）对 `CLI_DICT` 中每个 CLI 同步 shell 调用 `where.exe` / `which`。健康检查对每个技能都跑一遍，技能多时耗时线性叠加。

**方案**：

1. 进程级缓存：在 `run_health_for_all` 开始时一次性并发探测 `CLI_DICT` 全部 CLI，结果存入 `HashMap<&str, bool>` 供本次扫描复用。
2. 缓存可带 TTL（如 5 分钟）或随扫描批次失效，避免长期脏数据。

**涉及文件**：`src-tauri/src/health.rs`。

**验收**：100 个技能的健康检查中，`command_exists` 总调用次数 = `CLI_DICT` 长度而非 100 倍；探测失败不影响其它规则。

### P2-3 list_skills 过滤下推 SQL 并支持分页

**问题**：`list_skills`（`db.rs:401`）只把 `query/twins/favorites/has_scripts` 下推 SQL，`runtimes/scopes/origins/source_ids/tag/project_root` 全部在 Rust 侧 `for r in rows.flatten()` 后内存过滤（`db.rs:431`）。`ProjectSetup.tsx` 的 `catalog` 还在内存 `.slice(0, 80)`（`ProjectSetup.tsx:88`）。技能规模上来后全量读 + 内存过滤会成为瓶颈。

**方案**：

1. 把 `runtimes/scopes/origins/source_ids` 改为 SQL `IN (?)` 子句下推（注意 rusqlite 不直接支持数组参数，需展开占位符或用 `carray` 扩展）。
2. `tag` 过滤可用 `tags_json LIKE`（当前结构为 JSON 数组字符串）或独立关联表。
3. 增加 `limit/offset` 参数，前端列表改为按需加载，`catalog` 不再一次性 slice。

**涉及文件**：`src-tauri/src/db.rs`、`src-tauri/src/models.rs`（`SkillFilter` 加分页字段）、`src/api.ts`、`src/ProjectSetup.tsx`。

**验收**：万级技能时列表查询 < 100ms；前端滚动加载无卡顿；过滤结果与改造前一致。

### P2-4 拆分 App.tsx，引入轻量状态管理

**问题**：`App.tsx` 单文件承载 8 个标签页、约 40 个 state、全部交互逻辑（多选、预览、拖拽、快捷键、注册表）。文件已超 600 行且持续膨胀，状态散落在顶层 `useState`，复用与测试困难。

**方案**：

1. 按标签页拆分子组件到 `src/views/`：`LibraryView` / `BundlesView` / `HealthView` / `RegistryView` / `SettingsView` / `SourcesView` / `OpLogView`。`App.tsx` 只保留 tab 路由、全局 settings/skills 拉取与状态栏。
2. 共享状态（skills / settings / selectedIds / refreshCatalog）提取到 `useContext` + 自定义 hook（如 `useCatalog`），避免逐层 props 透传。
3. 保持无路由、无状态库的现状，`useContext` + `useReducer` 足够，不引入 Redux/Zustand 等额外依赖。

**涉及文件**：`src/App.tsx`（拆分）、新增 `src/views/*.tsx`、`src/hooks/useCatalog.ts`（可选）。

**验收**：`App.tsx` 行数降至 200 以内；各 View 独立可测；交互行为与拆分前完全一致。

---

## 5. P3 - 锦上添花

### P3-1 统一错误处理与日志

**问题**：后端大量 `.map_err(|e| e.to_string())` 把错误扁平化为字符串，前端只能 `setStatus(String(e))` 展示原始信息。无结构化错误码，无后端日志（仅 `eprintln!`）。

**方案**：定义 `AppError` 枚举（带错误码 + 用户友好消息 + 可选 debug 上下文），`#[tauri::command]` 统一返回 `Result<T, AppError>`。前端按错误码决定是提示、重试还是静默。后端引入 `tracing` 记录关键路径日志，落盘到 app_data_dir。

**涉及文件**：`src-tauri/src/error.rs`（新增）、全量 `#[tauri::command]` 签名、`src/api.ts`。

**验收**：前端能区分「目标路径不存在」「只读拒绝」「IO 失败」等类别并给出对应提示；`ssm.log` 落盘且含时间戳与调用栈。

### P3-2 注册表操作超时与取消

**问题**：`registry.rs` 的 `run_npx_skills` 同步执行 `npx skills` 子进程，网络慢或交互卡住时前端无超时、无取消能力，命令会一直挂起。

**方案**：给 `Command` 加 `wait_timeout`（如 60s），超时返回 `RegistryTimeout` 错误；交互式终端（`open_skills_cli_terminal`）保持现状（用户自管），仅对非交互命令加超时。

**涉及文件**：`src-tauri/src/registry.rs`。

**验收**：非交互 registry 命令 60s 未返回则前端收到明确超时错误而非无限等待。

---

## 6. 实施路线图

建议分四个阶段推进，每阶段可独立交付、独立验收：

| 阶段 | 内容 | 预期产出 |
|------|------|----------|
| 阶段一（基线） | P0-1 测试骨架 + P0-2 修复 prompt 降级 + P0-3 确认链 | 核心操作有测试保护，破坏性操作不再静默覆盖 |
| 阶段二（稳定性） | P1-1 扫描移出锁 + P1-2 watcher 动态更新 + P1-3 迁移版本号 | 大规模技能下不卡顿，schema 可演进 |
| 阶段三（工程化） | P2-1 CSP + P2-2 CLI 缓存 + P2-3 查询下推 + P2-4 前端拆分 | 安全面收敛，性能与可维护性提升 |
| 阶段四（打磨） | P3-1 错误处理 + P3-2 超时取消 | 用户体验与可观测性闭环 |

### 依赖与顺序约束

- P0-1 应最先做：后续 P0-2 / P0-3 的修复都需要测试兜底验证。
- P1-1 与 P1-2 强相关：锁粒度优化后 watcher 触发逻辑才有意义一起改。
- P2-3 依赖 P1-3：分页字段需要 schema 稳定后再加。
- P2-4 可独立进行，但建议在 P0-2 / P0-3 前端改动落地后再拆，避免合并冲突。

---

## 7. 风险与回滚

| 风险 | 影响 | 缓解 |
|------|------|------|
| P0-1 引入 tempfile 依赖增加构建时间 | 低 | 仅 dev-dependency，不影响发布包 |
| P1-1 锁粒度调整引入数据竞争 | 中 | 改动集中在 indexer/health，靠 P0-1 测试 + CodeReview 兜底；rusqlite Connection 非 Sync，保证短临界区即可 |
| P1-2 watcher 重建期间的抖动丢事件 | 低 | 重建后立即触发一次全量 rescan 兜底 |
| P1-3 迁移失败导致旧库无法打开 | 高 | 迁移前自动备份 ssm.db；迁移全程在事务内执行，失败回滚 |
| P2-1 CSP 过严导致 markdown 渲染异常 | 中 | 上线前用真实技能样本回归；保留快速回滚到 null 的能力 |
| P2-4 前端拆分引入交互回归 | 中 | 逐 View 拆分并回归，每步保持可运行 |

### 回滚策略

- 每个 P 项独立分支，合并后若出问题可单独 revert，不影响其它项。
- P1-3 迁移不可逆时，依赖启动时自动备份的 `ssm.db.bak` 恢复。
- P2-1 CSP 改动是单文件配置，回滚成本极低。

---

## 附录：优先级速查

| 编号 | 标题 | 优先级 | 一句话 |
|------|------|--------|--------|
| P0-1 | 搭建测试体系 | 必修 | 给破坏性操作补测试 |
| P0-2 | 修复 prompt 静默降级 | 必修 | 选「询问」不能变成「覆盖」 |
| P0-3 | 破坏性操作显式确认 | 必修 | 覆盖/同步/删除前明确告知 |
| P1-1 | 扫描移出 DB 锁 | 重要 | 扫描时不阻塞前端命令 |
| P1-2 | watcher 动态更新 | 重要 | toggle source 后监视集合跟着变 |
| P1-3 | 迁移引入版本号 | 重要 | schema 可安全演进 |
| P2-1 | 收敛 CSP | 改善 | 关掉 null CSP |
| P2-2 | command_exists 缓存 | 改善 | CLI 探测不重复跑 |
| P2-3 | 查询下推 + 分页 | 改善 | 大规模技能不卡 |
| P2-4 | 拆分 App.tsx | 改善 | 单文件 600+ 行拆成 View |
| P3-1 | 统一错误与日志 | 锦上添花 | 结构化错误码 + 落盘日志 |
| P3-2 | registry 超时取消 | 锦上添花 | npx 挂起不再无限等待 |
