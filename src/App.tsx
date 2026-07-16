import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import ReactMarkdown from "react-markdown";
import { api } from "./api";
import type {
  AppSettings,
  Bundle,
  CopyPreview,
  HealthReport,
  OpLogEntry,
  ProjectProfile,
  ProjectRoot,
  SkillDetail,
  SkillRecord,
  SourceInfo,
} from "./types";
import "./App.css";

type Tab =
  | "library"
  | "bundles"
  | "sources"
  | "health"
  | "wizard"
  | "registry"
  | "settings"
  | "oplog";

const RUNTIMES = ["cursor", "claude", "agents", "codex", "plugin"];

export default function App() {
  const [tab, setTab] = useState<Tab>("library");
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [projects, setProjects] = useState<ProjectRoot[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [oplog, setOplog] = useState<OpLogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [runtimeFilter, setRuntimeFilter] = useState<string[]>([]);
  const [twinsOnly, setTwinsOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [twinDiff, setTwinDiff] = useState<import("./types").TwinDiff | null>(
    null,
  );
  const [dropActive, setDropActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [policyTemplates, setPolicyTemplates] = useState<
    import("./types").PolicyTemplate[]
  >([]);
  const [insights, setInsights] = useState<import("./types").UsageInsights | null>(
    null,
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [preview, setPreview] = useState<CopyPreview | null>(null);
  const [status, setStatus] = useState("");
  const [scanning, setScanning] = useState(false);
  const [bundleName, setBundleName] = useState("");
  const [healthReports, setHealthReports] = useState<HealthReport[]>([]);
  const [profile, setProfile] = useState<ProjectProfile | null>(null);
  const [regQuery, setRegQuery] = useState("");
  const [regPackage, setRegPackage] = useState("vercel-labs/agent-skills");
  const [regOutput, setRegOutput] = useState("");
  const [regBusy, setRegBusy] = useState(false);
  const [expandedHealthIds, setExpandedHealthIds] = useState<Set<string>>(
    new Set(),
  );
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const editing =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "/" && !editing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setTab("library");
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (e.key === "Escape") {
        if (twinDiff) {
          setTwinDiff(null);
          return;
        }
        if (status) setStatus("");
      }
      if (
        e.key === "Delete" &&
        !editing &&
        tab === "library" &&
        selectedIds.size
      ) {
        e.preventDefault();
        void runDelete();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runDelete closes over latest selectedIds via state
  }, [status, twinDiff, tab, selectedIds]);

  const refreshCatalog = useCallback(async () => {
    const filter = {
      query: query || null,
      runtimes: runtimeFilter.length ? runtimeFilter : null,
      twinsOnly,
      favoritesOnly,
      tag: tagFilter,
    };
    const [sk, src, b, p, s, log, health, templates, usage, tags] =
      await Promise.all([
        api.listSkills(filter),
        api.listSources(),
        api.listBundles(),
        api.listProjects(),
        api.getSettings(),
        api.listOplog(30),
        api.listHealthReports().catch(() => [] as HealthReport[]),
        api.listPolicyTemplates().catch(() => []),
        api.getUsageInsights().catch(() => null),
        api.listSkillTags().catch(() => [] as string[]),
      ]);
    setSkills(sk);
    setSources(src);
    setBundles(b);
    setProjects(p);
    setSettings(s);
    setOplog(log);
    setHealthReports(health);
    setPolicyTemplates(templates);
    setInsights(usage);
    setAllTags(tags);
  }, [query, runtimeFilter, twinsOnly, favoritesOnly, tagFilter]);

  useEffect(() => {
    refreshCatalog().catch((e) => setStatus(String(e)));
  }, [refreshCatalog]);

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    api.getSkillDetail(activeId)
      .then(setDetail)
      .catch((e) => setStatus(String(e)));
  }, [activeId]);

  const twinCount = useMemo(
    () => skills.filter((s) => s.twinGroupId).length,
    [skills],
  );

  async function handleScan() {
    setScanning(true);
    setStatus("正在扫描…");
    try {
      const n = await api.scanNow();
      const h = await api.runHealthScan();
      await refreshCatalog();
      setStatus(`扫描完成：${n} 个目录，健康检查 ${h} 条`);
    } catch (e) {
      setStatus(String(e));
    } finally {
      setScanning(false);
    }
  }

  async function runWizard() {
    const path = settings?.targetProject;
    if (!path) {
      setStatus("请先在右侧或「源与项目」选择目标项目");
      return;
    }
    try {
      setProfile(await api.analyzeProject(path));
      setTab("wizard");
      setStatus("项目分析完成");
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function runRegistry(
    action: () => Promise<{ ok: boolean; stdout: string; stderr: string }>,
  ) {
    setRegBusy(true);
    setStatus("正在调用 npx skills…");
    try {
      const r = await action();
      setRegOutput(
        [r.stdout, r.stderr].filter(Boolean).join("\n---\n") ||
          `(exit ${r.ok ? 0 : 1})`,
      );
      setStatus(r.ok ? "Registry 命令完成" : "Registry 命令失败，见输出");
      if (r.ok) await handleScan();
    } catch (e) {
      setStatus(String(e));
      setRegOutput(String(e));
    } finally {
      setRegBusy(false);
    }
  }

  function toggleSelect(id: string, multi: boolean) {
    setActiveId(id);
    setSelectedIds((prev) => {
      const next = multi ? new Set(prev) : new Set<string>();
      if (next.has(id) && multi) next.delete(id);
      else next.add(id);
      if (!multi) next.add(id);
      return next;
    });
  }

  async function pickProject() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") {
      const s = await api.setTargetProject(dir);
      setSettings(s);
      await refreshCatalog();
      setStatus(`目标项目: ${dir}`);
    }
  }

  async function buildPreviewFromIds(ids: string[]) {
    if (!settings?.targetProject) {
      setStatus("请先选择目标项目");
      return;
    }
    if (!ids.length) {
      setStatus("请先选择 skill");
      return;
    }
    const p = await api.previewCopy(
      ids,
      settings.targetProject,
      settings.writeRuntimes,
      settings.conflictPolicy === "prompt"
        ? "overwrite"
        : settings.conflictPolicy,
    );
    setPreview(p);
    setStatus(`已生成复制预览：${p.items.length} 项`);
  }

  async function buildPreview() {
    await buildPreviewFromIds([...selectedIds]);
  }

  async function saveTags(next: string[]) {
    if (!detail) return;
    await api.setSkillTags(detail.skill.id, next);
    setTagDraft("");
    await refreshCatalog();
    setActiveId(detail.skill.id);
    setDetail(await api.getSkillDetail(detail.skill.id));
  }

  async function runCopy() {
    if (!preview || !settings) return;
    const policy =
      settings.conflictPolicy === "prompt"
        ? "overwrite"
        : settings.conflictPolicy;
    const entry = await api.executeCopy(preview, policy);
    setPreview(null);
    await refreshCatalog();
    setStatus(`复制完成: ${entry.status}（${entry.targets.length} 个目标）`);
  }

  async function runDelete() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const impact = await api.deleteImpact(ids);
    const lines = (impact.items || [])
      .map(
        (i) =>
          `${i.name} [${i.access}] twins=${i.twinCount} bundles=${(i.bundles as string[])?.join(",") || "-"}`,
      )
      .join("\n");
    if (!confirm(`确认删除以下 skill（进回收站）？\n\n${lines}`)) return;
    const entry = await api.deleteSkills(ids);
    setSelectedIds(new Set());
    setActiveId(null);
    await refreshCatalog();
    setStatus(`删除: ${entry.status}`);
  }

  async function runExtract() {
    if (!activeId) return;
    const entry = await api.extractSkill(activeId);
    await refreshCatalog();
    setStatus(`已提取到: ${entry.targets[0] || "?"}`);
  }

  async function createBundle() {
    const ids = [...selectedIds];
    if (!ids.length || !bundleName.trim()) {
      setStatus("请选择 skill 并填写 Bundle 名称");
      return;
    }
    await api.createBundle(
      bundleName.trim(),
      null,
      ids,
      settings?.writeRuntimes || ["agents", "claude"],
    );
    setBundleName("");
    await refreshCatalog();
    setStatus("Bundle 已创建");
    setTab("bundles");
  }

  async function applyBundle(id: string) {
    if (!settings?.targetProject) {
      setStatus("请先选择目标项目");
      return;
    }
    const policy =
      settings.conflictPolicy === "prompt"
        ? "overwrite"
        : settings.conflictPolicy;
    const entry = await api.applyBundle(
      id,
      settings.targetProject,
      null,
      policy,
    );
    await refreshCatalog();
    setStatus(`Bundle 应用: ${entry.status}`);
  }

  async function toggleRuntimeFilter(rt: string) {
    setRuntimeFilter((prev) =>
      prev.includes(rt) ? prev.filter((x) => x !== rt) : [...prev, rt],
    );
  }

  async function toggleWriteRuntime(rt: string) {
    if (!settings) return;
    const writeRuntimes = settings.writeRuntimes.includes(rt)
      ? settings.writeRuntimes.filter((x) => x !== rt)
      : [...settings.writeRuntimes, rt];
    const next = { ...settings, writeRuntimes };
    setSettings(await api.updateSettings(next));
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">SSM</span>
          <div>
            <strong>AI Skills 超级管理器</strong>
            <p>索引 · 理解 · 组合 · 分发</p>
          </div>
        </div>
        <nav className="tabs">
          {(
            [
              ["library", "技能库"],
              ["bundles", "组合包"],
              ["health", "健康"],
              ["wizard", "向导"],
              ["registry", "Registry"],
              ["settings", "设置"],
              ["sources", "源与项目"],
              ["oplog", "日志"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={tab === k ? "active" : ""}
              aria-current={tab === k ? "page" : undefined}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <button disabled={scanning} onClick={handleScan}>
            {scanning ? "扫描中…" : "重新扫描"}
          </button>
        </div>
      </header>

      {status && (
        <div className="status-bar" role="status">
          <span>{status}</span>
          <button type="button" onClick={() => setStatus("")} aria-label="关闭提示">
            关闭
          </button>
        </div>
      )}

      {tab === "library" && (
        <div className="workspace">
          <aside className="rail">
            <label className="search">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索 name / description…  (/)"
                aria-label="搜索 skills"
              />
            </label>
            <section>
              <h3>Runtime</h3>
              <div className="chip-row">
                {RUNTIMES.map((rt) => (
                  <button
                    key={rt}
                    className={
                      runtimeFilter.includes(rt) ? "chip active" : "chip"
                    }
                    onClick={() => toggleRuntimeFilter(rt)}
                  >
                    {rt}
                  </button>
                ))}
              </div>
            </section>
            <section>
              <label className="check">
                <input
                  type="checkbox"
                  checked={twinsOnly}
                  onChange={(e) => setTwinsOnly(e.target.checked)}
                />
                仅看有副本（{twinCount}）
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={favoritesOnly}
                  onChange={(e) => setFavoritesOnly(e.target.checked)}
                />
                仅看收藏
              </label>
            </section>
            {!!allTags.length && (
              <section>
                <h3>标签</h3>
                <div className="chip-row">
                  <button
                    type="button"
                    className={!tagFilter ? "chip active" : "chip"}
                    onClick={() => setTagFilter(null)}
                  >
                    全部
                  </button>
                  {allTags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={tagFilter === t ? "chip active" : "chip"}
                      onClick={() =>
                        setTagFilter((cur) => (cur === t ? null : t))
                      }
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {insights && (insights.favorites.length > 0 || insights.recent.length > 0) && (
              <section>
                <h3>常用</h3>
                <ul className="plain-list">
                  {insights.recent.slice(0, 5).map((s) => (
                    <li key={"r-" + s.id}>
                      <button
                        className="linkish"
                        onClick={() => setActiveId(s.id)}
                      >
                        {s.name}
                        <span>最近</span>
                      </button>
                    </li>
                  ))}
                  {insights.favorites.slice(0, 5).map((s) => (
                    <li key={"f-" + s.id}>
                      <button
                        className="linkish"
                        onClick={() => setActiveId(s.id)}
                      >
                        {s.name}
                        <span>★</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h3>Bundles</h3>
              <ul className="plain-list">
                {bundles.map((b) => (
                  <li key={b.id}>
                    <button className="linkish" onClick={() => setTab("bundles")}>
                      {b.name}
                      <span>{b.items.length}</span>
                    </button>
                  </li>
                ))}
                {!bundles.length && <li className="muted">暂无组合包</li>}
              </ul>
            </section>
            <section>
              <h3>新建 Bundle</h3>
              <input
                value={bundleName}
                onChange={(e) => setBundleName(e.target.value)}
                placeholder="组合包名称"
              />
              <button className="primary block" onClick={createBundle}>
                用所选 skill 创建
              </button>
            </section>
          </aside>

          <main className="catalog">
            <div className="catalog-toolbar">
              <span>
                {skills.length} skills
                {selectedIds.size ? ` · 已选 ${selectedIds.size}` : ""}
              </span>
              <div className="row-actions">
                <button onClick={buildPreview}>预览复制到项目</button>
                <button
                  onClick={async () => {
                    const ids = [...selectedIds];
                    if (!ids.length) {
                      setStatus("请先选择 skill");
                      return;
                    }
                    const art = await api.exportSkillsZip(ids);
                    const a = document.createElement("a");
                    a.href = `data:application/zip;base64,${art.base64}`;
                    a.download = art.filename;
                    a.click();
                    setStatus(`已导出 ${art.skillCount} 个 skill`);
                  }}
                >
                  导出 ZIP
                </button>
                <button
                  onClick={async () => {
                    const id = activeId || [...selectedIds][0];
                    if (!id) return;
                    const next = !skills.find((s) => s.id === id)?.favorite;
                    await api.setFavorite(id, next);
                    await refreshCatalog();
                  }}
                >
                  收藏/取消
                </button>
                <button className="danger" onClick={runDelete}>
                  删除
                </button>
              </div>
            </div>
            <div className="card-grid">
              {skills.map((s) => (
                <article
                  key={s.id}
                  draggable
                  className={
                    "skill-card" +
                    (activeId === s.id ? " active" : "") +
                    (selectedIds.has(s.id) ? " selected" : "")
                  }
                  onClick={(e) => toggleSelect(s.id, e.ctrlKey || e.metaKey)}
                  onDragStart={(e) => {
                    const ids =
                      selectedIds.has(s.id) && selectedIds.size
                        ? [...selectedIds]
                        : [s.id];
                    if (!selectedIds.has(s.id)) {
                      setSelectedIds(new Set([s.id]));
                      setActiveId(s.id);
                    }
                    e.dataTransfer.setData(
                      "application/ssm-skills",
                      JSON.stringify(ids),
                    );
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                >
                  <header>
                    <h4>{s.name}</h4>
                    <div className="badges">
                      <span>{s.runtime}</span>
                      <span>{s.scope}</span>
                      {s.access === "readonly" && (
                        <span className="ro">RO</span>
                      )}
                      {s.hasScripts && <span>scripts</span>}
                      {s.twinGroupId && <span className="twin">twins</span>}
                      {s.tags.slice(0, 2).map((t) => (
                        <span key={t} className="tag-badge">
                          {t}
                        </span>
                      ))}
                      {s.healthScore != null && (
                        <span
                          className={
                            "health-badge g-" +
                            (s.healthScore >= 85
                              ? "a"
                              : s.healthScore >= 70
                                ? "b"
                                : s.healthScore >= 50
                                  ? "c"
                                  : "d")
                          }
                        >
                          {Math.round(s.healthScore)}
                        </span>
                      )}
                    </div>
                  </header>
                  <p>{s.description || "（无 description）"}</p>
                  <footer>{s.sourceId}</footer>
                </article>
              ))}
              {!skills.length && (
                <div className="empty pad">
                  <div>
                    <strong>暂无 skill</strong>
                    <p className="muted" style={{ margin: "0.4rem 0 0" }}>
                      按 <kbd>/</kbd> 搜索、<kbd>Del</kbd> 删除；可拖到右侧「目标项目」复制。
                    </p>
                  </div>
                </div>
              )}
            </div>
          </main>

          <aside className="inspector">
            <div className="inspector-main">
              {!detail ? (
                <div className="empty pad">选择一个 skill 查看详情</div>
              ) : (
                <div className="detail">
                  <header className="detail-head">
                    <div className="detail-title-row">
                      <h2 title={detail.skill.name}>{detail.skill.name}</h2>
                      <div className="detail-actions">
                        <button
                          type="button"
                          onClick={() => api.reveal(detail.skill.dirPath)}
                        >
                          打开目录
                        </button>
                        {detail.skill.access === "readonly" && (
                          <button type="button" onClick={runExtract}>
                            提取副本
                          </button>
                        )}
                        <button
                          type="button"
                          className={showSource ? "active-toggle" : ""}
                          onClick={() => setShowSource((v) => !v)}
                        >
                          {showSource ? "友好视图" : "源码"}
                        </button>
                      </div>
                    </div>
                    <p className="path" title={detail.skill.dirPath}>
                      {detail.skill.dirPath}
                    </p>
                    <div className="badges">
                      <span>{detail.skill.runtime}</span>
                      <span>{detail.skill.scope}</span>
                      <span>{detail.skill.origin}</span>
                      {detail.skill.access === "readonly" && (
                        <span className="ro">RO</span>
                      )}
                      {detail.health && (
                        <span
                          className={
                            "health-badge g-" +
                            detail.health.grade.toLowerCase()
                          }
                        >
                          {detail.health.grade} ·{" "}
                          {Math.round(detail.health.score)}
                        </span>
                      )}
                    </div>
                  </header>

                  {detail.skill.description && (
                    <p className="detail-lead">{detail.skill.description}</p>
                  )}

                  <section className="detail-section">
                    <div className="detail-section-head">
                      <h3>标签</h3>
                    </div>
                    <div className="tag-editor">
                      <div className="chip-row">
                        {detail.skill.tags.length === 0 && (
                          <span className="muted tiny">暂无标签</span>
                        )}
                        {detail.skill.tags.map((t) => (
                          <button
                            key={t}
                            type="button"
                            className="chip active"
                            title="点击移除"
                            onClick={() =>
                              void saveTags(
                                detail.skill.tags.filter((x) => x !== t),
                              )
                            }
                          >
                            {t} ×
                          </button>
                        ))}
                      </div>
                      <div className="tag-add">
                        <input
                          value={tagDraft}
                          onChange={(e) => setTagDraft(e.target.value)}
                          placeholder="添加标签…"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && tagDraft.trim()) {
                              e.preventDefault();
                              void saveTags([
                                ...detail.skill.tags,
                                tagDraft.trim(),
                              ]);
                            }
                          }}
                        />
                        <button
                          type="button"
                          disabled={!tagDraft.trim()}
                          onClick={() =>
                            void saveTags([
                              ...detail.skill.tags,
                              tagDraft.trim(),
                            ])
                          }
                        >
                          添加
                        </button>
                      </div>
                    </div>
                  </section>

                  {detail.health &&
                    (detail.health.issues.length > 0 ||
                      detail.health.registry) && (
                      <section className="detail-section">
                        <div className="detail-section-head">
                          <h3>健康</h3>
                          <button
                            type="button"
                            className="linkish"
                            onClick={() => setTab("health")}
                          >
                            全部报告
                          </button>
                        </div>
                        {detail.health.registry && (
                          <div className="registry-box compact">
                            <span
                              className={
                                "reg-pill " +
                                (detail.health.registry.status === "matched"
                                  ? "ok"
                                  : detail.health.registry.status ===
                                      "diverged"
                                    ? "bad"
                                    : "info")
                              }
                            >
                              skills.sh: {detail.health.registry.status}
                            </span>
                            <p className="muted tiny">
                              {detail.health.registry.message}
                            </p>
                            {detail.health.registry.diff && (
                              <pre className="diff-view">
                                {detail.health.registry.diff}
                              </pre>
                            )}
                          </div>
                        )}
                        <ul className="issue-list compact">
                          {detail.health.issues.slice(0, 5).map((iss, idx) => (
                            <li key={idx} className={`sev-${iss.severity}`}>
                              <div className="issue-main">
                                <span className={`sev-tag ${iss.severity}`}>
                                  {iss.severity}
                                </span>
                                <code>{iss.ruleId}</code>
                                <span className="issue-msg">{iss.message}</span>
                              </div>
                              {iss.autoFix && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await api.applyHealthFix(
                                      detail.skill.id,
                                      iss.ruleId,
                                    );
                                    await handleScan();
                                    setActiveId(detail.skill.id);
                                    setStatus(`已应用修复 ${iss.ruleId}`);
                                  }}
                                >
                                  应用修复
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                        {detail.health.issues.length > 5 && (
                          <button
                            type="button"
                            className="linkish"
                            onClick={() => setTab("health")}
                          >
                            另有 {detail.health.issues.length - 5} 条，去健康页
                          </button>
                        )}
                      </section>
                    )}

                  {!!detail.twins.length && (
                    <section className="detail-section">
                      <div className="detail-section-head">
                        <h3>副本 · {detail.twins.length}</h3>
                      </div>
                      <ul className="twin-list">
                        {detail.twins.map((t) => {
                          const same =
                            t.contentHash === detail.skill.contentHash;
                          return (
                            <li key={t.id} className="twin-card">
                              <button
                                type="button"
                                className="twin-card-main linkish"
                                onClick={() => setActiveId(t.id)}
                              >
                                <strong>
                                  {t.runtime}
                                  <span className={same ? "ok" : "warn"}>
                                    {same ? "一致" : "有差异"}
                                  </span>
                                </strong>
                                <span className="muted tiny">{t.sourceId}</span>
                              </button>
                              <div className="twin-card-actions">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      const d = await api.diffTwins(
                                        detail.skill.id,
                                        t.id,
                                      );
                                      setTwinDiff(d);
                                      if (d.identical) {
                                        setStatus("两份 SKILL.md 内容一致");
                                      }
                                    } catch (e) {
                                      setStatus(String(e));
                                    }
                                  }}
                                >
                                  diff
                                </button>
                                {t.access !== "readonly" && !same && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await api.syncTwin(
                                        detail.skill.id,
                                        t.id,
                                      );
                                      await refreshCatalog();
                                      setActiveId(detail.skill.id);
                                      setTwinDiff(null);
                                      setStatus("已同步副本");
                                    }}
                                  >
                                    同步
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  )}

                  {!!detail.scriptRisks?.length && (
                    <section className="detail-section">
                      <div className="detail-section-head">
                        <h3>脚本风险 · {detail.scriptRisks.length}</h3>
                      </div>
                      <ul className="issue-list compact">
                        {detail.scriptRisks.map((r, i) => (
                          <li key={i} className={`sev-${r.severity}`}>
                            <div className="issue-main">
                              <span className={`sev-tag ${r.severity}`}>
                                {r.severity}
                              </span>
                              <code>{r.ruleId}</code>
                              <span className="issue-msg">
                                {r.file}:{r.line} · {r.message}
                              </span>
                            </div>
                            <pre className="risk-snippet">{r.snippet}</pre>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  <section className="detail-section">
                    <div className="detail-section-head">
                      <h3>附属文件 · {detail.files.length}</h3>
                    </div>
                    {detail.files.length === 0 ? (
                      <p className="muted tiny">无附属文件</p>
                    ) : (
                      <div className="file-chips">
                        {detail.files.map((f) => (
                          <code key={f} title={f}>
                            {f}
                          </code>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="detail-section body-section">
                    <div className="detail-section-head">
                      <h3>正文</h3>
                    </div>
                    {detail.outline.length > 0 && (
                      <details className="outline-details">
                        <summary>大纲（{detail.outline.length}）</summary>
                        <div className="outline">
                          {detail.outline.map((h, i) => (
                            <div key={i} className={`lv-${h.level}`}>
                              {h.text}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                    {showSource ? (
                      <pre className="source">
                        {detail.frontmatterRaw
                          ? `---\n${detail.frontmatterRaw}\n---\n\n`
                          : ""}
                        {detail.bodyMarkdown}
                      </pre>
                    ) : (
                      <div className="md">
                        <ReactMarkdown>{detail.bodyMarkdown}</ReactMarkdown>
                      </div>
                    )}
                  </section>

                  {!!detail.contentHistory?.length && (
                    <section className="detail-section">
                      <details className="history-details">
                        <summary>
                          变更历史（{detail.contentHistory.length}）
                        </summary>
                        <ul className="history-list">
                          {detail.contentHistory.map((h) => (
                            <li key={h.id}>
                              <time>
                                {new Date(h.ts).toLocaleString()}
                              </time>
                              <span>{h.event}</span>
                              <code>{h.contentHash.slice(0, 10)}…</code>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </section>
                  )}
                </div>
              )}
            </div>

            <div className="inspector-footer">
              <section
                className={
                  "target-slot" + (dropActive ? " drop-active" : "")
                }
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("application/ssm-skills")) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                    setDropActive(true);
                  }
                }}
                onDragLeave={() => setDropActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropActive(false);
                  try {
                    const raw =
                      e.dataTransfer.getData("application/ssm-skills");
                    const ids = JSON.parse(raw || "[]") as string[];
                    void buildPreviewFromIds(ids);
                  } catch (err) {
                    setStatus(String(err));
                  }
                }}
              >
                <div className="detail-section-head">
                  <h3>目标项目</h3>
                </div>
                <p className="drop-hint">拖入 skill 生成复制预览</p>
                <p className="path" title={settings?.targetProject || undefined}>
                  {settings?.targetProject || "未选择"}
                </p>
                <div className="row-actions">
                  <button type="button" onClick={pickProject}>
                    选择项目
                  </button>
                  <button type="button" onClick={runWizard}>
                    就绪向导
                  </button>
                </div>
                <div className="chip-row">
                  {["agents", "claude", "cursor"].map((rt) => (
                    <button
                      key={rt}
                      type="button"
                      className={
                        settings?.writeRuntimes.includes(rt)
                          ? "chip active"
                          : "chip"
                      }
                      onClick={() => toggleWriteRuntime(rt)}
                    >
                      {rt}
                    </button>
                  ))}
                </div>
                <label className="check policy-row">
                  <span>冲突</span>
                  <select
                    value={settings?.conflictPolicy || "overwrite"}
                    onChange={async (e) => {
                      if (!settings) return;
                      setSettings(
                        await api.updateSettings({
                          ...settings,
                          conflictPolicy: e.target.value,
                        }),
                      );
                    }}
                  >
                    <option value="overwrite">覆盖</option>
                    <option value="skip">跳过</option>
                    <option value="rename">重命名</option>
                  </select>
                </label>
              </section>

              {preview && (
                <section className="preview">
                  <div className="detail-section-head">
                    <h3>操作预览 · {preview.items.length}</h3>
                  </div>
                  <ul>
                    {preview.items.map((it, i) => (
                      <li key={i}>
                        <code>{it.action}</code>
                        <span title={it.targetPath}>{it.targetPath}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="primary"
                      onClick={runCopy}
                    >
                      执行
                    </button>
                    <button type="button" onClick={() => setPreview(null)}>
                      取消
                    </button>
                  </div>
                </section>
              )}
            </div>
          </aside>
        </div>
      )}

      {tab === "bundles" && (
        <div className="page">
          <h2>组合包</h2>
          <div className="bundle-grid">
            {bundles.map((b) => (
              <article key={b.id} className="bundle-card">
                <h3>{b.name}</h3>
                <p>{b.description || `${b.items.length} 个 skill`}</p>
                <p className="muted">
                  写入: {b.defaultRuntimes.join(", ")}
                </p>
                <div className="row-actions">
                  <button className="primary" onClick={() => applyBundle(b.id)}>
                    应用到目标项目
                  </button>
                  <button
                    onClick={async () => {
                      const json = await api.exportBundle(b.id);
                      await navigator.clipboard.writeText(json);
                      setStatus("已复制 Bundle JSON");
                    }}
                  >
                    导出
                  </button>
                  <button
                    className="danger"
                    onClick={async () => {
                      if (confirm(`删除 Bundle「${b.name}」？`)) {
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
            <h3>导入 Bundle JSON</h3>
            <textarea
              id="bundle-import"
              rows={6}
              placeholder='粘贴 Bundle JSON…'
            />
            <button
              onClick={async () => {
                const el = document.getElementById(
                  "bundle-import",
                ) as HTMLTextAreaElement;
                await api.importBundle(el.value);
                el.value = "";
                await refreshCatalog();
                setStatus("Bundle 已导入");
              }}
            >
              导入
            </button>
          </section>
        </div>
      )}

      {tab === "health" && (
        <div className="page health-page">
          <div className="catalog-toolbar" style={{ marginBottom: "1rem" }}>
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
                  const n = await api.runHealthScan();
                  await refreshCatalog();
                  setStatus(`健康检查完成：${n}`);
                }}
              >
                重新检查全部
              </button>
            </div>
          </div>

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
                              .catch((err) => setStatus(String(err)));
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
                          <h4>skills.sh / Registry 对照</h4>
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
                                    `可在 Registry 页对「${displayName}」执行 update`,
                                  );
                                }}
                              >
                                前往 Registry 更新
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
                            setActiveId(r.skillId);
                            setTab("library");
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
            <p className="muted">暂无报告。请先「重新扫描」或点上方检查。</p>
          )}
        </div>
      )}

      {tab === "wizard" && (
        <div className="page">
          <h2>项目就绪向导</h2>
          <p className="muted">
            目标：{settings?.targetProject || "未选择"}
          </p>
          <div className="row-actions" style={{ marginBottom: "1rem" }}>
            <button className="primary" onClick={runWizard}>
              分析目标项目
            </button>
            <button onClick={pickProject}>更换项目</button>
          </div>
          {profile && (
            <>
              <p>
                检测到技术栈：{" "}
                {profile.stacks.length
                  ? profile.stacks.join(", ")
                  : "未识别（将给通用建议）"}
              </p>
              <div className="bundle-grid">
                {profile.recommendations.map((rec) => (
                  <article key={rec.title} className="bundle-card">
                    <h3>{rec.title}</h3>
                    <p>{rec.reason}</p>
                    <p className="muted">
                      匹配：{rec.skillNames.join(", ") || "无"}
                    </p>
                    {!!rec.missingNames.length && (
                      <p className="muted">
                        缺失：{rec.missingNames.join(", ")}
                      </p>
                    )}
                    <div className="row-actions">
                      <button
                        className="primary"
                        disabled={!rec.matchedSkillIds.length}
                        onClick={async () => {
                          const b = await api.createBundleFromRecommendation(
                            rec.title,
                            rec.matchedSkillIds,
                          );
                          await refreshCatalog();
                          setStatus(`已创建 Bundle「${b.name}」`);
                          setTab("bundles");
                        }}
                      >
                        生成 Bundle
                      </button>
                      <button
                        disabled={
                          !rec.matchedSkillIds.length ||
                          !settings?.targetProject
                        }
                        onClick={async () => {
                          const b = await api.createBundleFromRecommendation(
                            rec.title,
                            rec.matchedSkillIds,
                          );
                          const policy =
                            settings!.conflictPolicy === "prompt"
                              ? "overwrite"
                              : settings!.conflictPolicy;
                          await api.applyBundle(
                            b.id,
                            settings!.targetProject!,
                            null,
                            policy,
                          );
                          await refreshCatalog();
                          setStatus(`已应用「${rec.title}」到目标项目`);
                        }}
                      >
                        一键应用到项目
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "registry" && (
        <div className="page">
          <h2>skills.sh / npx skills</h2>
          <p className="muted">
            封装本地 <code>npx skills</code>。安装默认 --copy -y。
          </p>
          <section className="import-box">
            <h3>搜索</h3>
            <div className="row-actions">
              <input
                style={{ flex: 1 }}
                value={regQuery}
                onChange={(e) => setRegQuery(e.target.value)}
                placeholder="关键词，如 frontend / typescript"
              />
              <button
                disabled={regBusy}
                onClick={() => runRegistry(() => api.registryFind(regQuery))}
              >
                find
              </button>
              <button
                disabled={regBusy}
                onClick={() => runRegistry(() => api.registryList(true))}
              >
                list -g
              </button>
              <button
                disabled={regBusy}
                onClick={() => runRegistry(() => api.registryUpdate(true))}
              >
                update -g
              </button>
            </div>
          </section>
          <section className="import-box" style={{ marginTop: "0.8rem" }}>
            <h3>安装 / 移除</h3>
            <div className="row-actions">
              <input
                style={{ flex: 1 }}
                value={regPackage}
                onChange={(e) => setRegPackage(e.target.value)}
                placeholder="owner/repo 或 skill 名"
              />
              <button
                className="primary"
                disabled={regBusy || !regPackage.trim()}
                onClick={() =>
                  runRegistry(() =>
                    api.registryAdd(
                      regPackage.trim(),
                      true,
                      ["claude-code", "cursor"],
                      null,
                    ),
                  )
                }
              >
                add -g
              </button>
              <button
                className="danger"
                disabled={regBusy || !regPackage.trim()}
                onClick={() => {
                  if (
                    !confirm(
                      `确认执行 npx skills remove「${regPackage.trim()}」(-g)？`,
                    )
                  ) {
                    return;
                  }
                  void runRegistry(() =>
                    api.registryRemove(regPackage.trim(), true),
                  );
                }}
              >
                remove -g
              </button>
            </div>
          </section>
          <pre className="source" style={{ marginTop: "1rem", maxHeight: 420 }}>
            {regOutput || "命令输出将显示在这里…"}
          </pre>
        </div>
      )}

      {tab === "settings" && (
        <div className="page">
          <h2>设置 · 策略模板</h2>
          <p className="muted">
            当前模板：{settings?.policyTemplateId || "balanced"} · 冲突策略：
            {settings?.conflictPolicy}
            {settings?.blockPluginCopyToProject ? " · 禁止插件直拷项目" : ""}
          </p>
          <div className="bundle-grid">
            {policyTemplates.map((t) => (
              <article key={t.id} className="bundle-card">
                <h3>{t.name}</h3>
                <p>{t.description}</p>
                <p className="muted">
                  conflict={t.conflictPolicy}
                  {t.blockPluginCopyToProject ? " · block plugin" : ""}
                </p>
                <button
                  className="primary"
                  onClick={async () => {
                    const s = await api.applyPolicyTemplate(t.id);
                    setSettings(s);
                    setStatus(`已应用策略「${t.name}」`);
                  }}
                >
                  应用此模板
                </button>
              </article>
            ))}
          </div>

          <section className="import-box" style={{ marginTop: "1rem" }}>
            <h3>导入 Skill ZIP</h3>
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
                setStatus(`导入完成: ${entry.status}（${entry.targets.length}）`);
              }}
            />
          </section>
        </div>
      )}

      {tab === "sources" && (
        <div className="page">
          <h2>源与项目</h2>
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
          </section>
          <section>
            <h3>扫描源</h3>
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
                      {s.runtime} · {s.scope} · {s.skillCount} skills
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
      )}

      {tab === "oplog" && (
        <div className="page">
          <h2>操作日志</h2>
          <table className="log-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作</th>
                <th>状态</th>
                <th>目标数</th>
              </tr>
            </thead>
            <tbody>
              {oplog.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.ts).toLocaleString()}</td>
                  <td>{e.op}</td>
                  <td>{e.status}</td>
                  <td>{e.targets.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <a
        className="deerflow-badge"
        href="https://deerflow.tech"
        target="_blank"
        rel="noreferrer"
        title="Created By Deerflow"
      >
        ✦ <span>Deerflow</span>
      </a>

      {twinDiff && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="副本 diff"
          onClick={() => setTwinDiff(null)}
        >
          <div
            className="modal-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-head">
              <div>
                <h3>副本 SKILL.md diff</h3>
                <p className="muted">
                  {twinDiff.identical
                    ? "内容一致"
                    : `${twinDiff.leftLabel} → ${twinDiff.rightLabel}`}
                </p>
              </div>
              <button type="button" onClick={() => setTwinDiff(null)}>
                关闭
              </button>
            </header>
            {twinDiff.identical ? (
              <p className="pad muted">两份文件逐行相同，无需同步。</p>
            ) : (
              <pre className="diff-view modal-diff">{twinDiff.diff}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
