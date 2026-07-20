import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api } from "../api";
import { CONFLICT_LABELS } from "../conflict";
import HelpTip from "../components/HelpTip";
import { SkillDecisionBadges } from "../components/SkillDecisionCard";
import { RUNTIMES, RUNTIME_LABELS } from "../constants";
import { useCatalog } from "../context/CatalogContext";
import { errMsg } from "../errMsg";
import { riskSummary } from "../skillFreshness";
import type {
  CopyPreview,
  SkillDecisionBrief,
  SkillDetail,
  TwinDiff,
} from "../types";

/** 技能库：浏览、筛选、多选、拖拽复制、详情、副本 diff/同步 */
export default function LibraryView() {
  const {
    tab,
    setTab,
    skills,
    bundles,
    settings,
    setSettings,
    insights,
    allTags,
    tagFilter,
    setTagFilter,
    query,
    setQuery,
    runtimeFilter,
    toggleRuntimeFilter,
    twinsOnly,
    setTwinsOnly,
    favoritesOnly,
    setFavoritesOnly,
    status,
    setStatus,
    refreshCatalog,
    handleScan,
    pickProject,
    pendingOpenSkillId,
    clearPendingOpenSkill,
    healthReports,
  } = useCatalog();

  const [tagDraft, setTagDraft] = useState("");
  const [twinDiff, setTwinDiff] = useState<TwinDiff | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [multiSelect, setMultiSelect] = useState(false);
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [preview, setPreview] = useState<CopyPreview | null>(null);
  const [bundleName, setBundleName] = useState("");
  const [previewBriefs, setPreviewBriefs] = useState<
    Record<string, SkillDecisionBrief>
  >({});

  const healthById = useMemo(() => {
    const m = new Map(healthReports.map((r) => [r.skillId, r]));
    return m;
  }, [healthReports]);

  // 复制预览出现时，为各项拉决策摘要（含过期对照）
  useEffect(() => {
    if (!preview?.items.length) return;
    let cancelled = false;
    const ids = [...new Set(preview.items.map((i) => i.skillId))];
    (async () => {
      for (const id of ids) {
        if (cancelled) return;
        try {
          const brief = await api.getSkillDecisionBrief(id, true);
          if (cancelled) return;
          setPreviewBriefs((prev) =>
            prev[id] ? prev : { ...prev, [id]: brief },
          );
        } catch {
          /* 单项失败不阻断预览 */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preview]);
  const searchRef = useRef<HTMLInputElement>(null);
  const detailBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tagName = (e.target as HTMLElement)?.tagName;
      const editing =
        tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
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

  useEffect(() => {
    // 仅在详情窗打开时才拉取详情，避免单击选中时无谓请求
    if (!activeId || !detailOpen) {
      if (!activeId) setDetail(null);
      return;
    }
    setShowSource(false);
    let cancelled = false;
    api
      .getSkillDetail(activeId)
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
        if (!cancelled) setStatus(errMsg(e));
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, detailOpen, setStatus]);

  useEffect(() => {
    if (detailOpen && detailBodyRef.current) {
      detailBodyRef.current.scrollTop = 0;
    }
  }, [detailOpen, activeId]);

  useEffect(() => {
    if (!pendingOpenSkillId) return;
    openSkill(pendingOpenSkillId);
    clearPendingOpenSkill();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openSkill 只依赖本地 setter
  }, [pendingOpenSkillId]);

  const twinCount = useMemo(
    () => skills.filter((s) => s.twinGroupId).length,
    [skills],
  );

  function openProjectSetup() {
    setTab("wizard");
    if (!settings?.targetProject) {
      setStatus("可在「新建项目」页选择目录，并一键搭建技能目录");
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

    // 单击只选中（便于紧接着拖拽）；双击才打开详情
  }

  function selectAllVisible() {
    setSelectedIds(new Set(skills.map((s) => s.id)));
    if (skills.length) setActiveId(skills[0].id);
  }

  function clearSelection() {
    setSelectedIds(new Set());
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
    const overwrites = preview.items.filter(
      (i) => i.willOverwrite || i.action === "overwrite",
    );
    if (overwrites.length) {
      const lines = overwrites
        .map((i) => `· ${i.skillName}\n  ${i.targetPath}`)
        .join("\n");
      if (
        !confirm(
          `以下 ${overwrites.length} 项将删除并替换已有目录，确认继续？\n\n${lines}`,
        )
      ) {
        return;
      }
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
      .map((i) => {
        const bundleNames = (i.bundles as string[]) || [];
        const twinNote =
          (i.twinCount as number) > 1
            ? `副本组共 ${i.twinCount} 份（仅删本份）`
            : "无副本";
        const bundleNote = bundleNames.length
          ? `组合包：${bundleNames.join("、")}`
          : "未列入组合包";
        return `· ${i.name} [${i.access}]\n  ${i.path}\n  ${twinNote}；${bundleNote}`;
      })
      .join("\n\n");
    if (
      !confirm(
        `确认删除以下 ${ids.length} 个技能（进回收站）？\n\n${lines || "（无详情）"}`,
      )
    ) {
      return;
    }
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

  async function toggleWriteRuntime(rt: string) {
    if (!settings) return;
    const writeRuntimes = settings.writeRuntimes.includes(rt)
      ? settings.writeRuntimes.filter((x) => x !== rt)
      : [...settings.writeRuntimes, rt];
    const next = { ...settings, writeRuntimes };
    setSettings(await api.updateSettings(next));
  }

  return (
    <>
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
            {insights &&
              (insights.favorites.length > 0 || insights.recent.length > 0) && (
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
                  单击选择 · 双击查看详情 · 拖到下方「目标项目」可复制
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
                  className="primary"
                  onClick={buildPreview}
                  title="把已选技能复制到下方目标项目（先预览再确认）"
                >
                  复制到项目
                </button>
                <details className="toolbar-advanced">
                  <summary>更多</summary>
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
                    title="导出为 ZIP（跨机搬运正文，高级）"
                  >
                    导出 ZIP
                  </button>
                </details>
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
                  setStatus(errMsg(err));
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
                    {preview.items.map((it, i) => {
                      const brief = previewBriefs[it.skillId];
                      const health =
                        brief?.health ?? healthById.get(it.skillId);
                      const risks = riskSummary(
                        brief?.health?.issues ?? health?.issues,
                      );
                      const descMissing =
                        brief?.descriptionMissing ??
                        !skills
                          .find((s) => s.id === it.skillId)
                          ?.description?.trim();
                      return (
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
                                setPreview({
                                  items: preview.items.map((x, j) =>
                                    j === i
                                      ? {
                                          ...x,
                                          action,
                                          willOverwrite: action === "overwrite",
                                        }
                                      : x,
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
                          <span className="preview-item-meta" title={it.targetPath}>
                            <strong>{it.skillName}</strong>
                            <SkillDecisionBadges
                              descriptionMissing={descMissing}
                              registry={
                                brief?.registry ?? health?.registry ?? null
                              }
                              riskCount={risks.length}
                              grade={brief?.health?.grade ?? health?.grade}
                            />
                            <span className="muted tiny">{it.targetPath}</span>
                            {(it.willOverwrite || it.action === "overwrite") && (
                              <em className="overwrite-warn">
                                {" "}
                                · 将替换已有目录
                              </em>
                            )}
                          </span>
                        </li>
                      );
                    })}
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
                  onDoubleClick={() => openSkill(s.id)}
                  title="单击选择 · 双击查看详情 · 拖到「目标项目」复制"
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
                      日常用法：单击选择 · 双击看详情 · 拖到上方「目标项目」复制 ·{" "}
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
                                        setStatus(errMsg(e));
                                      }
                                    }}
                                  >
                                    diff
                                  </button>
                                  {t.access !== "readonly" && !same && (
                                    <button
                                      type="button"
                                      title="同步将覆盖目标侧全部文件"
                                      onClick={async () => {
                                        if (
                                          !confirm(
                                            `同步将删除并覆盖目标侧全部内容：\n${t.dirPath}\n\n用当前这份替换对方，确认继续？`,
                                          )
                                        ) {
                                          return;
                                        }
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
                                  {t.access === "readonly" && !same && (
                                    <span
                                      className="muted tiny"
                                      title="只读位置不能覆盖同步；可先提取为自己的副本"
                                    >
                                      只读不可同步
                                    </span>
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
    </>
  );
}
