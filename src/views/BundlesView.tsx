import { api } from "../api";
import { RUNTIME_LABELS } from "../constants";
import HelpTip from "../components/HelpTip";
import { useCatalog } from "../context/CatalogContext";

/** 组合包：应用到目标项目、导出分享、导入 */
export default function BundlesView() {
  const {
    tab,
    bundles,
    settings,
    skills,
    setStatus,
    refreshCatalog,
    requestLibraryPreview,
  } = useCatalog();

  async function applyBundle(id: string) {
    if (!settings?.targetProject) {
      setStatus("请先在技能库顶部选择要写入的项目");
      return;
    }
    if (settings.conflictPolicy === "prompt") {
      const b = bundles.find((x) => x.id === id);
      if (!b) return;
      const ids: string[] = [];
      for (const item of b.items) {
        const ref = item.skillRef;
        if (ref.by === "id") {
          ids.push(ref.value);
        } else {
          const hit =
            skills.find(
              (s) =>
                s.name === ref.name && s.contentHash === ref.contentHash,
            ) || skills.find((s) => s.name === ref.name);
          if (hit) ids.push(hit.id);
        }
      }
      if (!ids.length) {
        setStatus("组合包内没有可解析的技能");
        return;
      }
      requestLibraryPreview(ids);
      return;
    }
    const entry = await api.applyBundle(
      id,
      settings.targetProject,
      null,
      settings.conflictPolicy,
    );
    await refreshCatalog();
    setStatus(
      entry.status === "ok" || entry.status === "success"
        ? "组合包已应用到项目"
        : `组合包应用结果：${entry.status}`,
    );
  }

  if (tab !== "bundles") return null;

  return (
    <div className="page">
      <h2>组合包</h2>
      <p className="page-lead">
        把常用技能打成一组。选好目标项目后，一键写入项目，适合新项目开工。
      </p>
      {!bundles.length && (
        <p className="hint">
          还没有组合包：回到「技能库」勾选技能 → 左侧填写名称创建。
        </p>
      )}
      <div className="bundle-grid">
        {bundles.map((b) => (
          <article key={b.id} className="bundle-card">
            <h3>{b.name}</h3>
            <p>{b.description || `${b.items.length} 个技能`}</p>
            <p className="muted">
              默认写入：{" "}
              {b.defaultRuntimes
                .map((rt) => RUNTIME_LABELS[rt] || rt)
                .join("、")}
            </p>
            <div className="row-actions">
              <button className="primary" onClick={() => applyBundle(b.id)}>
                应用到目标项目
              </button>
              <button
                title="复制为文本，方便分享给同事"
                onClick={async () => {
                  const json = await api.exportBundle(b.id);
                  await navigator.clipboard.writeText(json);
                  setStatus("组合包内容已复制到剪贴板");
                }}
              >
                导出分享
              </button>
              <button
                className="danger"
                onClick={async () => {
                  if (confirm(`确定删除组合包「${b.name}」？`)) {
                    await api.deleteBundle(b.id);
                    await refreshCatalog();
                  }
                }}
              >
                删除
              </button>
            </div>
          </article>
        ))}
      </div>
      <section className="import-box">
        <h3>
          导入组合包{" "}
          <HelpTip text="粘贴别人导出的组合包文本，即可加入本机列表。" />
        </h3>
        <textarea
          id="bundle-import"
          rows={6}
          placeholder="粘贴组合包 JSON 文本…"
        />
        <button
          onClick={async () => {
            const el = document.getElementById(
              "bundle-import",
            ) as HTMLTextAreaElement;
            await api.importBundle(el.value);
            el.value = "";
            await refreshCatalog();
            setStatus("组合包已导入");
          }}
        >
          导入
        </button>
      </section>
    </div>
  );
}
