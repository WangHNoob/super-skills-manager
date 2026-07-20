import { useMemo, useState } from "react";
import { api } from "../api";
import { useCatalog } from "../context/CatalogContext";

/** 操作记录：复制、删除、同步、提取、组合包应用、导入、恢复等历史 */

const OP_LABEL: Record<string, string> = {
  copy: "复制到项目",
  delete: "删除技能",
  syncTwin: "同步副本",
  extractCopy: "提取副本",
  bundleApply: "组合包应用",
  import: "导入 ZIP",
  restore: "从回收站恢复",
};

const STATUS_LABEL: Record<string, string> = {
  ok: "成功",
  partial: "部分完成",
  failed: "失败",
  success: "成功",
};

function lastSegment(path: string): string {
  if (!path) return path;
  const norm = path.replace(/\\/g, "/").replace(/\/$/, "");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

export default function OpLogView() {
  const { tab, oplog, setStatus, refreshCatalog } = useCatalog();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string>("all");

  const filtered = useMemo(
    () => (filter === "all" ? oplog : oplog.filter((e) => e.op === filter)),
    [oplog, filter],
  );

  // 必须在 early return 之前：tab 切换时 Hooks 数量不能变，否则整页卡死
  const opTypes = useMemo(() => {
    const s = new Set<string>();
    oplog.forEach((e) => s.add(e.op));
    return ["all", ...Array.from(s)];
  }, [oplog]);

  if (tab !== "oplog") return null;

  function toggle(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function restoreEntry(sources: string[]) {
    const verb = sources.length > 1 ? `这 ${sources.length} 个技能` : "该技能";
    if (!confirm(`将从系统回收站恢复${verb}到原位置，确认？`)) return;
    try {
      const entry = await api.restoreSkills(sources);
      await refreshCatalog();
      const missing = (entry.detail?.missing as string[] | undefined) ?? [];
      setStatus(
        `恢复: ${entry.status}（${entry.sources.length} 个已还原${
          missing.length ? ` · ${missing.length} 个回收站未找到` : ""
        }）`,
      );
    } catch (e) {
      setStatus(String(e));
    }
  }

  return (
    <div className="page">
      <h2>操作记录</h2>
      <p className="page-lead">
        复制、删除、同步、提取、组合包应用、导入、恢复等写操作的历史，便于核对写到了哪里。删除进系统回收站，可点「恢复」还原。
      </p>

      <div className="row-actions" style={{ margin: "0.4rem 0 1rem" }}>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="按操作类型筛选"
          style={{ maxWidth: 220 }}
        >
          {opTypes.map((t) => (
            <option key={t} value={t}>
              {t === "all" ? "全部操作" : OP_LABEL[t] || t}
            </option>
          ))}
        </select>
        <span className="hint" style={{ margin: 0 }}>
          共 {filtered.length} 条
        </span>
      </div>

      {!filtered.length && <p className="muted">没有匹配的操作记录。</p>}

      <ul className="oplog-list">
        {filtered.map((e) => {
          const open = expanded.has(e.id);
          const label = OP_LABEL[e.op] || e.op;
          const status = STATUS_LABEL[e.status] || e.status;
          const errors = (e.detail?.errors as string[] | undefined) ?? [];
          const missing = (e.detail?.missing as string[] | undefined) ?? [];
          const policy = e.detail?.policy as string | undefined;
          const bundleName = e.detail?.bundleName as string | undefined;
          const blocked = (e.detail?.blockedReadonly as string[] | undefined) ?? [];
          const canRestore = e.op === "delete" && e.sources.length > 0;

          return (
            <li key={e.id} className={`oplog-item ${open ? "open" : ""}`}>
              <div
                className="oplog-head"
                onClick={() => toggle(e.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    toggle(e.id);
                  }
                }}
              >
                <span className={`oplog-status st-${e.status}`} title={e.status}>
                  {status}
                </span>
                <span className="oplog-op">{label}</span>
                <span className="oplog-summary">
                  {bundleName ? `「${bundleName}」` : ""}
                  {e.op === "delete" || e.op === "restore"
                    ? `${e.sources.length} 个技能`
                    : `${e.targets.length} 个目标`}
                  {errors.length ? ` · ${errors.length} 个错误` : ""}
                  {missing.length ? ` · 缺失 ${missing.length}` : ""}
                  {blocked.length ? ` · 拒绝只读 ${blocked.length}` : ""}
                </span>
                <span className="oplog-time">{new Date(e.ts).toLocaleString()}</span>
                <span className="oplog-caret">{open ? "▾" : "▸"}</span>
              </div>

              {open && (
                <div className="oplog-body">
                  {canRestore && (
                    <div className="row-actions" style={{ marginBottom: "0.55rem" }}>
                      <button
                        className="primary"
                        onClick={() => void restoreEntry(e.sources)}
                      >
                        从回收站恢复
                      </button>
                    </div>
                  )}

                  {e.sources.length > 0 && (
                    <div className="oplog-sec">
                      <h4>来源（{e.sources.length}）</h4>
                      <ul>
                        {e.sources.map((p, i) => (
                          <li key={i} title={p}>
                            <code>{lastSegment(p)}</code>
                            <span className="muted tiny">{p}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {e.targets.length > 0 && (
                    <div className="oplog-sec">
                      <h4>写入目标（{e.targets.length}）</h4>
                      <ul>
                        {e.targets.map((p, i) => (
                          <li key={i} title={p}>
                            <code>{lastSegment(p)}</code>
                            <span className="muted tiny">{p}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {missing.length > 0 && (
                    <div className="oplog-sec">
                      <h4>本机缺失</h4>
                      <p className="muted tiny">{missing.join("、")}</p>
                    </div>
                  )}

                  {errors.length > 0 && (
                    <div className="oplog-sec oplog-errors">
                      <h4>错误</h4>
                      <ul>
                        {errors.map((msg, i) => (
                          <li key={i}>{msg}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {blocked.length > 0 && (
                    <div className="oplog-sec oplog-errors">
                      <h4>只读拒绝</h4>
                      <ul>
                        {blocked.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(policy || bundleName) && (
                    <p className="muted tiny">
                      {bundleName ? `组合包：${bundleName} · ` : ""}
                      {policy ? `冲突策略：${policy}` : ""}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
