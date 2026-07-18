# 03 — 数据模型与增量索引策略

配套 Schema：[`schemas/skill-catalog.schema.json`](../schemas/skill-catalog.schema.json)  
实现：SQLite（`rusqlite`），库文件位于应用数据目录。

## 1. 存储分层

| 层 | 用途 | 形态 |
|----|------|------|
| 元数据索引 | 列表、筛选、副本关系 | SQLite `skills` 等表 |
| 正文 | 详情渲染 | 按需读文件系统 |
| 应用状态 | Bundle、项目根、设置、OpLog、健康报告 | SQLite |
| 远端对照缓存 | skills.sh `SKILL.md` 拉取 | 进程内短时缓存 |

原则：**UI 列表只绑索引行；打开详情才读 `SKILL.md`。**

## 2. 实体定义

### 2.1 SkillRecord（索引行）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 稳定 ID（路径相关） |
| `name` / `description` | string | frontmatter；缺 name 时用目录名 |
| `dirPath` / `entryPath` / `realpath` | string | 目录、`SKILL.md`、解析后路径 |
| `isSymlink` | bool | |
| `sourceId` / `runtime` / `scope` / `origin` / `access` | string | 源与权限 |
| `projectRoot` | string? | 项目级时有值 |
| `contentHash` | string | 目录内容指纹 |
| `entryMtimeMs` | number | 参与哈希文件的最大 mtime（`content_mtime_ms`，用于跳过重哈希） |
| `hasScripts` | bool | |
| `frontmatterFlags` | object | |
| `tags` | string[] | 用户标签（扫描时保留） |
| `favorite` | bool | |
| `twinGroupId` | string? | |
| `healthScore` | number? | 最近健康分 |
| `lastUsedAt` | number? | 复制等到项目时更新 |
| `indexedAt` | number | |
| `error` | string? | |

**contentHash：** 对 skill 目录内相关文件按相对路径排序后拼接 `path + hash(file)`，再整体 sha256。同 hash ⇒ 内容一致。

### 2.2 TwinGroup

| 字段 | 说明 |
|------|------|
| `id` / `keyType` / `key` | 分组 |
| `skillIds` | 成员 |
| `status` | `identical` \| `diverged` \| … |

### 2.3 Bundle

| 字段 | 说明 |
|------|------|
| `id` / `name` / `description` | |
| `items` | skill 指针列表（`SkillRef::Id` 或 `NameHash`） |
| `defaultRuntimes` | 应用到项目时的默认写入目标 |
| `createdAt` / `updatedAt` / `version` | |

导出 JSON 可跨机器；本机应用优先按 id / name 匹配。`update_bundle` 可改名并按 skill_ids 重建 items；`preview_bundle` 生成应用预览（不执行）。

### 2.4 ProjectRoot

| 字段 | 说明 |
|------|------|
| `id` / `path` / `displayName` | |
| `lastUsedAt` | |
| `origin` | `manual`（用户手动添加）\| `discovered`（由工作区根自动发现，v4 起）|
| `discoveredFrom` | 发现来源 `WorkspaceRoot.id`；手动项目为空（v4 起）|

> 新增 `WorkspaceRoot`（v4）：`id` / `path` / `displayName` / `enabled` / `addedAt` / `lastScanAt?`。工作区根下的项目发现见 `discover.rs`，发现的项目经现有 project-scope 扫描分支自动索引。

> 技术栈检测不落在 `ProjectRoot`，而由 `analyze_project` 返回的 `ProjectProfile` 承载（见 `project.rs::detect_stacks`）：识别 `node` / `rust` / `python` / `go` / `java` / `dotnet` / `frontend`，并附带推荐组合（`BundleRecommendation[]`）。

### 2.5 OpLogEntry

| 字段 | 说明 |
|------|------|
| `op` | `copy` / `delete` / `syncTwin` / `extractCopy` / `bundleApply` / `import` / `restore` / … |
| `status` | `ok` \| `partial` \| `failed` |
| `sources` / `targets` | 路径列表 |
| `detail` | JSON（`errors` / `missing` / `policy` / `bundleName` / `blockedReadonly` 等） |

当前不做撤销（无可靠 `undoToken` 回放）；`delete` 进系统回收站，`restore` 操作可从回收站按原路径还原（`trash::os_limited`，仅 Windows/macOS）。

### 2.6 HealthReport

| 字段 | 说明 |
|------|------|
| `skillId` / `skillName` / `score` / `grade` | |
| `issues[]` | `ruleId`、`severity`、`message`、`fixHint`、`autoFix` |
| `contentHash` | 缓存键 |
| `registry` | 可选；仅锁文件内 skill 有对照结果 |
| `dirPath` | 联查自 `skills`，供「打开目录」 |

### 2.7 ContentHistory（变更历史）

按 skill 记录 scan / export / import 等事件与当时 `contentHash`（详情可展开）。

### 2.8 AppSettings（摘录）

- `enabledSourceIds`  
- `writeRuntimes` / `targetProject`  
- `conflictPolicy` / `policyTemplateId`  
- `blockPluginCopyToProject`  
- `alsoWriteNativeCursor` / `multiRuntimeSync`  

## 3. 主要 SQLite 表

实现见 `src-tauri/src/db.rs` 的迁移逻辑（`migrate` + `migrate_v1_baseline` / `migrate_v2_columns` / `migrate_v3_content_history` / `migrate_v4_workspace_roots`）：

- `schema_version` - 单行单列，当前 `LATEST = 4`；迁移前自动备份 `ssm.db.bak`
- `skills`、`twin_groups`、`bundles`、`project_roots`（v4 加 `origin` / `discovered_from`）、`op_log`
- `workspace_roots`（v4 新增：`id/path/display_name/enabled/added_at/last_scan_at`）
- `health_reports`（含 `registry_json`、`skill_name`）
- `content_history`（v3 起始终创建；记录 scan / export / import 事件与 `content_hash`）
- `settings`（键值表，`settings` 键存 `AppSettings` JSON）
- `scan_state`（根指纹与上次扫描时间）

迁移全程在版本号门控下执行，失败返回错误而非静默忽略；全新库从 0 一步到最新。本文不重复维护逐字段 SQL，完整 DDL 以 `db.rs` 为准。

## 4. 增量索引策略

### 4.1 启动

1. UI 先读库中 Catalog  
2. 后台 / 手动「重新扫描」走全量或按源增量  
3. 扫描后可跑健康检查  

### 4.2 监视

- 监视已启用源根与已登记项目下的 skills 路径（`notify-debouncer-mini`）
- 支持 `WatchControl::Rebuild` 动态重建 watch 集合：toggle 源、增删项目后由 `request_watch_rebuild` 触发
- FS 事件仅置 `AtomicBool scan_dirty` 脏标记，由后台线程 2s 节流合并触发一次 `rescan`，非每事件即扫
- 重建 watch 集合后兜底扫一次；应用退出即停止

### 4.3 剪枝

某源扫描结束后：`delete_skills_not_in` 将磁盘已不存在的 `dir_path` 从索引删除；Twin / Bundle 引用需可容忍缺失。扫描写库合并为每 source/root 一笔事务（`with_transaction`）。

### 4.4 跳过重哈希

`index_skill_dir_with_previous` 接收旧记录：若 `entry_mtime_ms` 与 `has_scripts` 均未变且旧 `content_hash` 非空，则复用旧哈希，跳过 walkdir + 读文件（`indexer.rs`）。

## 5. 写操作与索引

| 操作 | 索引更新 |
|------|----------|
| copy / extractCopy | 目标 upsert；可更新 `lastUsedAt` |
| delete | 删行；twin 重组；磁盘进回收站 |
| restore | 从回收站还原目录后 rescan 重新 upsert |
| syncTwin | 覆盖目标后重索引 |
| bundleApply | 多次 copy（经 preview_bundle + execute_copy） |
| ZIP import/export | 写盘 + 索引 / 历史 |

写操作记入 OpLog。

## 6. Bundle 导出示例

```json
{
  "version": 1,
  "name": "前端审查包",
  "description": "UI 规范 + 架构防腐",
  "defaultRuntimes": ["agents", "claude"],
  "items": [
    {
      "skillRef": {
        "by": "name+hash",
        "name": "web-design-guidelines",
        "contentHash": "abc..."
      },
      "optional": false
    }
  ]
}
```

## 7. 验收要点

- 冷启动能先出上次 Catalog  
- 删除磁盘目录后索引可剪枝  
- 标签 / 收藏在重新扫描后仍保留  
- Bundle 导入导出可用  
- 列表可按 `projectRoot` 过滤；健康检查可按项目或 skillIds 范围执行（新建项目页）  
- `scaffold_project` 可创建 `.claude/skills`、`.agents/skills`、`.cursor/skills`  
