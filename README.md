# Super Skills Manager (SSM)

把散落在 Cursor、Claude Code、Agents、skills.sh 各处的 Agent Skills，集中到一个轻量 Windows 桌面应用里管理。

本地索引、友好浏览、健康检查、组合打包、一键搭建新项目 —— 数据只留在本机。

## 为什么需要它

Agent Skills 往往同时存在于：

- 全局：`~/.cursor/skills`、`~/.claude/skills`、`~/.agents/skills`
- 项目：`.cursor/skills`、`.claude/skills`、`.agents/skills`
- 插件缓存、内置目录（只读）
- 经 `npx skills` / skills.sh 安装的副本

结果是：难找、难比、难复用，新项目每次都要手动拷目录。SSM 就是为这件事准备的本地管家。

## 功能亮点

- **统一技能库** — 多源扫描、筛选检索；点击卡片打开独立滚动的详情窗
- **副本与差异** — 发现同名多路径技能，查看 diff，按需同步
- **安全复用** — 拖到「目标项目」条或批量复制；删除进回收站；只读源可提取为自己的副本
- **新建项目** — 一页完成：选目录、勾选 `.claude` / `.agents` / `.cursor`、挑选本机技能、终端安装、健康检查
- **组合包** — 把常用技能打成一组，一键落到项目
- **健康检查** — 描述 / 结构 / 脚本风险；skills.sh 安装的可对照远端；可标出可能非最新项
- **在线安装** — 打开系统终端执行 `npx skills`，由你在终端里选择选项（不预填 `--yes` / `--copy`）
- **策略与导出** — 冲突策略模板、ZIP 导入导出、标签与收藏

## 环境要求

- Windows x64
- **在线安装 / 新建项目里装 skills.sh 技能**：本机需 [Node.js](https://nodejs.org/)（用于 `npx skills`）
- 开发构建还需：[Rust](https://www.rust-lang.org/)、[Tauri 前置依赖](https://v2.tauri.app/start/prerequisites/)

## 安装

### 使用安装包

构建成功后，安装包位于：

```
src-tauri/target/release/bundle/nsis/SSM_0.1.0_x64-setup.exe
```

也可使用同目录下的 `.msi`。若 Windows SmartScreen 提示未知应用，选择「仍要运行」。

> 后续如发布 [GitHub Releases](https://github.com/WangHNoob/super-skills-manager/releases)，可直接从 Releases 下载安装包。

### 从源码运行

```bash
git clone https://github.com/WangHNoob/super-skills-manager.git
cd super-skills-manager
npm install
npm run tauri:dev
```

生产构建：

```bash
npm run tauri:build
```

## 使用概览

更完整的步骤见 **[使用指南](docs/user-guide.md)**。

1. 打开应用后点击「重新扫描」
2. 在技能库中搜索、筛选，点击卡片打开详情
3. 在技能库顶部「目标项目」条选择项目，拖入技能或点「复制到项目」
4. 新项目推荐走 **新建项目** 页：建目录 → 选技能 / 终端安装 → 健康检查
5. 日常也可用 **组合包**、**健康检查**、**在线安装**

**快捷键：** `/` 搜索 · `Del` 删除（需确认）· `Esc` 关闭详情 / 提示  
界面上的 **?** 可悬停查看简短说明。

## 技术栈

[Tauri 2](https://v2.tauri.app/) · React · TypeScript · SQLite

## 文档

| 文档 | 内容 |
|------|------|
| [docs/user-guide.md](docs/user-guide.md) | **使用指南**（推荐先读） |
| [docs/01-skill-sources.md](docs/01-skill-sources.md) | 扫描源路径与只读策略 |
| [docs/02-mvp-ia.md](docs/02-mvp-ia.md) | 界面信息架构与交互 |
| [docs/03-data-model.md](docs/03-data-model.md) | 数据模型与索引 |
| [docs/04-health-rules.md](docs/04-health-rules.md) | 健康检查规则 |
| [docs/05-tech-spike.md](docs/05-tech-spike.md) | 技术选型记录（已采纳 Tauri 2） |

默认源配置：[`config/skill-sources.defaults.json`](config/skill-sources.defaults.json)

## 原则

- **本地优先** — 无强制账号与云同步
- **写操作可确认** — 删除与覆盖前可预览影响
- **交互交给终端** — skills.sh 安装选项在系统终端中完成，避免静默替你做主
- **尽量轻量** — 列表走索引，正文按需读取

## License

尚未指定许可证。使用或分发前请先与仓库维护者确认。
