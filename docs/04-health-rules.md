# 04 — P1 Skill 健康检查规则清单

阶段：**P1**（MVP 可只存 `healthScore` 空值与 UI 入口占位）。  
原则：只提示与建议，**不自动改写用户文件**；用户点击「应用修复」才写入。

## 1. 评分模型

| 项目 | 约定 |
|------|------|
| 分制 | 0–100，初始 100 |
| 聚合 | `score = max(0, 100 + Σ(weighted_delta))` |
| 等级 | `A` ≥ 85；`B` 70–84；`C` 50–69；`D` < 50 |
| 输出 | `issues[]`：每条含 `ruleId`、`severity`、`message`、`fixHint?`、`autoFix?` |

严重度权重（delta）：

| severity | delta |
|----------|-------|
| `error` | -25 |
| `warn` | -10 |
| `info` | -3 |

同一 skill 多条规则可叠加；封顶扣到 0。

## 2. 规则清单

### 2.1 Frontmatter / 元数据

| ruleId | severity | 检测 | 修复建议 |
|--------|----------|------|----------|
| `META001` | error | 缺少 `SKILL.md` | 非 skill，应从索引剔除（Indexer 处理） |
| `META002` | error | frontmatter 无法解析 | 修正 YAML 分隔符与缩进 |
| `META003` | error | 缺少 `name` 或为空 | 补 name；默认可用目录名预填 |
| `META004` | error | 缺少 `description` 或为空 | 补 description；无自动猜写 |
| `META005` | warn | `name` 与目录名不一致 | 统一命名，避免跨 runtime 副本匹配混乱 |
| `META006` | info | 存在未知 frontmatter 键 | 告知即可，不扣或 info |

**自动修复（可选）：** `META003` 可用目录名写入 name（需确认）。

### 2.2 Description 触发质量（真实痛点：装了不触发）

| ruleId | severity | 检测 | 说明 |
|--------|----------|------|------|
| `DESC001` | warn | description 去空白后长度 < 40 | 过短，Agent 难匹配 |
| `DESC002` | warn | description 长度 > 500 | 过长可能被截断/稀释 |
| `DESC003` | warn | 未包含触发语境词 | 启发式：缺少 `when` / `use` / `用` / `当` / `asks` 等 |
| `DESC004` | warn | 仅泛词 | 匹配 `helper`/`utils`/`general`/`杂项` 等且无具体领域词 |
| `DESC005` | info | 未列出反例（什么时候不用） | 软建议，提升精度 |
| `DESC006` | info | 与同名副本 description 不一致 | 联立 TwinGroup，提示漂移 |

**不自动生成** description（避免幻觉写坏触发器）；可提供「改进检查清单」文案模板。

### 2.3 正文结构

| ruleId | severity | 检测 |
|--------|----------|------|
| `BODY001` | warn | 正文（去 frontmatter）< 120 字符 |
| `BODY002` | info | 无任何二级标题 |
| `BODY003` | warn | 声明了步骤类标题但无列表/编号 |
| `BODY004` | info | 含「TODO」「TBD」「FIXME」 |

### 2.4 Scripts 与依赖

| ruleId | severity | 检测 | 修复建议 |
|--------|----------|------|----------|
| `DEP001` | warn | 存在 `scripts/` 但正文未引用任何脚本名 | 在 SKILL.md 中写明何时调用 |
| `DEP002` | warn | 正文引用 `scripts/foo` 但文件不存在 | 补文件或改引用 |
| `DEP003` | error | 脚本扩展名可执行但无 shebang/注释说明运行方式（软） | 补充用法 |
| `DEP004` | warn | 正文出现 CLI 词（见词典）且 `where`/`Get-Command` 找不到 | 提示安装或改 PATH |
| `DEP005` | warn | 正文提到 MCP 服务器名，本地常见 MCP 配置中未找到 | 提示配置 MCP（路径可配置） |
| `DEP006` | info | 提到 `npx skills` / 网络安装 | 提醒离线环境风险 |

**CLI 词典（可配置扩展）：**  
`gh`, `git`, `node`, `npm`, `npx`, `pnpm`, `python`, `pip`, `cargo`, `docker`, `kubectl`, `rg`, `fd`, `officecli`, `agently-cli`

检测方式：正则抽取疑似命令 + 白名单过滤；Windows 用 `where.exe`。

### 2.5 脚本静态风险（非沙箱）

对 `scripts/**` 文本做关键词扫描（误报允许，默认 info/warn）：

| ruleId | severity | 模式类 |
|--------|----------|--------|
| `RISK001` | warn | 网络：`curl`/`Invoke-WebRequest`/`wget`/`fetch(` |
| `RISK002` | error | 危险销毁：`rm -rf /`、`Remove-Item -Recurse` 跟系统路径、`format`、`mkfs` |
| `RISK003` | warn | 凭证：`API_KEY`/`SECRET`/`password`/`token` 硬编码赋值 |
| `RISK004` | warn | 提权：`sudo`、`Start-Process -Verb RunAs` |
| `RISK005` | info | 写注册表 / 改用户环境变量 |
| `RISK006` | warn | 从远程管道执行：`iwr ... \| iex`、`curl \| sh` |

**不做：** 真正沙箱执行、杀毒引擎集成（P2+）。

### 2.6 源与权限一致性

| ruleId | severity | 检测 |
|--------|----------|------|
| `SRC001` | error | 位于只读源但索引标成 readwrite（内部一致性） |
| `SRC002` | warn | symlink 断链 |
| `SRC003` | info | 来自 plugin cache（提醒更新会被覆盖） |
| `SRC004` | warn | TwinGroup diverged 且当前副本不是最新 mtime | 

### 2.7 Bundle / 复用相关

| ruleId | severity | 检测 |
|--------|----------|------|
| `BUN001` | warn | 被 Bundle 引用但 skill 丢失 |
| `BUN002` | info | 高频加入 Bundle 的 skill description 质量差（DESC*） |

## 3. 报告与 UX

### 单 skill

右栏 Health 区块：等级徽章 + Top 3 issues +「查看全部」「复制报告」。

### 全局 Health 页（P1）

- 按等级筛选、按 ruleId 聚合  
- 「一键打开外部编辑器」跳到问题 skill  
- 批量「应用安全自动修复」（仅允许 `autoFix=true` 且无 RISK*）

### 自动修复白名单（谨慎）

| ruleId | autoFix |
|--------|---------|
| `META003` | 预填 name=目录名 |
| 其他 META/DESC/RISK | false |

## 4. 与索引的关系

- Health 在 Indexer upsert 后异步跑，避免阻塞扫描  
- 结果写入 `skills.health_score` + 旁路表 `health_issues(skill_id, rule_id, ...)`（实现期建表）  
- 文件未变则复用上次 issues（用 contentHash 作缓存键）

## 5. 验收清单

- [ ] 故意删掉 description 的 skill 得 `META004` 且等级 ≤ C  
- [ ] 含 `iwr \| iex` 的脚本触发 `RISK006`  
- [ ] 本机无 `gh` 但正文要求 `gh` 时触发 `DEP004`  
- [ ] 只读插件 skill 显示 `SRC003`，且无自动修复写回插件目录  
