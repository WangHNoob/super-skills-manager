import { api } from "../api";
import { CONFLICT_LABELS } from "../conflict";
import HelpTip from "../components/HelpTip";
import { useCatalog } from "../context/CatalogContext";

/** 设置：冲突策略模板、导入技能 ZIP */
export default function SettingsView() {
  const { tab, settings, setSettings, policyTemplates, setStatus, refreshCatalog } =
    useCatalog();

  if (tab !== "settings") return null;

  return (
    <div className="page">
      <h2>设置</h2>
      <p className="page-lead">
        用策略模板快速设定「文件冲突时怎么处理」等偏好；也可导入别人分享的技能 ZIP。
      </p>
      <p className="muted">
        当前：{settings?.policyTemplateId || "balanced"} · 文件已存在时：
        {CONFLICT_LABELS[settings?.conflictPolicy || ""] ||
          settings?.conflictPolicy}
        {settings?.blockPluginCopyToProject
          ? " · 禁止把插件技能直接拷进项目"
          : ""}
      </p>
      <div className="bundle-grid">
        {policyTemplates.map((t) => (
          <article key={t.id} className="bundle-card">
            <h3>{t.name}</h3>
            <p>{t.description}</p>
            <p className="muted">
              冲突：
              {CONFLICT_LABELS[t.conflictPolicy] || t.conflictPolicy}
              {t.blockPluginCopyToProject
                ? " · 禁止插件直拷项目"
                : ""}
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

      <section className="import-box" style={{ marginTop: "1rem" }}>
        <h3>
          导入技能 ZIP{" "}
          <HelpTip text="选择由本应用导出的 ZIP，导入到本机技能目录。" />
        </h3>
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
    </div>
  );
}
