import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import ReactMarkdown from "react-markdown";
import { api } from "./api";
import { CONFLICT_LABELS } from "./conflict";
import ProjectSetup from "./ProjectSetup";
import type {
  AppSettings,
  Bundle,
  CopyPreview,
  HealthReport,
  OpLogEntry,
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

const RUNTIME_LABELS: Record<string, string> = {
  cursor: "Cursor",
  claude: "Claude",
  agents: "Agents",
  codex: "Codex",
  plugin: "插件",
};

/** 悬停说明：复杂概念用短句解释，避免界面堆砌术语 */
function HelpTip({ text }: { text: string }) {
  return (
    <span className="help-tip" title={text} tabIndex={0} aria-label={text}>
      ?
    </span>
  );
}

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
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [multiSelect, setMultiSelect] = useState(false);
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
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
  const [regQuery, setRegQuery] = useState("");
  const [regPackage, setRegPackage] = useState("vercel-labs/agent-skills");
  const [regOutput, setRegOutput] = useState("");
  const [regBusy, setRegBusy] = useState(false);
  const [expandedHealthIds, setExpandedHealthIds] = useState<Set<string>>(
    new Set(),
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const detailBodyRef = useRef<HTMLDivElement>(null);

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
        if (detailOpen) {
          setDetailOpen(false);
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
  }, [status, twinDiff, detailOpen, tab, selectedIds]);

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
    setShowSource(false);
    let cancelled = false;
    api.getSkillDetail(activeId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        requestAnimationFrame(() => {
          if (detailBodyRef.current) {
            detailBodyRef.current.scrollTop = 0;
          }
        });
      })
      .catch((e) => {
        if (!cancelled) setStatus(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    if (detailOpen && detailBodyRef.current) {
      detailBodyRef.current.scrollTop = 0;
    }
  }, [detailOpen, activeId]);

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

  function openProjectSetup() {
    setTab("wizard");
    if (!settings?.targetProject) {
      setStatus("可在「新建项目」页选择目录，并一键搭建技能目录");
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
      setStatus(r.ok ? "在线安装命令已完成" : "命令失败，请查看下方输出");
      if (r.ok) await handleScan();
    } catch (e) {
      setStatus(String(e));
      setRegOutput(String(e));
    } finally {
      setRegBusy(false);
    }
  }

  /** 需要交互的 skills CLI：打开系统终端，预执行基础命令 */
  async function openSkillsCli(
    action: "find" | "add" | "update" | "remove" | "list",
    opts: {
      packageOrQuery?: string;
      global?: boolean;
      project?: string | null;
    } = {},
  ) {
    try {
      const msg = await api.openSkillsTerminal({
        action,
        packageOrQuery: opts.packageOrQuery ?? null,
        global: opts.global ?? true,
        project: opts.project ?? null,
      });
      setRegOutput(
        `${msg}\n\n请在弹出的终端里按提示选择选项。完成后回到本应用，点右上角「重新扫描」。`,
      );
      setStatus("已打开交互终端 — 完成后请重新扫描");
    } catch (e) {
      setStatus(String(e));
      setRegOutput(String(e));
    }
  }

  function openSkill(id: string) {
    setActiveId(id);
    setDetailOpen(true);
  }

  function closeDetail() {
    setDetailOpen(false);
  }

  function toggleSelect(
    id: string,
    opts: { multi?: boolean; range?: boolean } = {},
  ) {
    const multi = !!opts.multi || multiSelect;
    const range = !!opts.range;

    setActiveId(id);

    if (range && lastClickedId) {
      const a = skills.findIndex((s) => s.id === lastClickedId);
      const b = skills.findIndex((s) => s.id === id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const rangeIds = skills.slice(lo, hi + 1).map((s) => s.id);
        setSelectedIds((prev) => {
          const next = multi ? new Set(prev) : new Set<string>();
          for (const rid of rangeIds) next.add(rid);
          return next;
        });
        setLastClickedId(id);
        return;
      }
    }

    setSelectedIds((prev) => {
      const next = multi ? new Set(prev) : new Set<string>();
      if (multi && next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastClickedId(id);

    // 普通单击打开详情；多选 / Ctrl / Shift 只勾选
    if (!multi && !range) {
      setDetailOpen(true);
    }
  }

  function selectAllVisible() {
    setSelectedIds(new Set(skills.map((s) => s.id)));
    if (skills.length) setActiveId(skills[0].id);
  }

  function clearSelection() {
    setSelectedIds(new Set());
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
      settings.conflictPolicy,
    );
    setPreview(p);
    setStatus(
      p.items.some((i) => i.action === "prompt")
        ? `已生成预览：${p.items.length} 项（含冲突，请逐项选择）`
        : `已生成复制预览：${p.items.length} 项`,
    );
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
    if (preview.items.some((i) => i.action === "prompt")) {
      setStatus("请先为每个冲突项选择：覆盖 / 跳过 / 改名");
      return;
    }
    const entry = await api.executeCopy(preview, settings.conflictPolicy);
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
      setStatus("请先勾选技能，并填写组合包名称");
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
    setStatus("组合包已创建");
    setTab("bundles");
  }

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
      await buildPreviewFromIds(ids);
      setTab("library");
      setStatus(
        "冲突策略为「询问」：已生成预览，请在目标项目条逐项确认后再复制",
      );
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
            <p>浏览、检查、打包，一键放到项目里</p>
          </div>
        </div>
        <nav className="tabs" aria-label="主导航">
          {(
            [
              ["library", "技能库", "浏览与复制技能"],
              ["bundles", "组合包", "把常用技能打成一组"],
              ["health", "健康检查", "检查描述与结构问题"],
              ["wizard", "新建项目", "选目录、装技能、健康检查一页完成"],
              ["registry", "在线安装", "从 skills.sh 搜索安装"],
              ["settings", "设置", "冲突策略与导入"],
              ["sources", "来源与项目", "扫描哪些目录、登记项目"],
              ["oplog", "操作记录", "复制与删除历史"],
            ] as const
          ).map(([k, label, tip]) => (
            <button
              key={k}
              type="button"
              className={tab === k ? "active" : ""}
              aria-current={tab === k ? "page" : undefined}
              title={tip}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <button
            disabled={scanning}
            onClick={handleScan}
            title="重新扫描本机技能目录，并刷新健康检查"
          >
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
                placeholder="搜索名称或说明…  (/)"
                aria-label="搜索技能"
              />
            </label>
            <section>
              <h3>
                适用工具{" "}
                <HelpTip text="按 Cursor、Claude 等工具筛选。可多选；不选表示全部。" />
              </h3>
              <div className="chip-row">
                {RUNTIMES.map((rt) => (
                  <button
                    key={rt}
                    type="button"
                    className={
                      runtimeFilter.includes(rt) ? "chip active" : "chip"
                    }
                    title={RUNTIME_LABELS[rt] || rt}
                    onClick={() => toggleRuntimeFilter(rt)}
                  >
                    {RUNTIME_LABELS[rt] || rt}
                  </button>
                ))}
              </div>
            </section>
            <section>
              <label
                className="check"
                title="同一技能出现在多个目录时会显示「副本」"
              >
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
                        onClick={() => openSkill(s.id)}
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
                        onClick={() => openSkill(s.id)}
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
              <h3>
                组合包{" "}
                <HelpTip text="把多个技能打成一组，新建项目时可一键安装。" />
              </h3>
              <ul className="plain-list">
                {bundles.map((b) => (
                  <li key={b.id}>
                    <button className="linkish" onClick={() => setTab("bundles")}>
                      {b.name}
                      <span>{b.items.length}</span>
                    </button>
                  </li>
                ))}
                {!bundles.length && (
                  <li className="muted">还没有组合包，可在下方创建</li>
                )}
              </ul>
            </section>
            <section>
              <h3>新建组合包</h3>
              <p className="hint">先勾选中间的技能，再填写名称。</p>
              <input
                value={bundleName}
                onChange={(e) => setBundleName(e.target.value)}
                placeholder="例如：前端日常"
              />
              <button className="primary block" onClick={createBundle}>
                用已选技能创建
              </button>
            </section>
          </aside>

          <main className="catalog">
            <div className="catalog-toolbar">
              <div className="toolbar-summary">
                <span>
                  {skills.length} 个技能
                  {selectedIds.size ? ` · 已选 ${selectedIds.size}` : ""}
                </span>
                <span className="hint toolbar-hint">
                  单击打开详情 · 拖到下方「目标项目」可复制
                </span>
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  className={multiSelect ? "active-toggle" : ""}
                  title="开启后：单击只勾选、不打开详情。也可用 Ctrl/⌘ 或 Shift 多选。"
                  onClick={() => setMultiSelect((v) => !v)}
                >
                  {multiSelect ? "退出多选" : "多选"}
                </button>
                <button
                  type="button"
                  disabled={!skills.length}
                  onClick={selectAllVisible}
                >
                  全选
                </button>
                <button
                  type="button"
                  disabled={!selectedIds.size}
                  onClick={clearSelection}
                >
                  清除选择
                </button>
                <button
                  type="button"
                  onClick={buildPreview}
                  title="把已选技能复制到下方目标项目（先预览再确认）"
                >
                  复制到项目
                </button>
                <button
                  type="button"
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
                  type="button"
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
                <button type="button" className="danger" onClick={runDelete}>
                  删除
                </button>
              </div>
            </div>
            <section
              className={
                "target-dock" + (dropActive ? " drop-active" : "")
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
              <div className="target-dock-drop">
                <div className="target-dock-label">
                  <h3>
                    目标项目{" "}
                    <HelpTip text="要把技能复制到哪个项目文件夹。可从这里选择，或在「来源与项目」里登记。" />
                  </h3>
                  <span className="drop-hint">把技能卡片拖到这里</span>
                </div>
                <p
                  className="path target-path"
                  title={settings?.targetProject || undefined}
                >
                  {settings?.targetProject || "还没有选择项目 — 请点「选择项目」"}
                </p>
                <div className="row-actions">
                  <button type="button" onClick={pickProject}>
                    选择项目
                  </button>
                  <button
                    type="button"
                    onClick={openProjectSetup}
                    title="打开新建项目页：创建目录、挑选/安装技能、健康检查"
                  >
                    新建项目
                  </button>
                </div>
              </div>
              <div className="target-dock-meta">
                <div>
                  <span className="field-label">
                    复制到哪些工具{" "}
                    <HelpTip text="技能会写入对应工具的目录，例如 Cursor、Claude。可多选。" />
                  </span>
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
                        {RUNTIME_LABELS[rt] || rt}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="check policy-row">
                  <span className="field-label">
                    文件已存在时{" "}
                    <HelpTip text="目标里已有同名技能时怎么处理：覆盖、跳过、另存，或逐项询问。" />
                  </span>
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
                    <option value="overwrite">
                      {CONFLICT_LABELS.overwrite}
                    </option>
                    <option value="skip">{CONFLICT_LABELS.skip}</option>
                    <option value="rename">{CONFLICT_LABELS.rename}</option>
                    <option value="prompt">{CONFLICT_LABELS.prompt}</option>
                  </select>
                </label>
              </div>
              {preview && (
                <section className="target-dock-preview">
                  <div className="detail-section-head">
                    <h3>即将复制 · {preview.items.length} 项</h3>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={runCopy}
                        disabled={preview.items.some(
                          (i) => i.action === "prompt",
                        )}
                        title={
                          preview.items.some((i) => i.action === "prompt")
                            ? "请先为冲突项选择处理方式"
                            : undefined
                        }
                      >
                        确认复制
                      </button>
                      <button type="button" onClick={() => setPreview(null)}>
                        取消
                      </button>
                    </div>
                  </div>
                  <ul>
                    {preview.items.map((it, i) => (
                      <li
                        key={i}
                        className={
                          it.action === "prompt" ? "preview-prompt" : undefined
                        }
                      >
                        {it.action === "prompt" ? (
                          <select
                            aria-label={`冲突处理：${it.skillName}`}
                            defaultValue=""
                            onChange={(e) => {
                              const action = e.target.value;
                              if (!action) return;
                              setPreview({
                                items: preview.items.map((x, j) =>
                                  j === i ? { ...x, action } : x,
                                ),
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
                        <span title={it.targetPath}>{it.targetPath}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </section>

            <div className={"card-grid" + (multiSelect ? " multi-mode" : "")}>
              {skills.map((s) => (
                <article
                  key={s.id}
                  draggable
                  className={
                    "skill-card" +
                    (activeId === s.id && detailOpen ? " active" : "") +
                    (selectedIds.has(s.id) ? " selected" : "")
                  }
                  onClick={(e) =>
                    toggleSelect(s.id, {
                      multi: e.ctrlKey || e.metaKey || multiSelect,
                      range: e.shiftKey,
                    })
                  }
                  onDragStart={(e) => {
                    const ids =
                      selectedIds.has(s.id) && selectedIds.size
                        ? [...selectedIds]
                        : [s.id];
                    if (!selectedIds.has(s.id)) {
                      setSelectedIds(new Set([s.id]));
                      setActiveId(s.id);
                      setLastClickedId(s.id);
                    }
                    e.dataTransfer.setData(
                      "application/ssm-skills",
                      JSON.stringify(ids),
                    );
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                >
                  <label
                    className="card-check"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={() =>
                        toggleSelect(s.id, { multi: true })
                      }
                      aria-label={`选择 ${s.name}`}
                    />
                  </label>
                  <header>
                    <h4>{s.name}</h4>
                    <div className="badges">
                      <span>{s.runtime}</span>
                      <span>{s.scope}</span>
                      {s.access === "readonly" && (
                        <span className="ro" title="只读来源，不能直接改；可提取为自己的副本">
                          只读
                        </span>
                      )}
                      {s.hasScripts && (
                        <span title="包含脚本文件">有脚本</span>
                      )}
                      {s.twinGroupId && (
                        <span className="twin" title="同名技能出现在多个位置">
                          副本
                        </span>
                      )}
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
                    <strong>还没有找到技能</strong>
                    <p className="muted" style={{ margin: "0.4rem 0 0" }}>
                      先点右上角 <strong>重新扫描</strong>。
                      若仍为空，到「来源与项目」确认扫描目录，或到「在线安装」安装技能。
                    </p>
                    <p className="hint" style={{ margin: "0.55rem 0 0" }}>
                      日常用法：单击卡片看详情 · 拖到上方「目标项目」复制 ·{" "}
                      <kbd>/</kbd> 搜索
                    </p>
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>
      )}

      {detailOpen && (
        <div
          className="detail-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Skill 详情"
          onClick={closeDetail}
        >
          <div
            className="detail-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            {!detail ? (
              <div className="detail-sheet-loading">加载中…</div>
            ) : (
              <>
                <header className="detail-sheet-head">
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
                        <button
                          type="button"
                          onClick={runExtract}
                          title="复制一份到本机可写目录，之后可自由修改"
                        >
                          提取为自己的副本
                        </button>
                      )}
                      <button
                        type="button"
                        className={showSource ? "active-toggle" : ""}
                        onClick={() => setShowSource((v) => !v)}
                        title="在排版阅读与原始 Markdown 之间切换"
                      >
                        {showSource ? "排版阅读" : "查看原文"}
                      </button>
                      <button
                        type="button"
                        className="detail-close"
                        onClick={closeDetail}
                        aria-label="关闭详情"
                      >
                        关闭
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
                      <span
                        className="ro"
                        title="来自插件或只读目录；可用「提取副本」保存一份自己可改的"
                      >
                        只读
                      </span>
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

                <div className="detail-sheet-body" ref={detailBodyRef}>
                  <div className="detail">
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
                              onClick={() => {
                                closeDetail();
                                setTab("health");
                              }}
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
                              onClick={() => {
                                closeDetail();
                                setTab("health");
                              }}
                            >
                              另有 {detail.health.issues.length - 5} 条，去健康页
                            </button>
                          )}
                        </section>
                      )}

                    {!!detail.twins.length && (
                      <section className="detail-section">
                        <div className="detail-section-head">
                          <h3>
                            副本 · {detail.twins.length}{" "}
                            <HelpTip text="同一技能在多个目录各有一份。可对比差异，或把当前这份同步到其他位置。" />
                          </h3>
                        </div>
                        <p className="hint">
                          「diff」查看差异；「同步」用当前这份覆盖另一份（只读位置除外）。
                        </p>
                        <ul className="twin-list">
                          {detail.twins.map((t) => {
                            const same =
                              t.contentHash === detail.skill.contentHash;
                            return (
                              <li key={t.id} className="twin-card">
                                <button
                                  type="button"
                                  className="twin-card-main linkish"
                                  onClick={() => openSkill(t.id)}
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
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "bundles" && (
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
      )}

      {tab === "health" && (
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
                  const n = await api.runHealthScan();
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
                            setTab("library");
                            openSkill(r.skillId);
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
      )}

      {tab === "wizard" && (
        <ProjectSetup
          settings={settings}
          skills={skills}
          onSettings={setSettings}
          onStatus={setStatus}
          onRefresh={refreshCatalog}
        />
      )}

      {tab === "registry" && (
        <div className="page">
          <h2>在线安装</h2>
          <p className="page-lead">
            搜索、安装、更新、移除会打开系统终端，并自动执行基础{" "}
            <code>npx skills</code>{" "}
            命令；需要选技能 / 目标工具时，请在终端里按提示操作。
          </p>
          <p className="hint">
            需要本机 Node.js。终端操作完成后，请点右上角「重新扫描」刷新技能库。
          </p>
          <section className="import-box">
            <h3>搜索与更新</h3>
            <div className="row-actions">
              <input
                style={{ flex: 1 }}
                value={regQuery}
                onChange={(e) => setRegQuery(e.target.value)}
                placeholder="关键词，如 frontend、typescript（可留空打开交互搜索）"
              />
              <button
                title="打开终端执行 npx skills find …"
                onClick={() =>
                  void openSkillsCli("find", {
                    packageOrQuery: regQuery.trim() || undefined,
                  })
                }
              >
                搜索（终端）
              </button>
              <button
                disabled={regBusy}
                title="在应用内列出全局已安装（无需交互）"
                onClick={() => runRegistry(() => api.registryList(true))}
              >
                已安装列表
              </button>
              <button
                title="打开终端执行 npx skills update -g"
                onClick={() => void openSkillsCli("update", { global: true })}
              >
                全部更新（终端）
              </button>
            </div>
          </section>
          <section className="import-box" style={{ marginTop: "0.8rem" }}>
            <h3>
              安装 / 移除{" "}
              <HelpTip text="会打开终端并执行基础命令（仅包名与全局/项目范围）。copy、技能、目标工具等选项在终端里选。" />
            </h3>
            <div className="row-actions">
              <input
                style={{ flex: 1 }}
                value={regPackage}
                onChange={(e) => setRegPackage(e.target.value)}
                placeholder="例如 vercel-labs/agent-skills"
              />
              <button
                className="primary"
                disabled={!regPackage.trim()}
                title="打开终端：npx skills add <包> -g"
                onClick={() =>
                  void openSkillsCli("add", {
                    packageOrQuery: regPackage.trim(),
                    global: true,
                  })
                }
              >
                安装（终端）
              </button>
              <button
                className="danger"
                title="打开终端执行移除（可留空包名，在终端里选）"
                onClick={() =>
                  void openSkillsCli("remove", {
                    packageOrQuery: regPackage.trim() || undefined,
                    global: true,
                  })
                }
              >
                移除（终端）
              </button>
            </div>
          </section>
          <pre className="source" style={{ marginTop: "1rem", maxHeight: 420 }}>
            {regOutput ||
              "点击上方按钮后，将打开终端并显示已执行的基础命令说明…"}
          </pre>
        </div>
      )}

      {tab === "settings" && (
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
      )}

      {tab === "sources" && (
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
      )}

      {tab === "oplog" && (
        <div className="page">
          <h2>操作记录</h2>
          <p className="page-lead">
            复制、删除、导入等操作的历史，便于核对写到了哪里。
          </p>
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
