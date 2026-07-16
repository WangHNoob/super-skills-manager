# 02 — MVP 信息架构与三栏交互

## 1. 设计目标

一屏完成主任务：**发现技能 → 看懂技能 → 选中目标项目 → 复制/应用 Bundle**。  
轻量：默认无仪表盘堆砌；首屏即工作台。

## 2. 导航结构

```
App
├── Library（默认首页）     # 三栏工作台
├── Bundles                 # 组合包管理（也可从左栏进入）
├── Sources                 # 源与项目根配置
├── Health（P1，入口可灰）  # 健康报告
├── Registry（P1）          # skills.sh 桥接
└── Settings / OpLog        # 设置与操作日志
```

MVP 必须可点击：`Library`、`Bundles`、`Sources`、`Settings/OpLog`。  
`Health` / `Registry` 可留导航占位，功能进 P1。

## 3. Library 三栏布局

```text
┌──────────────┬────────────────────────────┬──────────────────────────┐
│ Left Rail    │ Center Catalog             │ Right Inspector          │
│ 240–280px    │ flex                       │ 320–400px                │
├──────────────┼────────────────────────────┼──────────────────────────┤
│ 搜索框       │ 工具条：视图/排序/多选     │ Skill 友好详情           │
│ 源过滤       │ Skill 卡片网格/列表        │ ─ 元数据条               │
│ Runtime/Scope│                            │ ─ 触发场景摘要           │
│ 标签/收藏    │                            │ ─ Markdown 渲染+大纲     │
│ Bundle 列表  │                            │ ─ 附属文件               │
│              │                            │ ─ 副本/漂移提示          │
│              │                            │ Target Project 槽        │
│              │                            │ 待执行操作预览           │
│              │                            │ [复制到项目][删][同步]   │
└──────────────┴────────────────────────────┴──────────────────────────┘
```

### 3.1 左栏（Left Rail）

| 区块 | 内容 | 交互 |
|------|------|------|
| Search | 关键字（name/description/标题） | 防抖过滤中栏 |
| Sources | 勾选启用的源 / 只读标记 | 过滤；点击进 Sources 页 |
| Facets | Runtime、Scope、含脚本、健康档（P1） | 多选 AND |
| Tags | 用户标签、收藏 | 管理在详情或右键 |
| Bundles | 短列表 | 点击高亮包内 skills；双击打开 Bundles |

### 3.2 中栏（Catalog）

**卡片字段（列表不加载全文）：**

- `name`、一句话 `description`（截断）
- 徽章：`runtime`、`scope`、`RO`、`scripts`、`twins`、`symlink`
- 相对路径或源标签

**交互：**

| 操作 | 行为 |
|------|------|
| 单击 | 右栏显示详情（按需读盘） |
| 多选 | Ctrl/Shift；底部出现批量操作条 |
| 拖拽到 Target Project | 默认复制；预览路径后确认（或设置「拖拽即确认」） |
| 拖拽到 Bundle | 加入该 Bundle（指针，非立即写盘） |
| 双击 | 外部编辑器打开 `SKILL.md` |
| 右键 | 复制到… / 提取副本 / 加入 Bundle / 显示副本 / 打开目录 |

视图：网格（默认）/ 紧凑列表。排序：名称、最近索引变更、源。

### 3.3 右栏（Inspector）

#### A. 友好详情（默认）

1. **标题区**：name + 源路径（可复制）+ RO 徽章  
2. **用途**：description 全文  
3. **触发场景**：从 description 启发式拆句（「Use when…」等）  
4. **结构**：附属文件树（`scripts/`、`reference.md`…）  
5. **正文渲染**：Markdown + 大纲跳转；frontmatter 默认折叠，可「查看源码」  
6. **副本面板**：同名/同 hash 列表；一致/差异；入口「Diff」「以 A 同步到 B」

MVP 不做完整可视化编辑器；「在外部编辑器打开」即可。

#### B. Target Project 槽

| 元素 | 说明 |
|------|------|
| 当前项目 | 路径 + 显示名 |
| 更换 | 从登记列表选 / 浏览文件夹 |
| 写入 runtime | 多选：agents / claude / cursor / … |
| 多运行时同步 | 开关 |
| 冲突策略 | 跳过 / 覆盖 / 重命名 / 每次询问 |

#### C. 操作预览

任何复制/删除/同步前展示将发生的路径变更列表：

```text
+ copy  src\audit  →  D:\proj\.agents\skills\audit
+ copy  src\audit  →  D:\proj\.claude\skills\audit
~ skip  frontend-design (exists, policy=skip)
```

主按钮：`执行`；次按钮：`取消`。

## 4. 关键用户流程

### F1 — 搞清本机有哪些 skill（成功标准 30s）

1. 启动加载上次索引 → 中栏立刻有数据  
2. 左栏按 Runtime 或「仅看有副本」过滤  
3. 点开卡片看友好详情  

### F2 — 新建项目复用优质组合

1. 右栏选目标项目  
2. 左栏选 Bundle「前端审查包」  
3. 预览路径 → 执行  
4. OpLog 可追溯  

### F3 — 从只读插件提取自用

1. 过滤 origin=plugin  
2. 右键「提取为自有副本」→ 写入 `~\.agents\skills`  
3. 可选加入 Bundle  

### F4 — 清理重复副本

1. 过滤「有差异的副本组」  
2. Diff → 选权威侧 → 同步或删除多余（RW only）  

## 5. Bundles 页

| 能力 | MVP |
|------|-----|
| 列表 / 新建 / 重命名 / 删除 | ✅ |
| 增删 skill 指针（按 skill id 或稳定 name+内容指纹） | ✅ |
| 默认写入 runtime 映射 | ✅ |
| 导出 / 导入 JSON | ✅ |
| 应用到当前 Target Project | ✅ |
| 根据技术栈推荐（项目就绪向导） | P1 |

**Bundle JSON 形态（概念）：** 见 [03-data-model.md](03-data-model.md)。

## 6. Sources 页

- 启用/禁用预置源  
- 添加自定义根目录  
- 登记/移除项目根  
- 显示每源 skill 计数与上次扫描时间  
- 只读源说明文案固定展示  

## 7. 交互与安全细则

| 规则 | 说明 |
|------|------|
| 拖拽默认复制 | 移动需 Alt（可配置）或菜单「移动」 |
| 删除二次确认 | 含影响面：副本数、Bundle 引用 |
| RO 源无放置目标 | 拖到 RO 区显示禁止光标 |
| 空态 | 无索引时引导「添加项目 / 检查源路径」 |
| 键盘 | `/` 聚焦搜索；`Del` 删除选中（仍确认）；`Enter` 打开详情 |

## 8. 视觉与轻量约束（产品层）

- 单窗口；无强制托盘常驻（设置可选）  
- 列表虚拟滚动；详情按需 I/O  
- 不内嵌完整 IDE / Agent 对话  

## 9. 线框状态清单（实现对照）

| 状态 ID | 描述 |
|---------|------|
| `lib.empty` | 无 skill |
| `lib.loading` | 后台增量扫描中（不阻塞已有列表） |
| `lib.filtered-empty` | 过滤无结果 |
| `detail.none` | 未选中 |
| `detail.readonly` | RO 详情，操作按钮降级为提取 |
| `ops.preview` | 预览待执行 |
| `ops.running` | 执行中禁止重复提交 |
| `ops.done` | 成功/部分失败摘要 |
