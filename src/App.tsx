import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import ReactMarkdown from "react-markdown";
import { api } from "./api";
import type {
  AppSettings,
  Bundle,
  CopyPreview,
  OpLogEntry,
  ProjectRoot,
  SkillDetail,
  SkillRecord,
  SourceInfo,
} from "./types";
import "./App.css";

type Tab = "library" | "bundles" | "sources" | "oplog";

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [preview, setPreview] = useState<CopyPreview | null>(null);
  const [status, setStatus] = useState("");
  const [scanning, setScanning] = useState(false);
  const [bundleName, setBundleName] = useState("");

  const refreshCatalog = useCallback(async () => {
    const filter = {
      query: query || null,
      runtimes: runtimeFilter.length ? runtimeFilter : null,
      twinsOnly,
    };
    const [sk, src, b, p, s, log] = await Promise.all([
      api.listSkills(filter),
      api.listSources(),
      api.listBundles(),
      api.listProjects(),
      api.getSettings(),
      api.listOplog(30),
    ]);
    setSkills(sk);
    setSources(src);
    setBundles(b);
    setProjects(p);
    setSettings(s);
    setOplog(log);
  }, [query, runtimeFilter, twinsOnly]);

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
      await refreshCatalog();
      setStatus(`扫描完成，索引 ${n} 个 skill 目录`);
    } catch (e) {
      setStatus(String(e));
    } finally {
      setScanning(false);
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

  async function buildPreview() {
    if (!settings?.targetProject) {
      setStatus("请先选择目标项目");
      return;
    }
    const ids = [...selectedIds];
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
              ["sources", "源与项目"],
              ["oplog", "操作日志"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              className={tab === k ? "active" : ""}
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

      {status && <div className="status-bar">{status}</div>}

      {tab === "library" && (
        <div className="workspace">
          <aside className="rail">
            <label className="search">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索 name / description…"
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
            </section>
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
                <button className="danger" onClick={runDelete}>
                  删除
                </button>
              </div>
            </div>
            <div className="card-grid">
              {skills.map((s) => (
                <article
                  key={s.id}
                  className={
                    "skill-card" +
                    (activeId === s.id ? " active" : "") +
                    (selectedIds.has(s.id) ? " selected" : "")
                  }
                  onClick={(e) => toggleSelect(s.id, e.ctrlKey || e.metaKey)}
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
                    </div>
                  </header>
                  <p>{s.description || "（无 description）"}</p>
                  <footer>{s.sourceId}</footer>
                </article>
              ))}
              {!skills.length && (
                <div className="empty">
                  暂无 skill。点击「重新扫描」，或在「源与项目」中登记项目根。
                </div>
              )}
            </div>
          </main>

          <aside className="inspector">
            {!detail ? (
              <div className="empty pad">选择一个 skill 查看详情</div>
            ) : (
              <>
                <div className="detail-head">
                  <h2>{detail.skill.name}</h2>
                  <p className="path" title={detail.skill.dirPath}>
                    {detail.skill.dirPath}
                  </p>
                  <div className="badges">
                    <span>{detail.skill.runtime}</span>
                    <span>{detail.skill.origin}</span>
                    <span>{detail.skill.access}</span>
                  </div>
                  <div className="row-actions">
                    <button
                      onClick={() => api.reveal(detail.skill.dirPath)}
                    >
                      打开目录
                    </button>
                    {detail.skill.access === "readonly" && (
                      <button onClick={runExtract}>提取为自有副本</button>
                    )}
                    <button onClick={() => setShowSource((v) => !v)}>
                      {showSource ? "友好视图" : "查看源码"}
                    </button>
                  </div>
                </div>

                <section>
                  <h3>用途 / 触发</h3>
                  <p className="desc">{detail.skill.description}</p>
                </section>

                {!!detail.twins.length && (
                  <section>
                    <h3>副本</h3>
                    <ul className="plain-list">
                      {detail.twins.map((t) => (
                        <li key={t.id}>
                          <div className="twin-row">
                            <button
                              className="linkish"
                              onClick={() => setActiveId(t.id)}
                            >
                              {t.runtime} · {t.sourceId}
                              {t.contentHash === detail.skill.contentHash
                                ? " · 一致"
                                : " · 有差异"}
                            </button>
                            {t.access !== "readonly" &&
                              t.contentHash !== detail.skill.contentHash && (
                                <button
                                  onClick={async () => {
                                    await api.syncTwin(detail.skill.id, t.id);
                                    await refreshCatalog();
                                    setActiveId(detail.skill.id);
                                    setStatus("已同步副本");
                                  }}
                                >
                                  以当前为准同步
                                </button>
                              )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section>
                  <h3>附属文件</h3>
                  <ul className="files">
                    {detail.files.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </section>

                <section className="body">
                  <h3>正文</h3>
                  {detail.outline.length > 0 && (
                    <div className="outline">
                      {detail.outline.map((h, i) => (
                        <div key={i} className={`lv-${h.level}`}>
                          {h.text}
                        </div>
                      ))}
                    </div>
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

                <section className="target-slot">
                  <h3>目标项目</h3>
                  <p className="path">
                    {settings?.targetProject || "未选择"}
                  </p>
                  <button onClick={pickProject}>选择 / 更换项目</button>
                  <div className="chip-row">
                    {["agents", "claude", "cursor"].map((rt) => (
                      <button
                        key={rt}
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
                  <label className="check">
                    冲突策略
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
                    <h3>操作预览</h3>
                    <ul>
                      {preview.items.map((it, i) => (
                        <li key={i}>
                          <code>{it.action}</code> → {it.targetPath}
                        </li>
                      ))}
                    </ul>
                    <div className="row-actions">
                      <button className="primary" onClick={runCopy}>
                        执行
                      </button>
                      <button onClick={() => setPreview(null)}>取消</button>
                    </div>
                  </section>
                )}
              </>
            )}
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
    </div>
  );
}
