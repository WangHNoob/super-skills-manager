import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { errMsg } from "../errMsg";
import type {
  AppSettings,
  Bundle,
  HealthReport,
  OpLogEntry,
  PolicyTemplate,
  ProjectRoot,
  SkillRecord,
  SourceInfo,
  UsageInsights,
} from "../types";

export type Tab =
  | "library"
  | "bundles"
  | "sources"
  | "health"
  | "wizard"
  | "registry"
  | "settings"
  | "oplog";

interface CatalogContextValue {
  tab: Tab;
  setTab: Dispatch<SetStateAction<Tab>>;

  skills: SkillRecord[];
  sources: SourceInfo[];
  bundles: Bundle[];
  projects: ProjectRoot[];
  settings: AppSettings | null;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  oplog: OpLogEntry[];
  healthReports: HealthReport[];
  policyTemplates: PolicyTemplate[];
  insights: UsageInsights | null;
  allTags: string[];

  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  runtimeFilter: string[];
  toggleRuntimeFilter: (rt: string) => void;
  twinsOnly: boolean;
  setTwinsOnly: Dispatch<SetStateAction<boolean>>;
  favoritesOnly: boolean;
  setFavoritesOnly: Dispatch<SetStateAction<boolean>>;
  tagFilter: string | null;
  setTagFilter: Dispatch<SetStateAction<string | null>>;

  status: string;
  setStatus: Dispatch<SetStateAction<string>>;
  scanning: boolean;
  handleScan: () => Promise<void>;
  refreshCatalog: () => Promise<void>;
  pickProject: () => Promise<void>;

  /** Health（等其它 tab）请求在技能库中打开某个 skill 详情 */
  pendingOpenSkillId: string | null;
  requestOpenSkill: (id: string) => void;
  clearPendingOpenSkill: () => void;
  /** 组合包在「询问」冲突策略下，请求技能库生成复制预览 */
  pendingPreviewIds: string[] | null;
  requestLibraryPreview: (ids: string[]) => void;
  clearPendingPreviewIds: () => void;
}

const CatalogContext = createContext<CatalogContextValue | null>(null);

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<Tab>("library");
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [projects, setProjects] = useState<ProjectRoot[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [oplog, setOplog] = useState<OpLogEntry[]>([]);
  const [healthReports, setHealthReports] = useState<HealthReport[]>([]);
  const [policyTemplates, setPolicyTemplates] = useState<PolicyTemplate[]>(
    [],
  );
  const [insights, setInsights] = useState<UsageInsights | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);

  const [query, setQuery] = useState("");
  const [runtimeFilter, setRuntimeFilter] = useState<string[]>([]);
  const [twinsOnly, setTwinsOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const [status, setStatus] = useState("");
  const [scanning, setScanning] = useState(false);

  const [pendingOpenSkillId, setPendingOpenSkillId] = useState<
    string | null
  >(null);
  const [pendingPreviewIds, setPendingPreviewIds] = useState<
    string[] | null
  >(null);

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
    refreshCatalog().catch((e) => setStatus(errMsg(e)));
  }, [refreshCatalog]);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setStatus("正在扫描…");
    try {
      const n = await api.scanNow();
      const h = await api.runHealthScan();
      await refreshCatalog();
      setStatus(`扫描完成：${n} 个目录，健康检查 ${h} 条`);
    } catch (e) {
      setStatus(errMsg(e));
    } finally {
      setScanning(false);
    }
  }, [refreshCatalog]);

  const pickProject = useCallback(async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") {
      const s = await api.setTargetProject(dir);
      setSettings(s);
      await refreshCatalog();
      setStatus(`目标项目: ${dir}`);
    }
  }, [refreshCatalog]);

  function toggleRuntimeFilter(rt: string) {
    setRuntimeFilter((prev) =>
      prev.includes(rt) ? prev.filter((x) => x !== rt) : [...prev, rt],
    );
  }

  function requestOpenSkill(id: string) {
    setTab("library");
    setPendingOpenSkillId(id);
  }
  function clearPendingOpenSkill() {
    setPendingOpenSkillId(null);
  }
  function requestLibraryPreview(ids: string[]) {
    setTab("library");
    setPendingPreviewIds(ids);
  }
  function clearPendingPreviewIds() {
    setPendingPreviewIds(null);
  }

  const value: CatalogContextValue = {
    tab,
    setTab,
    skills,
    sources,
    bundles,
    projects,
    settings,
    setSettings,
    oplog,
    healthReports,
    policyTemplates,
    insights,
    allTags,
    query,
    setQuery,
    runtimeFilter,
    toggleRuntimeFilter,
    twinsOnly,
    setTwinsOnly,
    favoritesOnly,
    setFavoritesOnly,
    tagFilter,
    setTagFilter,
    status,
    setStatus,
    scanning,
    handleScan,
    refreshCatalog,
    pickProject,
    pendingOpenSkillId,
    requestOpenSkill,
    clearPendingOpenSkill,
    pendingPreviewIds,
    requestLibraryPreview,
    clearPendingPreviewIds,
  };

  return (
    <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
  );
}

export function useCatalog(): CatalogContextValue {
  const ctx = useContext(CatalogContext);
  if (!ctx) {
    throw new Error("useCatalog 必须在 CatalogProvider 内使用");
  }
  return ctx;
}
