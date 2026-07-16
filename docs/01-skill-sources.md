# 01 — Skill 源路径表与只读策略

机器可读默认配置见 [`config/skill-sources.defaults.json`](../config/skill-sources.defaults.json)。

## 1. 识别规则

一个目录被视为 Skill，当且仅当：

1. 目录内存在入口文件 `SKILL.md`（大小写按平台惯例；Windows 下不区分大小写）
2. 该目录位于某个已启用「源根」之下，且相对深度 ≤ `maxDepthBelowSkillsRoot`（默认 2）
3. 路径不落在排除目录名中（`.git`、`node_modules` 等）

解析约定：

- **frontmatter**（YAML）：至少读取 `name`、`description`；可选 `disable-model-invocation` 等
- **正文**：按需加载，不进入列表索引的全量缓存
- **符号链接**：跟随解析，但 Catalog 中保留 `isSymlink` 与 `realpath`，便于副本/漂移判断

## 2. MVP 必扫源（Windows）

`~` = `%USERPROFILE%`；`<project>` = 用户登记的项目根。

| Source ID | 标签 | Runtime | Scope | Access | 路径 |
|-----------|------|---------|-------|--------|------|
| `cursor-global-user` | Cursor 用户 | cursor | global | RW | `~\.cursor\skills` |
| `cursor-builtin` | Cursor 内置 | cursor | global | **RO** | `~\.cursor\skills-cursor` |
| `cursor-plugin-cache` | 插件缓存 | plugin | global | **RO** | `~\.cursor\plugins\cache\**\skills` |
| `cursor-project-native` | Cursor 项目(.cursor) | cursor | project | RW | `<project>\.cursor\skills` |
| `claude-global` | Claude 全局 | claude | global | RW | `~\.claude\skills` |
| `claude-project` | Claude 项目 | claude | project | RW | `<project>\.claude\skills` |
| `agents-global-user` | Agents 全局 | agents | global | RW | `~\.agents\skills` |
| `agents-global-config` | Agents 全局(config) | agents | global | RW | `~\.config\agents\skills` |
| `agents-project` | Agents 项目 | agents | project | RW | `<project>\.agents\skills` |
| `codex-global` | Codex 全局 | codex | global | RW | `~\.codex\skills` |

### 路径双轨说明（必须兼容）

| 体系 | Cursor 项目路径 | Cursor 全局路径 |
|------|-----------------|-----------------|
| Cursor 官方文档 / create-skill | `.cursor/skills/` | `~/.cursor/skills/` |
| skills CLI (`npx skills`) | `.agents/skills/` | `~/.cursor/skills/` |

**产品策略：** 扫描两者；写入项目时默认优先 `.agents/skills/`（与 CLI 一致），可选同时写入 `.cursor/skills/`（设置项 `alsoWriteNativeCursor`）。

## 3. 主流扩展源（默认关闭，设置中可开）

| Source ID | Runtime | Global Path |
|-----------|---------|-------------|
| `opencode-global` | opencode | `~\.config\opencode\skills` |
| `gemini-cli-global` | gemini | `~\.gemini\skills` |
| `copilot-global` | copilot | `~\.copilot\skills` |
| `custom-user` | custom | 用户追加 |

完整 agent 矩阵以 [vercel-labs/skills Supported Agents](https://github.com/vercel-labs/skills) 为准；应用内「添加源」可用该表生成模板，避免内置 70+ 路径拖慢默认启动。

## 4. 项目根如何发现（禁止全盘扫盘）

按优先级合并，去重：

1. 用户手动「添加项目」
2. 应用内「最近目标项目」历史
3. 可选：从 Cursor 最近工作区列表读取（若本地状态文件可读）
4. 可选：当前已打开的目标项目槽

**不做：** 遍历整个 `C:\` 或所有磁盘找 `.git`。

## 5. 只读策略（硬规则）

### 硬只读源

- `cursor-builtin`（`skills-cursor`）
- `cursor-plugin-cache`

### 允许

`view` / `search` / `diff` / `extractCopy` / `openInExplorer` / `openInEditor`

### 禁止

`delete` / `move` / `overwriteInPlace` / `dropInto` / `editInPlace`

### 提取副本

从只读源复制到默认可写目标：`~\.agents\skills\<name>`（可改），并在操作日志中记录 `extractCopy`。

## 6. 写入映射（复制 / Bundle 应用）

| 目标 Runtime | Global | Project |
|--------------|--------|---------|
| cursor | `~\.cursor\skills\<name>` | 优先 `<project>\.agents\skills\<name>`；可选再写 `.cursor\skills` |
| claude | `~\.claude\skills\<name>` | `<project>\.claude\skills\<name>` |
| agents | `~\.agents\skills\<name>` | `<project>\.agents\skills\<name>` |
| codex | `~\.codex\skills\<name>` | `<project>\.agents\skills\<name>` |

- 拖拽默认 **复制**；移动需修饰键或设置切换
- **多运行时同步** 默认关闭；开启后一次写入用户勾选的 runtime 集合
- 冲突策略默认 `prompt`：跳过 / 覆盖 / 重命名

### 删除

- 仅 RW 源
- 预览影响：多副本、Bundle 引用
- 默认进回收站（`recycleBinForDeletes: true`），不直接 `unlink`（实现阶段再定 Windows API）

## 7. skills.sh / `npx skills` 桥接

| 能力 | CLI | 阶段 |
|------|-----|------|
| 搜索 | `npx skills find` | P1 |
| 安装 | `npx skills add` | P1 |
| 列表 | `npx skills list` | P1 |
| 更新 | `npx skills update` | P1 |
| 移除 | `npx skills remove` | P1（与应用内删除需防双重操作） |

安装偏好：Windows 默认 `--copy`；高级选项允许 symlink。  
Registry UI：https://skills.sh

## 8. 验收清单

- [ ] 本机同时存在 `.claude` 与 `.agents` 同名 skill 时，两者均被索引且进入副本组
- [ ] 内置 / 插件 skill 无法删除或拖入覆盖
- [ ] 登记项目后，`.agents/skills` 与 `.cursor/skills` 均可发现
- [ ] 自定义源路径可追加并参与扫描
