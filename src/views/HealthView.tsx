import { useState } from "react";
import { api } from "../api";
import { useCatalog } from "../context/CatalogContext";
import { errMsg } from "../errMsg";

/** 健康检查：分数、问题列表、与 skills.sh 在线版本对照 */
export default function HealthView() {
  const {
    tab,
    skills,
    healthReports,
    setTab,
    setStatus,
    refreshCatalog,
    handleScan,
    requestOpenSkill,
  } = useCatalog();

  const [expandedHealthIds, setExpandedHealthIds] = useState<Set<string>>(
    new Set(),
  );

  if (tab !== "health") return null;

  return (
    <div className="page health-page">
      <div className="catalog-toolbar" style={{ marginBottom: "0.55rem" }}>
        <h2 style={{ margin: 0 }}>健康检查</h2>
        <div className="row-actions">
          <button
            onClick={() => {
              if (expandedHealthIds.size === healthReports.length) {
                setExpandedHealthIds(new Set());
              } else {
                setExpandedHealthIds(
                  new Set(healthReports.map((r) => r.skillId)),
                );
              }
            }}
            disabled={!healthReports.length}
          >
            {expandedHealthIds.size === healthReports.length &&
            healthReports.length
              ? "全部收起"
              : "全部展开"}
          </button>
          <button
            className="primary"
            onClick={async () => {
              // 手动全量：强制重算本地规则，并按需对照远端
              const n = await api.runHealthScan({
                force: true,
                includeRegistry: true,
              });
              await refreshCatalog();
              setStatus(`健康检查完成：${n} 条报告`);
            }}
          >
            重新检查全部
          </button>
        </div>
      </div>
      <p className="page-lead">
        检查描述是否清楚、结构是否完整。分数仅供参考；只有你点「应用修复」才会改文件。
        从 skills.sh 安装的技能还会对照网上版本。
      </p>

      <div className="health-report-list">
        {healthReports.map((r) => {
          const expanded = expandedHealthIds.has(r.skillId);
          const displayName =
            (r.skillName && r.skillName.trim()) ||
            skills.find((s) => s.id === r.skillId)?.name ||
            "未命名 skill";
          const previewIssues = r.issues.slice(0, 2);
          const hiddenCount = Math.max(0, r.issues.length - previewIssues.length);
          const reg = r.registry;
          const regLabel =
            reg?.status === "matched"
              ? "与远端一致"
              : reg?.status === "diverged"
                ? "与远端不一致"
                : reg?.status === "fetch_failed"
                  ? "远端拉取失败"
                  : reg?.status === "unsupported"
                    ? "无法对照"
                    : null;

          return (
            <article
              key={r.skillId}
              className={"health-report-card" + (expanded ? " open" : "")}
            >
              <header
                className="health-report-head"
                onClick={() => {
                  setExpandedHealthIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(r.skillId)) next.delete(r.skillId);
                    else next.add(r.skillId);
                    return next;
                  });
                }}
              >
                <span
                  className={`health-badge g-${r.grade.toLowerCase()}`}
                >
                  {r.grade}
                </span>
                <div className="health-report-title">
                  <strong title={r.skillId}>{displayName}</strong>
                  <span className="muted">
                    {Math.round(r.score)} 分 · {r.issues.length} 个问题
                    {regLabel && (
                      <>
                        {" · "}
                        <span
                          className={
                            "reg-pill " +
                            (reg?.status === "matched"
                              ? "ok"
                              : reg?.status === "diverged"
                                ? "bad"
                                : "info")
                          }
                        >
                          skills.sh: {regLabel}
                        </span>
                      </>
                    )}
                  </span>
                </div>
                <div className="health-head-actions">
                  {r.dirPath && (
                    <button
                      type="button"
                      title={r.dirPath}
                      onClick={(e) => {
                        e.stopPropagation();
                        void api
                          .reveal(r.dirPath!)
                          .then(() => setStatus(`已打开：${r.dirPath}`))
                          .catch((err) => setStatus(errMsg(err)));
                      }}
                    >
                      打开目录
                    </button>
                  )}
                  <span className="expand-caret">
                    {expanded ? "▾" : "▸"}
                  </span>
                </div>
              </header>

              {!expanded && (
                <div className="health-preview">
                  {reg?.status === "diverged" && (
                    <div className="sev-line sev-warn">
                      <code>REG</code>
                      <span>
                        {reg.message}
                        {reg.diff
                          ? `（展开可查看 ${reg.diff.split("\n").length} 行 diff）`
                          : ""}
                      </span>
                    </div>
                  )}
                  {previewIssues.length ? (
                    previewIssues.map((iss, idx) => (
                      <div key={idx} className={`sev-line sev-${iss.severity}`}>
                        <code>{iss.ruleId}</code>
                        <span>{iss.message}</span>
                      </div>
                    ))
                  ) : (
                    !reg && <div className="muted">暂无问题</div>
                  )}
                  {hiddenCount > 0 && (
                    <button
                      className="linkish more-issues"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedHealthIds((prev) =>
                          new Set(prev).add(r.skillId),
                        );
                      }}
                    >
                      还有 {hiddenCount} 条，点击展开全部
                    </button>
                  )}
                </div>
              )}

              {expanded && (
                <div className="health-report-body">
                  {reg && (
                    <section className="registry-box">
                      <h4>与 skills.sh 在线版本对照</h4>
                      <p>
                        <span
                          className={
                            "reg-pill " +
                            (reg.status === "matched"
                              ? "ok"
                              : reg.status === "diverged"
                                ? "bad"
                                : "info")
                          }
                        >
                          {regLabel || reg.status}
                        </span>{" "}
                        {reg.message}
                      </p>
                      <div className="muted reg-meta">
                        {reg.source && <div>来源：{reg.source}</div>}
                        {reg.remoteFetchedUrl && (
                          <div>远端：{reg.remoteFetchedUrl}</div>
                        )}
                        <div>
                          本地 hash：{reg.localSkillMdHash.slice(0, 12)}…
                          {reg.remoteSkillMdHash
                            ? ` · 远端 hash：${reg.remoteSkillMdHash.slice(0, 12)}…`
                            : ""}
                        </div>
                      </div>
                      {reg.diff && (
                        <pre className="diff-view">{reg.diff}</pre>
                      )}
                      {reg.status === "diverged" && (
                        <div className="row-actions">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setTab("registry");
                              setStatus(
                                `可在「在线安装」用终端更新「${displayName}」相关技能`,
                              );
                            }}
                          >
                            前往在线安装更新
                          </button>
                        </div>
                      )}
                    </section>
                  )}
                  <ul className="issue-list">
                    {r.issues.length === 0 && (
                      <li className="muted">没有发现问题</li>
                    )}
                    {r.issues.map((iss, idx) => (
                      <li key={idx} className={`sev-${iss.severity}`}>
                        <div className="issue-main">
                          <span className={`sev-tag ${iss.severity}`}>
                            {iss.severity}
                          </span>
                          <code>{iss.ruleId}</code>
                          <span className="issue-msg">{iss.message}</span>
                        </div>
                        {iss.fixHint && (
                          <div className="issue-hint">建议：{iss.fixHint}</div>
                        )}
                        {iss.autoFix && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              await api.applyHealthFix(r.skillId, iss.ruleId);
                              await handleScan();
                              setStatus(`已应用修复 ${iss.ruleId}`);
                            }}
                          >
                            应用修复
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="row-actions">
                    <button
                      onClick={() => {
                        requestOpenSkill(r.skillId);
                      }}
                    >
                      在技能库中查看
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {!healthReports.length && (
        <p className="muted">
          还没有报告。请先点右上角「重新扫描」，或上方「重新检查全部」。
        </p>
      )}
    </div>
  );
}
