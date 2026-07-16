# AI Skills 超级管理器（SSM）

Windows 轻量桌面应用：统一管理 Cursor / Claude Code / Agents / skills.sh 生态中的 Agent Skills。

**技术栈：** Tauri 2 + React + TypeScript + SQLite（rusqlite）

## 快速开始

```bash
npm install
npm run tauri dev
```

发布构建：

```bash
npm run tauri build
```

## 当前能力

### MVP
- 多源扫描（Cursor / Claude / Agents / 插件只读 / Codex 等）
- 技能库卡片 + 筛选检索 + Markdown 友好详情
- 副本（twins）检测与「以 A 同步到 B」
- 复制到目标项目（可多 runtime）+ 安全删除（回收站）
- 只读源「提取为自有副本」
- Bundle 创建 / 导入导出 / 一键应用到项目
- 操作日志

### P1
- **健康检查**：规则引擎打分（META/DESC/BODY/DEP/RISK/SRC），详情与 Health 页；META003 可一键修复 name
- **项目就绪向导**：检测技术栈并推荐 Bundle，支持生成/一键应用
- **Registry 桥接**：封装 `npx skills` 的 find / list / add / update

## 文档

| 文档 | 说明 |
|------|------|
| [docs/01-skill-sources.md](docs/01-skill-sources.md) | 源路径与只读策略 |
| [docs/02-mvp-ia.md](docs/02-mvp-ia.md) | 三栏信息架构 |
| [docs/03-data-model.md](docs/03-data-model.md) | 数据模型与索引 |
| [docs/04-health-rules.md](docs/04-health-rules.md) | P1 健康检查规则 |
| [docs/05-tech-spike.md](docs/05-tech-spike.md) | 技术选型对比 |

机器可读配置：`config/skill-sources.defaults.json`
