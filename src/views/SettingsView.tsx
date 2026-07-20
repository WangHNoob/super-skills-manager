import { api } from "../api";
import { CONFLICT_LABELS } from "../conflict";
import HelpTip from "../components/HelpTip";
import { useCatalog } from "../context/CatalogContext";

/** 设置：常用冲突策略在前；模板与 ZIP 导入收入「高级」 */
export default function SettingsView() {
  const { tab, settings, setSettings, policyTemplates, setStatus, refreshCatalog } =
    useCatalog();

  if (tab !== "settings") return null;

  return (
    <div className="page">
      <h2>设置</h2>
      <p className="page-lead">
        日常只需改「文件已存在时」的处理方式。策略模板与 ZIP 导入属于高级能力，默认收起。
      </p>

      <section className="setup-card">
        <header className="setup-card-head">
          <h3>复制冲突策略</h3>
          <span className="hint">技能库 / 新建项目 / 组合包应用时共用</span>
        </header>
        <label className="check policy-row" style={{ maxWidth: 320 }}>
          <span className="field-label">文件已存在时</span>
          <select
            value={settings?.conflictPolicy || "overwrite"}
            disabled={!settings}
            onChange={async (e) => {
              if (!settings) return;
              const s = await api.updateSettings({
                ...settings,
                conflictPolicy: e.target.value,
              });
              setSettings(s);
              setStatus(`冲突策略：${CONFLICT_LABELS[e.target.value] || e.target.value}`);
            }}
          >
            <option value="overwrite">{CONFLICT_LABELS.overwrite}</option>
            <option value="skip">{CONFLICT_LABELS.skip}</option>
            <option value="rename">{CONFLICT_LABELS.rename}</option>
            <option value="prompt">{CONFLICT_LABELS.prompt}</option>
          </select>
        </label>
        {settings?.blockPluginCopyToProject && (
          <p className="muted tiny" style={{ marginTop: "0.5rem" }}>
            当前已开启：禁止把插件技能直接拷进项目（可由下方模板调整）
          </p>
        )}
      </section>

      <details className="advanced-panel">
        <summary>
          高级：策略模板{" "}
          <HelpTip text="一键套用预设偏好（冲突策略、是否禁止插件直拷项目等）。日常改上面的下拉即可。" />
        </summary>
        <p className="muted">
          当前模板标记：{settings?.policyTemplateId || "balanced"}
        </p>
        <div className="bundle-grid">
          {policyTemplates.map((t) => (
            <article key={t.id} className="bundle-card">
              <h3>{t.name}</h3>
              <p>{t.description}</p>
              <p className="muted">
                冲突：
                {CONFLICT_LABELS[t.conflictPolicy] || t.conflictPolicy}
                {t.blockPluginCopyToProject ? " · 禁止插件直拷项目" : ""}
              </p>
              <button
                className="primary"
                onClick={async () => {
                  const s = await api.applyPolicyTemplate(t.id);
                  setSettings(s);
                  setStatus(`已应用策略「${t.name}」`);
                }}
              >
                使用此模板
              </button>
            </article>
          ))}
        </div>
      </details>

      <details className="advanced-panel">
        <summary>
          高级：导入技能 ZIP{" "}
          <HelpTip text="选择由本应用导出的 ZIP，导入到本机技能目录。跨机搬运技能正文时使用。" />
        </summary>
        <section className="import-box" style={{ marginTop: "0.55rem" }}>
          <input
            type="file"
            accept=".zip"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const buf = await file.arrayBuffer();
              const bytes = new Uint8Array(buf);
              let binary = "";
              bytes.forEach((b) => {
                binary += String.fromCharCode(b);
              });
              const b64 = btoa(binary);
              const entry = await api.importSkillsZip(b64, null);
              await refreshCatalog();
              setStatus(
                `导入完成（${entry.targets.length} 项）：${entry.status}`,
              );
            }}
          />
        </section>
      </details>
    </div>
  );
}
