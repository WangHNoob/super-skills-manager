import { api } from "../api";
import HelpTip from "../components/HelpTip";
import { RUNTIME_LABELS } from "../constants";
import { useCatalog } from "../context/CatalogContext";

/** 来源与项目：登记项目根目录、启用/禁用扫描来源 */
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
  } = useCatalog();

  async function toggleSource(id: string) {
    if (!settings) return;
    const enabledSourceIds = settings.enabledSourceIds.includes(id)
      ? settings.enabledSourceIds.filter((x) => x !== id)
      : [...settings.enabledSourceIds, id];
    const next = { ...settings, enabledSourceIds };
    setSettings(await api.updateSettings(next));
    await handleScan();
  }

  if (tab !== "sources") return null;

  return (
    <div className="page">
      <h2>来源与项目</h2>
      <p className="page-lead">
        管理「从哪些目录扫描技能」，以及「常用项目根目录」。改完后请重新扫描。
      </p>
      <section>
        <h3>已登记项目</h3>
        <ul className="plain-list">
          {projects.map((p) => (
            <li key={p.id} className="project-row">
              <span>{p.displayName}</span>
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
                  {s.access === "readonly" && (
                    <span className="ro">只读</span>
                  )}
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
