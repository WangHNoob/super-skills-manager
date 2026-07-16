# Super Skills Manager (SSM)

把散落在 Cursor、Claude Code、Agents、skills.sh 各处的 Agent Skills，集中到一个轻量 Windows 桌面应用里管理。

本地索引、友好浏览、健康检查、组合打包、一键分发到新项目 —— 数据只留在本机。

## 为什么需要它

Agent Skills 往往同时存在于：

- 全局：`~/.cursor/skills`、`~/.claude/skills`、`~/.agents/skills`
- 项目：`.cursor/skills`、`.claude/skills`、`.agents/skills`
- 插件缓存、内置目录（只读）
- 经 `npx skills` / skills.sh 安装的副本

结果是：难找、难比、难复用，新项目每次都要手动拷目录。SSM 就是为这件事准备的本地管家。

## 功能亮点

- **统一技能库** — 多源扫描、筛选检索、Markdown 友好详情
- **副本与差异** — 发现同名多路径 skill，查看 diff，按需同步
- **安全复用** — 拖拽或批量复制到目标项目；删除进回收站；只读源可「提取为自有副本」
- **组合包 Bundle** — 把常用 skill 打成一组，新建项目一键落地
- **健康检查** — description / 结构 / 脚本依赖与风险提示；skills.sh 安装的 skill 可对照远端版本
- **Registry** — 在应用内调用 `npx skills`（搜索、安装、更新、移除）
- **策略与导出** — 冲突策略模板、ZIP 导入导出、标签与收藏

## 环境要求

- Windows x64
- 开发构建还需：[Node.js](https://nodejs.org/)、[Rust](https://www.rust-lang.org/)、[Tauri 前置依赖](https://v2.tauri.app/start/prerequisites/)

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
2. 在技能库中搜索、筛选，右侧查看详情
3. 在「源与项目」登记目标项目
4. 将 skill 拖到右侧目标项目槽（或预览复制）后执行
5. 用 Bundle / 向导把一组 skill 一键落到新项目
6. 在「健康」「Registry」页做检查与 skills.sh 操作

**快捷键：** `/` 搜索 · `Del` 删除（需确认）· `Esc` 关闭提示

## 技术栈

[Tauri 2](https://v2.tauri.app/) · React · TypeScript · SQLite

## 文档

| 文档 | 内容 |
|------|------|
| [docs/user-guide.md](docs/user-guide.md) | **使用指南**（推荐先读） |
| [docs/01-skill-sources.md](docs/01-skill-sources.md) | 扫描源路径与只读策略 |
| [docs/02-mvp-ia.md](docs/02-mvp-ia.md) | 界面信息架构 |
| [docs/03-data-model.md](docs/03-data-model.md) | 数据模型与索引 |
| [docs/04-health-rules.md](docs/04-health-rules.md) | 健康检查规则 |
| [docs/05-tech-spike.md](docs/05-tech-spike.md) | 技术选型记录（已采纳 Tauri 2） |

默认源配置：[`config/skill-sources.defaults.json`](config/skill-sources.defaults.json)

## 原则

- **本地优先** — 无强制账号与云同步
- **写操作可确认** — 删除与覆盖前可预览影响
- **尽量轻量** — 列表走索引，正文按需读取

## License

尚未指定许可证。使用或分发前请先与仓库维护者确认。
