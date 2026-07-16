# AI Skills 超级管理器（SSM）

Windows 轻量桌面应用：统一管理 Cursor / Claude Code / Agents / skills.sh 生态中的 Agent Skills。

**定位：** 本地优先的技能资产管家 —— 索引 → 理解 → 组合 → 分发。  
**技术栈：** Tauri 2 + React + TypeScript + SQLite（rusqlite）

## 快速开始

```bash
npm install
npm run tauri:dev
```

## 发布打包

```bash
npm run tauri:build
```

构建产物（发给别人优先用安装包）：

| 文件 | 说明 |
|------|------|
| `src-tauri/target/release/bundle/nsis/SSM_0.1.0_x64-setup.exe` | **推荐** NSIS 安装包 |
| `src-tauri/target/release/bundle/msi/SSM_0.1.0_x64_en-US.msi` | MSI 安装包 |
| `src-tauri/target/release/ssm-app.exe` | 免安装可执行文件 |

对方需 64 位 Windows。若 SmartScreen 拦截，选择「仍要运行」。

## 界面与快捷键

三栏主界面：左侧筛选 / 中技能库 / 右侧详情 + 底部目标项目。

| 快捷键 | 作用 |
|--------|------|
| `/` | 聚焦搜索 |
| `Del` | 删除选中（仍二次确认） |
| `Esc` | 关闭状态提示 / 副本 diff |

技能卡片可拖到右侧「目标项目」槽生成复制预览（默认复制）。健康页支持「打开目录」。

## 当前能力

### MVP
- 多源扫描（Cursor / Claude / Agents / 插件只读 / Codex 等）
- 技能库卡片 + 筛选检索 + Markdown 友好详情
- 副本（twins）检测与「以 A 同步到 B」
- 复制到目标项目（可多 runtime）+ 安全删除（回收站）
- 只读源「提取为自有副本」
- Bundle 创建 / 导入导出 / 一键应用到项目
- 操作日志 + 轻量文件监视

### P1
- **健康检查**：规则引擎打分（META/DESC/BODY/DEP/RISK/SRC/REG）；Health 页可展开问题、打开目录
- **skills.sh 对照**：仅对 `~/.agents/.skill-lock.json` 中的 skill 拉取远端 `SKILL.md` 并展示 diff；本地手写 skill 不因「未纳入锁文件」扣分
- **项目就绪向导**：检测技术栈并推荐 Bundle，支持生成/一键应用
- **Registry 桥接**：封装 `npx skills` 的 find / list / add / update / remove

### P2
- **策略模板**：均衡 / 保守 / 项目优先覆盖 / 保留双方；可禁止插件 skill 直拷项目
- **导入导出**：所选 skill 打包 ZIP 导出；设置页导入 ZIP 到 `~/.agents/skills`
- **使用洞察**：收藏筛选、最近使用（复制时更新）、左侧常用快捷入口
- **变更历史**：按 content hash 记录 scan/export/import 事件
- **脚本风险明细**：详情中展示命中行号与代码片段

### P3
- **拖拽复制**：卡片拖到目标项目槽 → 预览 → 执行
- **副本 diff**：同名多路径 skill 查看 `SKILL.md` unified diff，再决定同步
- **用户标签**：详情增删；左侧按标签筛选（扫描时保留）
- **详情排版**：导语 / 分区 / 大纲与历史默认折叠；目标项目固定底栏

## 文档

| 文档 | 说明 |
|------|------|
| [docs/01-skill-sources.md](docs/01-skill-sources.md) | 源路径与只读策略 |
| [docs/02-mvp-ia.md](docs/02-mvp-ia.md) | 三栏信息架构 |
| [docs/03-data-model.md](docs/03-data-model.md) | 数据模型与索引 |
| [docs/04-health-rules.md](docs/04-health-rules.md) | 健康检查规则（含 REG 适用范围） |
| [docs/05-tech-spike.md](docs/05-tech-spike.md) | 技术选型对比 |

机器可读配置：[`config/skill-sources.defaults.json`](config/skill-sources.defaults.json)
