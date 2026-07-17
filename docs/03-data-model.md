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
| `entryMtimeMs` | number | |
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
| `items` | skill 指针列表 |
| `defaultRuntimes` | 应用到项目时的默认写入目标 |
| `createdAt` / `updatedAt` / `version` | |

导出 JSON 可跨机器；本机应用优先按 id / name 匹配。

### 2.4 ProjectRoot

| 字段 | 说明 |
|------|------|
| `path` / `displayName` | |
| `lastUsedAt` | |
| `detectedStacks` | 新建项目 / 分析技术栈时使用，如 `node`、`rust` |

### 2.5 OpLogEntry

| 字段 | 说明 |
|------|------|
| `op` | `copy` / `delete` / `syncTwin` / `extractCopy` / `bundleApply` / `import` / … |
| `status` | `ok` \| `partial` \| `failed` |
| `sources` / `targets` | 路径列表 |
| `detail` | JSON |

当前不做撤销（无可靠 `undoToken` 回放）。

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

实现中包含（名称以代码为准）：

- `skills`、`twin_groups`、`bundles`、`project_roots`、`op_log`  
- `health_reports`（含 `registry_json`）  
- `content_history`（若启用）  
- 设置以 JSON / 表存储  

完整 DDL 以 `src-tauri/src/db.rs` 迁移逻辑为准；本文不重复维护逐字段 SQL。

## 4. 增量索引策略

### 4.1 启动

1. UI 先读库中 Catalog  
2. 后台 / 手动「重新扫描」走全量或按源增量  
3. 扫描后可跑健康检查  

### 4.2 监视

- 监视已启用源根与已登记项目下的 skills 路径  
- 事件防抖后触发增量刷新  
- 应用退出即停止  

### 4.3 剪枝

某源扫描结束后：磁盘已不存在的 `dir_path` 从索引删除；Twin / Bundle 引用需可容忍缺失。

## 5. 写操作与索引

| 操作 | 索引更新 |
|------|----------|
| copy / extractCopy | 目标 upsert；可更新 `lastUsedAt` |
| delete | 删行；twin 重组 |
| syncTwin | 覆盖目标后重索引 |
| bundleApply | 多次 copy |
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
