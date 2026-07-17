# 01 — Skill 源路径表与只读策略

机器可读默认配置见 [`config/skill-sources.defaults.json`](../config/skill-sources.defaults.json)。

## 1. 识别规则

一个目录被视为 Skill，当且仅当：

1. 目录内存在入口文件 `SKILL.md`（Windows 下不区分大小写）
2. 该目录位于某个已启用「源根」之下，且相对深度 ≤ `maxDepthBelowSkillsRoot`（默认 2）
3. 路径不落在排除目录名中（`.git`、`node_modules` 等）

解析约定：

- **frontmatter**（YAML）：至少读取 `name`、`description`；可选 `disable-model-invocation` 等
- **正文**：按需加载，不进入列表索引的全量缓存
- **符号链接**：跟随解析；Catalog 保留 `isSymlink` 与 `realpath`

## 2. 默认识别源（Windows）

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

### 路径双轨说明

| 体系 | Cursor 项目路径 | Cursor 全局路径 |
|------|-----------------|-----------------|
| Cursor 官方文档 / create-skill | `.cursor/skills/` | `~/.cursor/skills/` |
| skills CLI (`npx skills`) | `.agents/skills/` | 依 CLI 配置 |

**产品策略：** 扫描两者；写入项目时默认可写 `.agents` / `.claude` / `.cursor`（用户勾选）；可选 `alsoWriteNativeCursor`。

## 3. 扩展源（默认关闭）

| Source ID | Runtime | Global Path |
|-----------|---------|-------------|
| `opencode-global` | opencode | `~\.config\opencode\skills` |
| `gemini-cli-global` | gemini | `~\.gemini\skills` |
| `copilot-global` | copilot | `~\.copilot\skills` |
| `custom-user` | custom | 用户追加 |

完整 agent 矩阵可参考 [vercel-labs/skills Supported Agents](https://github.com/vercel-labs/skills)。

## 4. 项目根如何发现

按优先级合并、去重：

1. 用户手动「添加项目」
2. 目标项目槽中的当前选择
3. （可选增强）编辑器最近工作区 —— **当前未实现全盘扫描**

**不做：** 遍历整个 `C:\` 找 `.git`。

## 5. 只读策略（硬规则）

### 硬只读源

- `cursor-builtin`（`skills-cursor`）
- `cursor-plugin-cache`

### 允许

`view` / `search` / `diff` / `extractCopy` / `openInExplorer`

### 禁止

`delete` / `move` / `overwriteInPlace` / `dropInto` / `editInPlace`

### 提取副本

从只读源复制到默认可写目标：`~\.agents\skills\<name>`，并记入操作日志 `extractCopy`。

## 6. 写入映射（复制 / Bundle 应用）

| 目标 Runtime | Global | Project |
|--------------|--------|---------|
| cursor | `~\.cursor\skills\<name>` | `<project>\.cursor\skills\<name>`（及/或 `.agents`） |
| claude | `~\.claude\skills\<name>` | `<project>\.claude\skills\<name>` |
| agents | `~\.agents\skills\<name>` | `<project>\.agents\skills\<name>` |
| codex | `~\.codex\skills\<name>` | 按产品映射写入项目约定目录 |

- 拖拽默认 **复制**，先预览再执行  
- 冲突策略：覆盖 / 跳过 / 重命名（设置与策略模板）  
- 可启用「禁止把插件 skill 直接拷进项目」

### 删除

- 仅 RW 源  
- 确认框展示：副本数、Bundle 引用  
- 进入系统回收站（`trash`）

## 7. skills.sh / `npx skills` 桥接

应用通过 **打开系统交互终端** 调用 CLI（优先 Windows Terminal，否则 `cmd`），预执行最基础命令，**不**预填 `--yes` / `--copy` / `-a` / `-s`；选项由用户在终端中选择。

| 能力 | 终端预填示例 | 入口 |
|------|--------------|------|
| 搜索 | `npx skills find [关键词]` | 在线安装 / 新建项目 |
| 安装（全局） | `npx skills add <包> -g` | 在线安装 |
| 安装（项目） | `npx skills add <包>`（`cwd`=项目根） | 新建项目 |
| 列表 | 应用内捕获 `npx skills list -g`（无需交互） | 在线安装 |
| 更新 | `npx skills update [-g]` | 在线安装 / 新建项目 |
| 移除 | `npx skills remove [名] [--global]` | 在线安装 |

另提供后端：`scaffold_project`（创建 `.claude` / `.agents` / `.cursor` 的 `skills` 目录）、`run_health_scan_scoped`（按项目或 skillIds 检查）。

健康检查会读取 `~\.agents\.skill-lock.json`，**仅对锁文件中的 skill** 对照远端 `SKILL.md`（见 [04-health-rules.md](04-health-rules.md)）。

技能目录与官网：https://skills.sh

## 8. 验收要点

- 同时存在 `.claude` 与 `.agents` 同名 skill 时，两者均被索引并可进副本组  
- 内置 / 插件 skill 无法就地删除或覆盖  
- 登记项目后，项目级 skills 可发现  
- 源开关变更后重新扫描生效  
- 交互类 `npx skills` 命令打开独立终端，用户可完成选项选择  
