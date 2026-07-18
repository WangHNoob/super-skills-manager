import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api } from "../api";
import HelpTip from "../components/HelpTip";
import { RUNTIME_LABELS } from "../constants";
import { useCatalog } from "../context/CatalogContext";
import { errMsg } from "../errMsg";
import type { WorkspaceRoot } from "../types";

/** 来源与项目：工作区根自动发现、登记项目根目录、启用/禁用扫描来源 */
export default function SourcesView() {
  const {
    tab,
    projects,
    sources,
    settings,
    setSettings,
    refreshCatalog,
    handleScan,
    pickProject,
    setStatus,
  } = useCatalog();

  const [workspaceRoots, setWorkspaceRoots] = useState<WorkspaceRoot[]>([]);
  const [discovering, setDiscovering] = useState(false);

  useEffect(() => {
    if (tab !== "sources") return;
    api.listWorkspaceRoots().then(setWorkspaceRoots).catch(() => {});
  }, [tab]);

  async function refreshWorkspaceRoots() {
    setWorkspaceRoots(await api.listWorkspaceRoots());
  }

  async function toggleSource(id: string) {
    if (!settings) return;
    const enabledSourceIds = settings.enabledSourceIds.includes(id)
      ? settings.enabledSourceIds.filter((x) => x !== id)
      : [...settings.enabledSourceIds, id];
    const next = { ...settings, enabledSourceIds };
    setSettings(await api.updateSettings(next));
    await handleScan();
  }

  async function addWorkspaceRoot() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    setDiscovering(true);
    try {
      const found = await api.addWorkspaceRoot(dir);
      await refreshWorkspaceRoots();
      await refreshCatalog();
      setStatus(
        found.length
          ? `已添加工作区根，发现 ${found.length} 个项目`
          : "已添加工作区根（暂未发现含 skills 的项目）",
      );
    } catch (e) {
      setStatus(errMsg(e));
    } finally {
      setDiscovering(false);
    }
  }

  async function removeWorkspaceRoot(id: string, displayName: string) {
    if (
      !confirm(
        `移除工作区根「${displayName}」？\n确认将一并删除由它自动发现的项目及其 skills（手动添加的项目不受影响）。`,
      )
    )
      return;
    setDiscovering(true);
    try {
      await api.removeWorkspaceRoot(id, true);
      await refreshWorkspaceRoots();
      await refreshCatalog();
      setStatus("已移除工作区根及其发现的项目");
    } catch (e) {
      setStatus(errMsg(e));
    } finally {
      setDiscovering(false);
    }
  }

  async function toggleWorkspaceRoot(id: string, enabled: boolean) {
    setDiscovering(true);
    try {
      await api.setWorkspaceRootEnabled(id, enabled);
      await refreshWorkspaceRoots();
      await refreshCatalog();
    } catch (e) {
      setStatus(errMsg(e));
    } finally {
      setDiscovering(false);
    }
  }

  async function rediscoverAll() {
    setDiscovering(true);
    try {
      const n = await api.scanWorkspaceRoots();
      await refreshCatalog();
      setStatus(
        n > 0 ? `重新发现完成，新增 ${n} 个项目` : "重新发现完成（无新项目）",
      );
    } catch (e) {
      setStatus(errMsg(e));
    } finally {
      setDiscovering(false);
    }
  }

  if (tab !== "sources") return null;

  return (
    <div className="page">
      <h2>来源与项目</h2>
      <p className="page-lead">
        管理「从哪些目录扫描技能」，以及「常用项目根目录」。改完后请重新扫描。
      </p>
      <section>
        <h3>
          工作区根{" "}
          <HelpTip text="登记代码根目录（如 D:\\Projects），应用会递归发现其下所有含 .claude/.agents/.cursor/.codex skills 的项目并自动纳入扫描，比逐个手动登记更省事。" />
        </h3>
        <ul className="plain-list">
          {workspaceRoots.map((w) => (
            <li key={w.id} className="project-row">
              <span>
                {w.displayName}{" "}
                {!w.enabled && <span className="ro">已停用</span>}
              </span>
              <code>{w.path}</code>
              <label className="check">
                <input
                  type="checkbox"
                  checked={w.enabled}
                  onChange={(e) => toggleWorkspaceRoot(w.id, e.target.checked)}
                />
                启用
              </label>
              <button
                className="danger"
                disabled={discovering}
                onClick={() => removeWorkspaceRoot(w.id, w.displayName)}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
        <button onClick={addWorkspaceRoot} disabled={discovering}>
          添加工作区根目录
        </button>{" "}
        <button onClick={rediscoverAll} disabled={discovering}>
          {discovering ? "发现中…" : "重新发现全部"}
        </button>
        <p className="hint">
          工作区根仅用于「发现项目」；发现的项目会以「自动」标记出现在下方列表，可照常复制、健康检查、设为目标。移除工作区根会级联清理它发现的项目。
        </p>
      </section>
      <section>
        <h3>已登记项目</h3>
        <ul className="plain-list">
          {projects.map((p) => (
            <li key={p.id} className="project-row">
              <span>
                {p.displayName}{" "}
                {p.origin === "discovered" && <span className="ro">自动</span>}
              </span>
              <code>{p.path}</code>
              <button onClick={() => api.setTargetProject(p.path).then(setSettings)}>
                设为目标
              </button>
              <button
                className="danger"
                onClick={async () => {
                  await api.removeProject(p.path);
                  await refreshCatalog();
                }}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
        <button onClick={pickProject}>添加 / 选择项目目录</button>
        <p className="hint">
          「设为目标」后，技能库顶部的「目标项目」会指向这里，复制与组合包都会写到该目录。
        </p>
      </section>
      <section>
        <h3>
          扫描来源{" "}
          <HelpTip text="勾选后才会参与扫描。只读来源不能直接改文件，但可以提取副本。" />
        </h3>
        <div className="source-list">
          {sources.map((s) => (
            <label key={s.id} className="source-item">
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={() => toggleSource(s.id)}
              />
              <div>
                <strong>
                  {s.label}{" "}
                  {s.access === "readonly" && <span className="ro">只读</span>}
                </strong>
                <p>
                  {RUNTIME_LABELS[s.runtime] || s.runtime} · {s.scope} ·{" "}
                  {s.skillCount} 个技能
                </p>
                <p className="muted">
                  {s.resolvedRoots.join(" | ") || s.pathPatterns.join(" | ")}
                </p>
              </div>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
