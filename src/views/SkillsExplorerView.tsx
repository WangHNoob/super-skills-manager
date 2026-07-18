import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { RUNTIME_LABELS } from "../constants";
import { useCatalog } from "../context/CatalogContext";
import { errMsg } from "../errMsg";
import type { SkillRecord } from "../types";

interface ProjectGroup {
  root: string;
  skills: SkillRecord[];
}
interface RuntimeNode {
  runtime: string;
  global: SkillRecord[];
  projects: ProjectGroup[];
}

/** 分类浏览：按 工具 → 全局 / 项目级 → 项目 → 技能 聚合本机技能 */
export default function SkillsExplorerView() {
  const { tab, setTab, requestOpenSkill, projects, setStatus } = useCatalog();
  const [all, setAll] = useState<SkillRecord[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // 切到本 tab 时拉一次全量；不依赖 library 的筛选状态
  useEffect(() => {
    if (tab !== "explorer") return;
    let cancelled = false;
    setLoading(true);
    api
      .listSkills({})
      .then((s) => {
        if (!cancelled) setAll(s);
      })
      .catch((e) => {
        if (!cancelled) setStatus(errMsg(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, setStatus]);

  // projectRoot 路径 → 显示名（来自已登记项目）
  const projectName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.path.toLowerCase(), p.displayName);
    return m;
  }, [projects]);

  const tree = useMemo<RuntimeNode[]>(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? all.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q) ||
            (s.projectRoot || "").toLowerCase().includes(q) ||
            s.runtime.toLowerCase().includes(q),
        )
      : all;

    const byRuntime = new Map<string, RuntimeNode>();
    for (const s of filtered) {
      const node = byRuntime.get(s.runtime) ?? {
        runtime: s.runtime,
        global: [],
        projects: [],
      };
      if (s.scope === "project") {
        const root = s.projectRoot || "(未知项目)";
        let pg = node.projects.find((p) => p.root === root);
        if (!pg) {
          pg = { root, skills: [] };
          node.projects.push(pg);
        }
        pg.skills.push(s);
      } else {
        node.global.push(s);
      }
      byRuntime.set(s.runtime, node);
    }
    const nodes = [...byRuntime.values()];
    nodes.sort((a, b) => a.runtime.localeCompare(b.runtime));
    for (const n of nodes) {
      n.projects.sort((a, b) => a.root.localeCompare(b.root));
    }
    return nodes;
  }, [all, query]);

  const total = all.length;
  const projectScopedCount = all.filter((s) => s.scope === "project").length;

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function isOpen(key: string) {
    return !collapsed.has(key);
  }

  if (tab !== "explorer") return null;

  return (
    <div className="page">
      <h2>分类浏览</h2>
      <p className="page-lead">
        按 <strong>工具</strong> → <strong>全局 / 项目级</strong> → <strong>项目</strong> → 技能
        ，聚合浏览本机共 {total} 个技能（其中 {projectScopedCount} 个属于项目级）。
        {projectScopedCount === 0 && (
          <>
            {" "}
            项目级偏少？去{" "}
            <button onClick={() => setTab("sources")}>来源与项目</button>{" "}
            添加「工作区根」可自动发现各项目里的技能。
          </>
        )}
      </p>
      <label className="search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="按名称 / 说明 / 项目路径过滤…"
          aria-label="过滤分类浏览"
        />
      </label>
      {loading && <p className="hint">加载中…</p>}
      {!loading && tree.length === 0 && (
        <p className="hint">
          {query ? "没有匹配的技能" : "暂无技能，先去重新扫描或添加工作区根"}
        </p>
      )}
      <ul className="explorer-tree">
        {tree.map((node) => {
          const rtKey = `rt:${node.runtime}`;
          const projectTotal = node.projects.reduce(
            (n, p) => n + p.skills.length,
            0,
          );
          return (
            <li key={node.runtime}>
              <button
                className="tree-head"
                type="button"
                onClick={() => toggle(rtKey)}
              >
                <span className="caret">{isOpen(rtKey) ? "▾" : "▸"}</span>
                <strong>{RUNTIME_LABELS[node.runtime] || node.runtime}</strong>
                <span className="muted">
                  {node.global.length} 全局 · {projectTotal} 项目
                </span>
              </button>
              {isOpen(rtKey) && (node.global.length > 0 || projectTotal > 0) && (
                <ul>
                  {node.global.length > 0 && (
                    <Branch
                      label="全局"
                      count={node.global.length}
                      open={isOpen(`${rtKey}:global`)}
                      onToggle={() => toggle(`${rtKey}:global`)}
                      skills={node.global}
                      onOpen={requestOpenSkill}
                    />
                  )}
                  {projectTotal > 0 && (
                    <li>
                      <button
                        className="tree-head sub"
                        type="button"
                        onClick={() => toggle(`${rtKey}:project`)}
                      >
                        <span className="caret">
                          {isOpen(`${rtKey}:project`) ? "▾" : "▸"}
                        </span>
                        <strong>项目级</strong>
                        <span className="muted">{projectTotal}</span>
                      </button>
                      {isOpen(`${rtKey}:project`) && (
                        <ul>
                          {node.projects.map((pg) => {
                            const pKey = `${rtKey}:project:${pg.root}`;
                            const name =
                              projectName.get(pg.root.toLowerCase()) ||
                              pg.root.split(/[\\/]/).filter(Boolean).pop() ||
                              pg.root;
                            return (
                              <Branch
                                key={pg.root}
                                label={name}
                                count={pg.skills.length}
                                open={isOpen(pKey)}
                                onToggle={() => toggle(pKey)}
                                skills={pg.skills}
                                onOpen={requestOpenSkill}
                              />
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 一个可折叠分支：标题 + 计数 + 内层技能列表 */
function Branch({
  label,
  count,
  open,
  onToggle,
  skills,
  onOpen,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  skills: SkillRecord[];
  onOpen: (id: string) => void;
}) {
  return (
    <li>
      <button className="tree-head sub" type="button" onClick={onToggle}>
        <span className="caret">{open ? "▾" : "▸"}</span>
        <strong>{label}</strong>
        <span className="muted">{count}</span>
      </button>
      {open && (
        <ul className="skill-row-list">
          {skills.map((s) => (
            <li key={s.id}>
              <button className="linkish" onClick={() => onOpen(s.id)}>
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
