# 07 - 性能分析

> **状态：已实施（PERF-1～5、PERF-7）。** 基于 v0.1.0 修复落地后的当前代码（CodeGraph 符号 + 调用路径 + 源码核查）形成。
> 上一轮优化方案（06）中的扫描移锁、watcher 重建、迁移版本号、CLI 缓存、SQL 下推、前端拆分等多数已落地，本文聚焦当时仍存在的性能热点。
> PERF-6（视图常驻）影响低、改动面大，暂缓。

## 1. 现状基线

此前最严重的"扫描持长锁阻塞全部命令"已消除：`scan_root` 目录遍历不持锁，仅写库时短锁（indexer.rs:202）；watcher 支持 `WatchControl::Rebuild` 动态重建；DB 迁移有版本号；`probe_cli_dict` 批量探测 CLI；`list_skills` 过滤下推 SQL 并支持分页；前端拆分到 `CatalogContext` + `views/`。

当前剩余问题集中在三个热路径仍缺乏增量/缓存机制，以及前端刷新缺乏节流。按影响从大到小排列。

---

## 2. 核心问题

### PERF-1 健康检查对每个技能无条件全量分析，且每次都发网络请求（P0）

**当前最大瓶颈。**

**定位**：`run_health_for_list`（health.rs:659）对传入技能逐个调用 `analyze_skill_with_cli`，无"内容未变则跳过"判断：

```rust
let cli_cache = probe_cli_dict();
for skill in skills {
    // ... 取 twins ...
    reports.push(analyze_skill_with_cli(skill, &twins, Some(&cli_cache)));
}
```

而 `analyze_skill_with_cli`（health.rs:130）**第一行**就是网络请求：

```rust
let registry = registry_compare::compare_skill_to_registry(&skill.name, &dir);
```

`compare_skill_to_registry`（registry_compare.rs:189）对在锁文件中的技能调用 `fetch_remote_cached` 拉取远端 SKILL.md（`ureq`，12s 超时，registry_compare.rs:95）。

**影响**：50 个技能、10 个在锁文件中，每次"重新扫描"会串行发起 10 次网络请求，最坏 120s，期间 UI 显示"扫描中…"且无法中断；同时全部 50 个技能重读 SKILL.md + 两次 walkdir scripts。

关键矛盾：`db.get_health_cache(skill_id, content_hash)`（db.rs:319）已实现按 content_hash 命中缓存的查询，但 `run_health_for_list` **从未调用它**。缓存基础设施建好了却没接上。

**建议方向**：

- 在 `analyze_skill_with_cli` 之前先 `get_health_cache(&skill.id, &skill.content_hash)`，命中则复用，跳过网络请求与文件重读。
- registry 网络对照从"每次全量健康检查"降级为"按需触发"或"后台低频刷新"，主路径只做本地规则分析。
- `fetch_remote_cached` 的 `REMOTE_CACHE`（registry_compare.rs:27）只缓存本轮 URL->文本，可扩展为跨 content_hash 复用。

**验收**：连续两次"重新扫描"，第二次命中缓存的技能不触发网络请求、不重读文件；仅内容变化的技能才全量分析。

### PERF-2 全量扫描对每个技能重算 content_hash，不跳过未变更目录（P0）

**定位**：`scan_root`（indexer.rs:192）对每个目录无条件调用 `index_skill_dir`，后者调用 `content_hash(dir)`（hashutil.rs:18）。`content_hash` 对每个技能目录 walkdir + 逐文件 `read_to_end` + SHA256。

`scan_root` 已拿到旧记录（`get_skill_by_path` 返回含 `entry_mtime_ms` 的 `old`），但只用它保留 `favorite/tags/health_score`，**未用 mtime 跳过重哈希**：

```rust
if let Ok(Some(old)) = guard.get_skill_by_path(&rec.dir_path) {
    rec.favorite = old.favorite;   // 只保留元数据
    // 未比较 entry_mtime_ms 决定是否跳过 content_hash
}
```

**影响**：watcher 抖动（即使只改一个技能）触发 `rescan` -> `full_scan` 对所有启用 source 的所有技能重算哈希。`scan_dirty` + 节流已合并为一次 rescan，但这一次仍是全量的。

**建议方向**：`index_skill_dir` 接收 `Option<&SkillRecord>`（旧记录），若 `entry_mtime_ms` 未变且 `has_scripts` 一致，沿用旧 `content_hash`，跳过 walkdir + 读文件。

**验收**：未修改的技能第二次扫描不产生文件读 IO（可通过 tracing 或测试断言 `content_hash` 未重算）。

### PERF-3 前端 refreshCatalog 无 debounce，每次按键触发 10 路并发拉取（P1）

**定位**：`CatalogContext` 的 `refreshCatalog` 依赖 `[query, runtimeFilter, twinsOnly, favoritesOnly, tagFilter]`，effect 在其变化时立即触发。`query` 是搜索框输入，每按一个字符就重建 `refreshCatalog` -> 触发 10 个并发 invoke，其中 8 个与 query 无关（sources/bundles/projects/settings/policyTemplates/insights/tags/healthReports）：

```tsx
const refreshCatalog = useCallback(async () => {
  const [...] = await Promise.all([
    api.listSkills(filter), api.listSources(), api.listBundles(),
    api.listProjects(), api.getSettings(), api.listOplog(30),
    api.listHealthReports(), api.listPolicyTemplates(),
    api.getUsageInsights(), api.listSkillTags(),
  ]);
}, [query, runtimeFilter, twinsOnly, favoritesOnly, tagFilter]);
```

**影响**：搜索时每键 10 个 IPC，8 个冗余；10 个 `setState` 触发整树重渲染；`list_health_reports` 全量无分页（db.rs:376）。

**建议方向**：

- `query` 的 effect 加 debounce（200-300ms）。
- 与 query 无关的数据拆到独立 effect，仅挂载和 `handleScan`/`pickProject` 后刷新；只有 `listSkills(filter)` 跟随 query（且加 debounce）。

**验收**：搜索框连续输入 5 个字符，后端 `list_skills` 仅被调用 1 次（debounce 后），其余 8 个接口 0 次调用。

### PERF-4 scan_root 逐技能单独加锁写库，无批量事务（P1）

**定位**：`scan_root`（indexer.rs:206）每技能 `db.lock()` + `get_skill_by_path` + `upsert_skill` + `record_hash_if_changed`，N 个技能 = N 次独立 SQLite 事务。

**影响**：相对 PERF-1/2 较小，但数百技能时逐条事务累积开销可观（每次 WAL 写 fsync）。

**建议方向**：单事务批量 upsert（`execute_batch` 或显式 `BEGIN`/`COMMIT`），`record_hash_if_changed` 合并进同一事务。

**验收**：扫描 N 个技能的事务数从 N 降为 1（或每 source 1 个）。

---

## 3. 次要问题

### PERF-5 analyze_skill 内 scripts 目录被遍历两次（P2）

`analyze_skill_with_cli` 里 `script_names(&dir)`（health.rs:109）和 `read_scripts_text(&dir)`（health.rs:92）是两次独立的 `WalkDir::new(scripts)` 遍历，前者取文件名，后者读全文。可合并为一次遍历同时产出名字和内容。单次开销不大，但乘以技能数和健康检查频率后累积。

### PERF-6 AppShell 始终挂载全部视图（P3）

App.tsx:96-111 里 LibraryView/BundlesView/HealthView/RegistryView/SettingsView/SourcesView/OpLogView 始终挂载（注释说明为保留跨 tab 状态），仅 wizard 条件渲染。切 tab 时这些视图不卸载，各自内部 effect/state 持续存在。当前各视图为纯展示型，影响有限，但随着视图变复杂会成为隐患。

### PERF-7 list_health_reports 全量无分页（P2）

`list_health_reports`（db.rs:376）`SELECT * FROM health_reports` 无 LIMIT，前端 `refreshCatalog` 每次全量拉取。技能上百后单次 IPC 载荷和反序列化都会变大。`list_skills` 已有分页，health_reports 没有。

---

## 4. 优先级总览

| 编号 | 问题 | 影响 | 修复难度 | 优先级 | 状态 |
|------|------|------|----------|--------|------|
| PERF-1 | 健康检查不跳过未变更技能 + 每次网络请求 | 极高（秒级->分钟级阻塞） | 低（接上已有的 get_health_cache） | P0 | 已落地 |
| PERF-2 | 扫描不跳过未变更目录的重哈希 | 高（纯 IO 浪费） | 低-中（mtime 比较跳过） | P0 | 已落地 |
| PERF-3 | refreshCatalog 无 debounce + 冗余拉取 | 中高（搜索卡顿） | 低（debounce + 拆 effect） | P1 | 已落地 |
| PERF-4 | scan_root 逐技能事务 | 中（数量大时累积） | 中（批量事务） | P1 | 已落地 |
| PERF-5 | scripts 目录遍历两次 | 低 | 低 | P2 | 已落地 |
| PERF-7 | health_reports 无分页 | 低-中 | 低 | P2 | 已落地 |
| PERF-6 | 视图常驻 | 低 | 中 | P3 | 暂缓 |

最关键的一点：PERF-1 和 PERF-2 的修复都**不需要新基础设施**——`get_health_cache` 已写好只差调用，`entry_mtime_ms` 已算好只差比较。这两个改动投入极小、收益极大，建议作为下一步首选。
