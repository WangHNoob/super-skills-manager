import { useMemo, useState } from "react";
import { api } from "../api";
import { CONFLICT_LABELS } from "../conflict";
import { RUNTIME_LABELS } from "../constants";
import HelpTip from "../components/HelpTip";
import { errMsg } from "../errMsg";
import { useCatalog } from "../context/CatalogContext";
import type { Bundle, CopyPreview, SkillRecord } from "../types";

type ItemStatus = "matched" | "hash-mismatch" | "missing";
interface ResolvedItem {
  status: ItemStatus;
  refName: string;
  skill?: SkillRecord;
}

/** 把 bundle item（按 id 或 name+hash 引用）解析到本机当前技能 */
function resolveItem(item: Bundle["items"][number], skills: SkillRecord[]): ResolvedItem {
  const ref = item.skillRef;
  if (ref.by === "id") {
    const s = skills.find((x) => x.id === ref.value);
    return s
      ? { status: "matched", refName: s.name, skill: s }
      : { status: "missing", refName: ref.value };
  }
  const byHash = skills.find(
    (x) => x.name === ref.name && x.contentHash === ref.contentHash,
  );
  if (byHash) return { status: "matched", refName: ref.name, skill: byHash };
  const byName = skills.find((x) => x.name === ref.name);
  if (byName) return { status: "hash-mismatch", refName: ref.name, skill: byName };
  return { status: "missing", refName: ref.name };
}

const STATUS_LABEL: Record<ItemStatus, string> = {
  matched: "本机已收录",
  "hash-mismatch": "内容已变化",
  missing: "本机缺失",
};

/** 组合包：查看内容、编辑、应用前预览、导出分享、导入 */
export default function BundlesView() {
  const { tab, bundles, settings, skills, setStatus, refreshCatalog } = useCatalog();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editIds, setEditIds] = useState<Set<string>>(new Set());
  const [pickQuery, setPickQuery] = useState("");

  const [applying, setApplying] = useState<{
    bundleId: string;
    preview: CopyPreview;
    missing: string[];
  } | null>(null);

  const pickList = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    return skills
      .filter((s) => !editIds.has(s.id))
      .filter(
        (s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [skills, editIds, pickQuery]);

  if (tab !== "bundles") return null;

  function startEdit(b: Bundle) {
    setEditingId(b.id);
    setEditName(b.name);
    setPickQuery("");
    const ids = new Set<string>();
    for (const item of b.items) {
      const r = resolveItem(item, skills);
      if (r.skill) ids.add(r.skill.id);
    }
    setEditIds(ids);
  }

  async function saveEdit(id: string) {
    try {
      await api.updateBundle({
        id,
        name: editName,
        skillIds: [...editIds],
      });
      await refreshCatalog();
      setEditingId(null);
      setStatus("组合包已更新");
    } catch (e) {
      setStatus(errMsg(e));
    }
  }

  /** 生成应用预览；prompt 冲突在预览中逐项选择 */
  async function prepareApply(b: Bundle) {
    if (!settings?.targetProject) {
      setStatus("请先在技能库顶部选择要写入的项目");
      return;
    }
    try {
      const r = await api.previewBundle({
        bundleId: b.id,
        project: settings.targetProject,
        conflictPolicy: settings.conflictPolicy,
      });
      if (!r.preview.items.length) {
        setStatus("组合包内没有可解析到本机的技能（可能全部缺失）");
        return;
      }
      setApplying({ bundleId: b.id, preview: r.preview, missing: r.missing });
    } catch (e) {
      setStatus(errMsg(e));
    }
  }

  async function confirmApply() {
    if (!applying || !settings) return;
    const preview = applying.preview;
    if (preview.items.some((i) => i.action === "prompt")) {
      setStatus("请先为每个冲突项选择：覆盖 / 跳过 / 改名");
      return;
    }
    const overwrites = preview.items.filter(
      (i) => i.willOverwrite || i.action === "overwrite",
    );
    if (overwrites.length) {
      const lines = overwrites
        .map((i) => `· ${i.skillName}\n  ${i.targetPath}`)
        .join("\n");
      if (!confirm(`以下 ${overwrites.length} 项将删除并替换已有目录，确认应用组合包？\n\n${lines}`)) {
        return;
      }
    }
    try {
      const entry = await api.executeCopy(preview, settings.conflictPolicy);
      await refreshCatalog();
      setApplying(null);
      setStatus(`组合包已应用：${entry.status}（写入 ${entry.targets.length} 个目标）`);
    } catch (e) {
      setStatus(errMsg(e));
    }
  }

  return (
    <div className="page">
      <h2>
        组合包{" "}
        <HelpTip text="组合包是一组常用技能的「清单」：只记录技能名+内容哈希，不含正文。导出 JSON 后他人导入即可按名匹配本机技能，适合团队分享固定搭配。" />
      </h2>
      <p className="page-lead">
        把常用技能打成一组。选好目标项目后，应用前会先预览将写入哪些路径、有无冲突，确认后再落地。
      </p>
      {!bundles.length && (
        <p className="hint">
          还没有组合包：回到「技能库」勾选技能 → 左侧填写名称创建。
        </p>
      )}
      <div className="bundle-grid">
        {bundles.map((b) => {
          const resolved = b.items.map((it) => resolveItem(it, skills));
          const matchedCount = resolved.filter((r) => r.status === "matched").length;
          const missingCount = resolved.filter((r) => r.status === "missing").length;
          const isEditing = editingId === b.id;
          const isApplying = applying?.bundleId === b.id;

          return (
            <article key={b.id} className="bundle-card">
              {isEditing ? (
                <>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    aria-label="组合包名称"
                  />
                  <div className="bundle-skill-list">
                    {[...editIds].map((id) => {
                      const s = skills.find((x) => x.id === id);
                      if (!s) return null;
                      return (
                        <div key={id} className="bundle-skill-row">
                          <span>
                            <strong>{s.name}</strong>
                            <span className="muted tiny"> · {s.runtime}</span>
                          </span>
                          <button
                            className="linkish"
                            style={{ width: "auto" }}
                            onClick={() =>
                              setEditIds((prev) => {
                                const n = new Set(prev);
                                n.delete(id);
                                return n;
                              })
                            }
                          >
                            移除
                          </button>
                        </div>
                      );
                    })}
                    {!editIds.size && <p className="muted tiny">已清空</p>}
                  </div>
                  <div className="bundle-picker">
                    <input
                      value={pickQuery}
                      onChange={(e) => setPickQuery(e.target.value)}
                      placeholder="搜索要添加的本机技能…"
                    />
                    <div className="bundle-picker-list">
                      {pickList.map((s) => (
                        <button
                          key={s.id}
                          className="linkish"
                          style={{ width: "auto" }}
                          onClick={() => {
                            setEditIds((prev) => new Set(prev).add(s.id));
                            setPickQuery("");
                          }}
                        >
                          <span>
                            <strong>{s.name}</strong>
                            <span className="muted tiny"> · {s.runtime}</span>
                          </span>
                          <span>添加</span>
                        </button>
                      ))}
                      {!pickList.length && <p className="muted tiny">无可添加项</p>}
                    </div>
                  </div>
                  <div className="row-actions">
                    <button className="primary" onClick={() => void saveEdit(b.id)}>
                      保存
                    </button>
                    <button onClick={() => setEditingId(null)}>取消</button>
                  </div>
                </>
              ) : (
                <>
                  <h3>{b.name}</h3>
                  <p>{b.description || `${b.items.length} 个技能`}</p>
                  <p className="muted">
                    默认写入：
                    {b.defaultRuntimes.map((rt) => RUNTIME_LABELS[rt] || rt).join("、")}
                  </p>

                  <div className="bundle-skill-list">
                    {resolved.map((r, i) => (
                      <div key={i} className={`bundle-skill-row status-${r.status}`}>
                        <span title={STATUS_LABEL[r.status]}>
                          <strong>{r.refName}</strong>
                          <em className="bundle-status">
                            {r.status === "matched"
                              ? "✓"
                              : r.status === "hash-mismatch"
                                ? "≈"
                                : "✗"}{" "}
                            {STATUS_LABEL[r.status]}
                          </em>
                        </span>
                      </div>
                    ))}
                    {!resolved.length && <p className="muted tiny">空组合包</p>}
                  </div>
                  {(matchedCount > 0 || missingCount > 0) && (
                    <p className="hint">
                      本机匹配 {matchedCount}
                      {missingCount > 0 ? ` · 缺失 ${missingCount}（可在线安装或导入）` : ""}
                    </p>
                  )}

                  {isApplying && applying && (
                    <div className="bundle-preview">
                      <div className="detail-section-head">
                        <h3>应用预览 · {applying.preview.items.length} 项</h3>
                      </div>
                      {applying.missing.length > 0 && (
                        <p className="hint">
                          本机缺失 {applying.missing.length} 个，未列入预览：
                          {applying.missing.join("、")}
                        </p>
                      )}
                      <ul>
                        {applying.preview.items.map((it, i) => (
                          <li
                            key={i}
                            className={
                              it.action === "prompt" ||
                              it.willOverwrite ||
                              it.action === "overwrite"
                                ? "preview-prompt"
                                : undefined
                            }
                          >
                            {it.action === "prompt" ? (
                              <select
                                aria-label={`冲突处理：${it.skillName}`}
                                defaultValue=""
                                onChange={(e) => {
                                  const action = e.target.value;
                                  if (!action) return;
                                  setApplying({
                                    ...applying,
                                    preview: {
                                      items: applying.preview.items.map((x, j) =>
                                        j === i
                                          ? {
                                              ...x,
                                              action,
                                              willOverwrite: action === "overwrite",
                                            }
                                          : x,
                                      ),
                                    },
                                  });
                                }}
                              >
                                <option value="" disabled>
                                  请选择…
                                </option>
                                <option value="overwrite">覆盖</option>
                                <option value="skip">跳过</option>
                                <option value="rename">改名</option>
                              </select>
                            ) : (
                              <code>{it.action}</code>
                            )}
                            <span title={it.targetPath}>
                              {it.skillName} → {it.targetPath}
                              {(it.willOverwrite || it.action === "overwrite") && (
                                <em className="overwrite-warn"> · 将替换</em>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div className="row-actions">
                        <button
                          className="primary"
                          onClick={() => void confirmApply()}
                          disabled={applying.preview.items.some(
                            (i) => i.action === "prompt",
                          )}
                        >
                          确认应用
                        </button>
                        <button onClick={() => setApplying(null)}>取消</button>
                      </div>
                      <p className="hint">
                        当前策略：
                        {CONFLICT_LABELS[settings?.conflictPolicy || ""] ||
                          settings?.conflictPolicy}
                      </p>
                    </div>
                  )}

                  {!isApplying && (
                    <div className="row-actions">
                      <button className="primary" onClick={() => void prepareApply(b)}>
                        应用到目标项目
                      </button>
                      <button onClick={() => startEdit(b)}>编辑</button>
                      <button
                        title="复制为 JSON 文本（仅技能名+哈希清单，便于分享）"
                        onClick={async () => {
                          const json = await api.exportBundle(b.id);
                          await navigator.clipboard.writeText(json);
                          setStatus("组合包 JSON 已复制到剪贴板");
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
                  )}
                </>
              )}
            </article>
          );
        })}
      </div>
      <section className="import-box">
        <h3>
          导入组合包{" "}
          <HelpTip text="粘贴别人导出的组合包 JSON（技能名+哈希清单），加入本机列表；应用时按名匹配本机技能。" />
        </h3>
        <textarea id="bundle-import" rows={6} placeholder="粘贴组合包 JSON 文本…" />
        <button
          onClick={async () => {
            const el = document.getElementById("bundle-import") as HTMLTextAreaElement;
            try {
              await api.importBundle(el.value);
              el.value = "";
              await refreshCatalog();
              setStatus("组合包已导入");
            } catch (e) {
              setStatus(errMsg(e));
            }
          }}
        >
          导入
        </button>
      </section>
    </div>
  );
}
