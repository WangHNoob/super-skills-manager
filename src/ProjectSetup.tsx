import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import type {
  AppSettings,
  HealthReport,
  ProjectProfile,
  SkillRecord,
} from "./types";

const FOLDER_OPTS = [
  {
    key: "claude",
    label: "Claude",
    path: ".claude/skills",
    tip: "Claude Code 读取此目录",
  },
  {
    key: "agents",
    label: "Agents",
    path: ".agents/skills",
    tip: "通用 Agents / Cursor 常用目录",
  },
  {
    key: "cursor",
    label: "Cursor 原生",
    path: ".cursor/skills",
    tip: "Cursor 原生 skills 目录（可选，默认勾选）",
  },
] as const;

/** 目录勾选 → 复制时的 writeRuntimes + 是否写原生 cursor */
function runtimesFromFolders(folders: Set<string>): {
  runtimes: string[];
  alsoNativeCursor: boolean;
} {
  const runtimes: string[] = [];
  if (folders.has("claude")) runtimes.push("claude");
  if (folders.has("agents") || folders.has("cursor")) runtimes.push("agents");
  if (folders.has("cursor")) runtimes.push("cursor");
  // agents 与 cursor 都写 .agents 时去重
  const uniq = [...new Set(runtimes)];
  return { runtimes: uniq.length ? uniq : ["agents", "claude"], alsoNativeCursor: folders.has("cursor") };
}

function agentsForCli(folders: Set<string>): string[] {
  const agents: string[] = [];
  if (folders.has("claude")) agents.push("claude-code");
  if (folders.has("cursor") || folders.has("agents")) agents.push("cursor");
  if (folders.has("agents")) agents.push("amp");
  return agents.length ? [...new Set(agents)] : ["claude-code", "cursor"];
}

type Props = {
  settings: AppSettings | null;
  skills: SkillRecord[];
  onSettings: (s: AppSettings) => void;
  onStatus: (msg: string) => void;
  onRefresh: () => Promise<void>;
};

export default function ProjectSetup({
  settings,
  skills,
  onSettings: _onSettings,
  onStatus,
  onRefresh,
}: Props) {
  const [folders, setFolders] = useState<Set<string>>(
    () => new Set(["claude", "agents", "cursor"]),
  );
  const [pickQuery, setPickQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [profile, setProfile] = useState<ProjectProfile | null>(null);
  const [regQuery, setRegQuery] = useState("");
  const [regPackage, setRegPackage] = useState("");
  const [regOutput, setRegOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflictPolicy, setConflictPolicy] = useState(
    settings?.conflictPolicy || "overwrite",
  );
  const [healthReports, setHealthReports] = useState<HealthReport[]>([]);
  const [doneSummary, setDoneSummary] = useState<string | null>(null);

  const project = settings?.targetProject || "";

  const catalog = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    // 优先展示全局/可写技能，避免把项目内已有的再列一遍占满
    const base = skills.filter(
      (s) =>
        s.scope !== "project" ||
        !project ||
        !(s.projectRoot || s.dirPath).toLowerCase().startsWith(project.toLowerCase()),
    );
    if (!q) return base.slice(0, 80);
    return base
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q),
      )
      .slice(0, 80);
  }, [skills, pickQuery, project]);

  const outdated = healthReports.filter(
    (r) =>
      r.registry?.status === "diverged" ||
      r.issues.some((i) => i.ruleId === "REG001" || i.ruleId === "SRC004"),
  );

  function toggleFolder(key: string) {
    setFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSkill(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function pickProject() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    const s = await api.setTargetProject(dir);
    onSettings(s);
    setProfile(null);
    setHealthReports([]);
    setDoneSummary(null);
    onStatus(`已选择项目：${dir}`);
  }

  async function analyze() {
    if (!project) {
      onStatus("请先选择项目目录");
      return;
    }
    setBusy(true);
    try {
      const p = await api.analyzeProject(project);
      setProfile(p);
      onStatus(
        p.stacks.length
          ? `检测到技术栈：${p.stacks.join("、")}`
          : "未识别到明确技术栈，已给出通用推荐",
      );
    } catch (e) {
      onStatus(String(e));
    } finally {
      setBusy(false);
    }
  }

  function applyRecommendation(ids: string[]) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    onStatus(`已加入推荐中的 ${ids.length} 个技能`);
  }

  async function runReg(
    action: () => Promise<{ ok: boolean; stdout: string; stderr: string }>,
  ) {
    setBusy(true);
    try {
      const r = await action();
      setRegOutput(
        [r.stdout, r.stderr].filter(Boolean).join("\n---\n") ||
          `(exit ${r.ok ? 0 : 1})`,
      );
      onStatus(r.ok ? "在线命令完成" : "命令失败，请看下方输出");
      if (r.ok) await onRefresh();
    } catch (e) {
      onStatus(String(e));
      setRegOutput(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function installToProject() {
    if (!project) {
      onStatus("请先选择项目目录");
      return;
    }
    if (!regPackage.trim()) {
      onStatus("请填写要安装的包名或仓库");
      return;
    }
    await runReg(() =>
      api.registryAdd(
        regPackage.trim(),
        false,
        agentsForCli(folders),
        null,
        project,
      ),
    );
  }

  async function searchOnline() {
    await runReg(() => api.registryFind(regQuery));
  }

  async function applySetup() {
    if (!project) {
      onStatus("请先选择项目目录");
      return;
    }
    if (!folders.size) {
      onStatus("请至少勾选一个工具目录");
      return;
    }
    setBusy(true);
    setDoneSummary(null);
    try {
      const folderKeys = [...folders];
      const scaffold = await api.scaffoldProject(project, folderKeys);
      const { runtimes, alsoNativeCursor } = runtimesFromFolders(folders);

      let copyCount = 0;
      const ids = [...selectedIds];
      if (ids.length) {
        const policy =
          conflictPolicy === "prompt" ? "overwrite" : conflictPolicy;
        const preview = await api.previewCopy(
          ids,
          project,
          runtimes,
          policy,
          alsoNativeCursor,
        );
        await api.executeCopy(preview, policy);
        copyCount = preview.items.length;
      }

      await onRefresh();
      const healthN = await api.runHealthScanScoped({ project });
      const reports = (await api.listHealthReports()).filter((r) => {
        const path = (r.dirPath || "").toLowerCase();
        return path.startsWith(project.toLowerCase());
      });
      setHealthReports(reports);

      const parts = [
        `目录：新建 ${scaffold.created.length}，已有 ${scaffold.skipped.length}`,
        ids.length
          ? `已复制 ${ids.length} 个技能（${copyCount} 个写入目标）`
          : "未选择本地技能复制",
        `健康检查 ${healthN} 条（本项目相关 ${reports.length}）`,
      ];
      const summary = parts.join(" · ");
      setDoneSummary(summary);
      onStatus(summary);
    } catch (e) {
      onStatus(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function recheckHealth() {
    if (!project) {
      onStatus("请先选择项目目录");
      return;
    }
    setBusy(true);
    try {
      await onRefresh();
      const n = await api.runHealthScanScoped({ project });
      const reports = (await api.listHealthReports()).filter((r) => {
        const path = (r.dirPath || "").toLowerCase();
        return path.startsWith(project.toLowerCase());
      });
      setHealthReports(reports);
      onStatus(`本项目健康检查完成：${n} 条，其中 ${reports.length} 条属于该项目`);
    } catch (e) {
      onStatus(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page setup-page">
      <h2>新建项目</h2>
      <p className="page-lead">
        选好项目目录 → 勾选需要的工具文件夹 → 挑选或在线安装技能 →
        一键落地，并可做健康检查标出非最新项。
      </p>

      <section className="setup-card">
        <header className="setup-card-head">
          <h3>1. 项目目录</h3>
          <span className="hint">选择已有文件夹，或新建空文件夹后再选</span>
        </header>
        <p className="path target-path" title={project || undefined}>
          {project || "尚未选择"}
        </p>
        <div className="row-actions">
          <button type="button" className="primary" onClick={() => void pickProject()}>
            选择项目文件夹
          </button>
          {project && (
            <button type="button" onClick={() => void api.reveal(project)}>
              在资源管理器中打开
            </button>
          )}
          <button
            type="button"
            disabled={!project || busy}
            onClick={() => void analyze()}
          >
            分析技术栈并推荐
          </button>
        </div>
        {profile && (
          <div className="setup-reco">
            <p className="muted">
              技术栈：
              {profile.stacks.length ? profile.stacks.join("、") : "未识别"}
            </p>
            {profile.recommendations.map((rec) => (
              <div key={rec.title} className="setup-reco-row">
                <div>
                  <strong>{rec.title}</strong>
                  <p className="hint">{rec.reason}</p>
                  <p className="muted tiny">
                    可加入：{rec.skillNames.join("、") || "无"}
                    {rec.missingNames.length
                      ? ` · 本机缺少：${rec.missingNames.join("、")}（可下方在线安装）`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!rec.matchedSkillIds.length}
                  onClick={() => applyRecommendation(rec.matchedSkillIds)}
                >
                  加入已选
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="setup-card">
        <header className="setup-card-head">
          <h3>2. 需要哪些工具目录</h3>
          <span className="hint">默认全选；会创建空目录并决定技能写到哪里</span>
        </header>
        <div className="setup-folder-grid">
          {FOLDER_OPTS.map((f) => (
            <label key={f.key} className="setup-folder" title={f.tip}>
              <input
                type="checkbox"
                checked={folders.has(f.key)}
                onChange={() => toggleFolder(f.key)}
              />
              <span>
                <strong>{f.label}</strong>
                <code>{f.path}</code>
              </span>
            </label>
          ))}
        </div>
        <label className="check policy-row" style={{ maxWidth: 280 }}>
          <span className="field-label">文件已存在时</span>
          <select
            value={conflictPolicy}
            onChange={(e) => setConflictPolicy(e.target.value)}
          >
            <option value="overwrite">覆盖原文件</option>
            <option value="skip">跳过（保留已有）</option>
            <option value="rename">另存为新名称</option>
          </select>
        </label>
      </section>

      <section className="setup-card">
        <header className="setup-card-head">
          <h3>3. 从本机技能库挑选</h3>
          <span className="hint">
            已选 {selectedIds.size} 个 · 可多选后在第 5 步一并复制
          </span>
        </header>
        <input
          value={pickQuery}
          onChange={(e) => setPickQuery(e.target.value)}
          placeholder="搜索本机技能名称或说明…"
          aria-label="搜索本机技能"
        />
        <div className="setup-skill-pick">
          {catalog.map((s) => (
            <label key={s.id} className="setup-skill-item">
              <input
                type="checkbox"
                checked={selectedIds.has(s.id)}
                onChange={() => toggleSkill(s.id)}
              />
              <span>
                <strong>{s.name}</strong>
                <span className="muted tiny">
                  {s.runtime} · {s.sourceId}
                </span>
                <span className="hint">{s.description || "（无说明）"}</span>
              </span>
            </label>
          ))}
          {!catalog.length && (
            <p className="muted">没有匹配的技能。可先「重新扫描」，或改用下方在线安装。</p>
          )}
        </div>
        <div className="row-actions">
          <button type="button" onClick={() => setSelectedIds(new Set())}>
            清除已选
          </button>
        </div>
      </section>

      <section className="setup-card">
        <header className="setup-card-head">
          <h3>4. 从 skills.sh 安装到本项目</h3>
          <span className="hint">
            直接装进当前项目（非全局）。需本机 Node.js。
          </span>
        </header>
        <div className="row-actions">
          <input
            style={{ flex: 1 }}
            value={regQuery}
            onChange={(e) => setRegQuery(e.target.value)}
            placeholder="搜索关键词，如 frontend"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void searchOnline()}
          >
            搜索
          </button>
        </div>
        <div className="row-actions" style={{ marginTop: "0.55rem" }}>
          <input
            style={{ flex: 1 }}
            value={regPackage}
            onChange={(e) => setRegPackage(e.target.value)}
            placeholder="安装：owner/repo 或技能名"
          />
          <button
            type="button"
            className="primary"
            disabled={busy || !project || !regPackage.trim()}
            onClick={() => void installToProject()}
          >
            安装到本项目
          </button>
          <button
            type="button"
            disabled={busy || !project}
            title="更新本项目内由 skills CLI 管理的技能"
            onClick={() =>
              void runReg(() => api.registryUpdate(false, project))
            }
          >
            更新项目内技能
          </button>
        </div>
        <pre className="source setup-reg-out">
          {regOutput || "搜索 / 安装输出会显示在这里…"}
        </pre>
      </section>

      <section className="setup-card setup-cta">
        <header className="setup-card-head">
          <h3>5. 一键落地</h3>
          <span className="hint">创建创建 创建勾选的目录 → 复制已选本机技能 → 对本项目做健康检查
          </span>
        </header>
        <button
          type="button"
          className="primary block"
          disabled={busy || !project}
          onClick={() => void applySetup()}
        >
          {busy ? "处理中…" : "创建目录并复制已选技能"}
        </button>
        {doneSummary && <p className="setup-done">{doneSummary}</p>}
      </section>

      <section className="setup-card">
        <header className="setup-card-head">
          <h3>6. 健康检查（本项目）</h3>
          <span className="hint">
            标出与远端不一致或副本偏旧的技能；不会自动改文件
          </span>
        </header>
        <div className="row-actions">
          <button
            type="button"
            disabled={busy || !project}
            onClick={() => void recheckHealth()}
          >
            重新检查本项目
          </button>
        </div>
        {outdated.length > 0 && (
          <p className="setup-outdated-banner">
            有 {outdated.length} 个技能可能不是最新（与 skills.sh 不一致或副本偏旧）
          </p>
        )}
        <ul className="setup-health-list">
          {healthReports.map((r) => {
            const stale =
              r.registry?.status === "diverged" ||
              r.issues.some(
                (i) => i.ruleId === "REG001" || i.ruleId === "SRC004",
              );
            return (
              <li
                key={r.skillId}
                className={stale ? "stale" : ""}
              >
                <span
                  className={`health-badge g-${r.grade.toLowerCase()}`}
                >
                  {r.grade}
                </span>
                <div>
                  <strong>{r.skillName}</strong>
                  <span className="muted tiny">
                    {Math.round(r.score)} 分 · {r.issues.length} 个问题
                    {stale ? " · 非最新" : ""}
                    {r.registry?.status
                      ? ` · skills.sh: ${r.registry.status}`
                      : ""}
                  </span>
                </div>
                {r.dirPath && (
                  <button
                    type="button"
                    onClick={() => void api.reveal(r.dirPath!)}
                  >
                    打开目录
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {!healthReports.length && (
          <p className="muted">
            完成第 5 步或点「重新检查本项目」后，这里会列出项目内技能的健康状态。
          </p>
        )}
      </section>
    </div>
  );
}
