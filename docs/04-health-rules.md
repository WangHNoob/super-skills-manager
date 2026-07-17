# 04 — Skill 健康检查规则

原则：只提示与建议，**不自动改写用户文件**；用户点击「应用修复」才写入（当前白名单见文末）。

## 1. 评分模型

| 项目 | 约定 |
|------|------|
| 分制 | 0–100，初始 100 |
| 聚合 | `score = max(0, 100 + Σ(weighted_delta))` |
| 等级 | `A` ≥ 85；`B` 70–84；`C` 50–69；`D` < 50 |
| 输出 | `issues[]`：`ruleId`、`severity`、`message`、`fixHint?`、`autoFix?` |

| severity | delta |
|----------|-------|
| `error` | -25 |
| `warn` | -10 |
| `info` | -3 |

多条规则可叠加；最低 0。

## 2. 规则清单

### 2.1 Frontmatter / 元数据

| ruleId | severity | 检测 | 修复建议 |
|--------|----------|------|----------|
| `META001` | error | 缺少 `SKILL.md` | 从索引剔除或补入口 |
| `META002` | error | frontmatter 无法解析 | 修正 YAML |
| `META003` | error | 缺少 `name` | 可用目录名预填（可自动修复） |
| `META004` | error | 缺少 `description` | 人工补写 |
| `META005` | warn | `name` 与目录名不一致 | 统一命名 |
| `META006` | info | 未知 frontmatter 键 | 告知即可 |

### 2.2 Description 触发质量

| ruleId | severity | 检测 |
|--------|----------|------|
| `DESC001` | warn | 长度 < 40 |
| `DESC002` | warn | 长度 > 500 |
| `DESC003` | warn | 缺少触发语境词（when / use / 当 / 用 / asks…） |
| `DESC004` | warn | 偏泛（helper/utils…）且无领域词 |
| `DESC006` | info | 同名副本 description 不一致 |

> 已移除 `DESC005`（未说明反例）：不适合所有 skill，也不宜计分。

### 2.3 正文结构

| ruleId | severity | 检测 |
|--------|----------|------|
| `BODY001` | warn | 正文过短（< 120 字符） |
| `BODY002` | info | 无二级标题 |
| `BODY003` | warn | 步骤标题下无列表 |
| `BODY004` | info | 含 TODO / TBD / FIXME |

### 2.4 Scripts 与依赖

| ruleId | severity | 检测 |
|--------|----------|------|
| `DEP001` | warn | 有 `scripts/` 但正文未引用脚本名 |
| `DEP002` | warn | 正文引用的 `scripts/...` 文件不存在 |
| `DEP004` | warn | 正文/description 提到 CLI 但本机 PATH 未找到 |
| `DEP006` | info | 提到网络安装 / `npx skills` / `skills.sh` / `npm install` |

> CLI 探测字典（`health.rs::CLI_DICT`）：`gh`、`git`、`node`、`npm`、`npx`、`pnpm`、`python`、`pip`、`cargo`、`docker`、`kubectl`、`rg`、`fd`、`officecli`、`agently-cli`。本轮扫描一次性并发探测并缓存（`probe_cli_dict`）。
>
> **未实现：** `DEP003`（可执行脚本缺运行说明）、`DEP005`（MCP 未在常见配置中找到）尚未在代码中落地，暂不计分。

### 2.5 脚本静态风险

健康检查（`health.rs`）对 `scripts/**` 关键词扫描，与独立的 `script_risk.rs::scan_script_risks`（详情页用，带命中行号与片段）互补。两者共用同一组规则 ID：

| ruleId | severity | 模式 |
|--------|----------|------|
| `RISK001` | warn | 网络请求（curl / iwr / wget / fetch()） |
| `RISK002` | error | 危险销毁命令（rm -rf / / Remove-Item -Recurse / mkfs） |
| `RISK003` | warn | 硬编码凭证（API_KEY / SECRET / password= / token=） |
| `RISK004` | warn | 提权（sudo / RunAs） |
| `RISK005` | info | 注册表 / 环境变量写入（setx / reg add / hkcu\） |
| `RISK006` | warn | 远程管道执行（| iex / | sh / | bash） |

详情页 `scriptRisks` 展示**命中文件、行号与片段**；健康报告内的 RISK 规则只汇总到 issues。

### 2.6 skills.sh 远端对照

**仅对**锁文件中已登记的 skill 生效。`registry_compare.rs::lock_paths` 依次查找 `~/.agents/.skill-lock.json` → `~/.agents/skills-lock.json` → `~/.claude/.skill-lock.json`（命中第一个即用）。
本地手写 / 复制、未进锁文件的 skill：返回 `untracked` / `no_lock`，**不报 REG、不扣分、详情不强制展示对照块**。

> 网络对照**按需触发**：自动扫描路径（`HealthRunOpts::default`）`include_registry = false`，跳过远端；仅「健康检查」页「重新检查全部」(`force + includeRegistry`) 与详情页按需拉取。远端 `SKILL.md` 拉取有进程内 1h 缓存（`REMOTE_CACHE`）。

对照状态：`matched`（一致，不计分）/ `diverged` / `fetch_failed` / `unsupported` / `untracked` / `no_lock`。

「新建项目」页可对本项目技能做范围健康检查，并标出 `diverged` / `SRC004` 等可能非最新项。

| ruleId | severity | 检测 |
|--------|----------|------|
| `REG001` | warn | 本地与远端 `SKILL.md` 不一致（可看 unified diff） |
| `REG003` | info | 拉取远端失败 |
| `REG005` | info | 无法构造远端 URL（锁文件有记录但 source/skill_path 不可解析） |

已废弃：`REG002`（未纳入锁文件）、`REG004`（无锁文件）。

### 2.7 源与权限

| ruleId | severity | 检测 |
|--------|----------|------|
| `SRC001` | error | RO 源被标成 RW（内部一致性） |
| `SRC002` | warn | symlink 断链 |
| `SRC003` | info | 来自 plugin cache |
| `SRC004` | warn | 副本组有差异且当前非最新 mtime |

### 2.8 Bundle

| ruleId | severity | 检测 |
|--------|----------|------|
| `BUN001` | warn | Bundle 引用的 skill 丢失 |
| `BUN002` | info | Bundle 内 skill description 质量差 |

## 3. 报告与 UX

### 详情二级窗

有问题时展示摘要（等级徽章在标题区）；完整列表引导至「健康检查」页。新建项目页可对本项目做范围检查并标出非最新项。

### 健康检查页

- 按分数排序的报告卡片；可展开全部 issues  
- 「打开目录」；重新检查全部  
- skills.sh 对照与 diff（仅锁文件内 skill）  
- `META003` 可一键修复  

### 自动修复白名单

| ruleId | autoFix |
|--------|---------|
| `META003` | 写入 name=目录名（非 RO） |
| 其它 | false |

## 4. 与索引的关系

- 扫描后可批量跑健康检查；结果写入 `health_reports` 与 `skills.health_score`
- **缓存命中**：`run_health_for_list` 先按 `(skill_id, content_hash)` 查 `get_health_cache`，命中则跳过文件重读与网络，仅同步分数/名称；未 force 时内容未变的技能不会重复分析
- `contentHash` 可作为缓存键；远端 SKILL.md 拉取有进程内 1h 缓存
- 列表通过 JOIN 附带 `dirPath`（`health_reports` LEFT JOIN `skills`）

## 5. 验收要点

- 缺 description → `META004`，等级明显下降  
- 含危险管道脚本 → RISK 类命中  
- 本地手写 skill **不会**因「未纳入锁文件」扣分  
- 锁文件内 skill 与远端不一致 → `REG001` + diff  
