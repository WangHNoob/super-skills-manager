import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
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

const SKILLS_DEBOUNCE_MS = 250;

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

  /** 与搜索无关的元数据：仅挂载 / 扫描 / 选项目后刷新 */
  const refreshMeta = useCallback(async () => {
    const [src, b, p, s, log, health, templates, usage, tags] =
      await Promise.all([
        api.listSources(),
        api.listBundles(),
        api.listProjects(),
        api.getSettings(),
        api.listOplog(30),
        api
          .listHealthReports({ limit: 500 })
          .catch(() => [] as HealthReport[]),
        api.listPolicyTemplates().catch(() => []),
        api.getUsageInsights().catch(() => null),
        api.listSkillTags().catch(() => [] as string[]),
      ]);
    setSources(src);
    setBundles(b);
    setProjects(p);
    setSettings(s);
    setOplog(log);
    setHealthReports(health);
    setPolicyTemplates(templates);
    setInsights(usage);
    setAllTags(tags);
  }, []);

  /** 仅 listSkills，跟随筛选条件 */
  const refreshSkills = useCallback(async () => {
    const filter = {
      query: query || null,
      runtimes: runtimeFilter.length ? runtimeFilter : null,
      twinsOnly,
      favoritesOnly,
      tag: tagFilter,
    };
    const sk = await api.listSkills(filter);
    setSkills(sk);
  }, [query, runtimeFilter, twinsOnly, favoritesOnly, tagFilter]);

  const refreshCatalog = useCallback(async () => {
    await Promise.all([refreshMeta(), refreshSkills()]);
  }, [refreshMeta, refreshSkills]);

  // 元数据：挂载时拉一次
  useEffect(() => {
    refreshMeta().catch((e) => setStatus(errMsg(e)));
  }, [refreshMeta]);

  // 技能列表：query/筛选变化 debounce，避免每键 10 路 IPC
  const skillsFirstLoad = useRef(true);
  useEffect(() => {
    if (skillsFirstLoad.current) {
      skillsFirstLoad.current = false;
      refreshSkills().catch((e) => setStatus(errMsg(e)));
      return;
    }
    const timer = window.setTimeout(() => {
      refreshSkills().catch((e) => setStatus(errMsg(e)));
    }, SKILLS_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [refreshSkills]);

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
