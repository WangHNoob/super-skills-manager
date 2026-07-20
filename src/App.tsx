import { CatalogProvider, useCatalog } from "./context/CatalogContext";
import ProjectSetup from "./ProjectSetup";
import BundlesView from "./views/BundlesView";
import HealthView from "./views/HealthView";
import LibraryView from "./views/LibraryView";
import OpLogView from "./views/OpLogView";
import RegistryView from "./views/RegistryView";
import SettingsView from "./views/SettingsView";
import SourcesView from "./views/SourcesView";
import "./App.css";

/** 主路径：装机相关 */
const PRIMARY_TABS = [
  ["wizard", "新建项目", "选目录、装技能、健康检查一页完成"],
  ["library", "技能库", "浏览并复制到项目"],
  ["registry", "在线安装", "从 skills.sh 搜索安装"],
  ["bundles", "组合包", "一键把一组技能装进项目"],
  ["health", "健康检查", "风险与是否过期"],
] as const;

/** 后置：配置 / 审计，不进首屏心智 */
const ADVANCED_TABS = [
  ["settings", "设置", "冲突策略与高级导入"],
  ["sources", "来源与项目", "扫描哪些目录、登记项目"],
  ["oplog", "操作记录", "复制与删除历史"],
] as const;

export default function App() {
  return (
    <CatalogProvider>
      <AppShell />
    </CatalogProvider>
  );
}

/** 应用外壳：头部导航、状态条、各 tab 视图的挂载点 */
function AppShell() {
  const {
    tab,
    setTab,
    status,
    setStatus,
    scanning,
    handleScan,
    settings,
    setSettings,
    skills,
    refreshCatalog,
  } = useCatalog();

  const advancedActive = ADVANCED_TABS.some(([k]) => k === tab);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">SSM</span>
          <div>
            <strong>AI Skills 超级管理器</strong>
            <p>选好技能，装进项目</p>
          </div>
        </div>
        <nav className="tabs" aria-label="主导航">
          <div className="tabs-primary" role="presentation">
            {PRIMARY_TABS.map(([k, label, tip]) => (
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
          </div>
          <span className="tabs-sep" aria-hidden="true" />
          <div
            className={`tabs-advanced${advancedActive ? " has-active" : ""}`}
            role="group"
            aria-label="高级"
          >
            <span className="tabs-advanced-label">高级</span>
            {ADVANCED_TABS.map(([k, label, tip]) => (
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
          </div>
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
          <button
            type="button"
            onClick={() => setStatus("")}
            aria-label="关闭提示"
          >
            关闭
          </button>
        </div>
      )}

      {/* 各视图内部依据 tab 自行决定是否渲染；始终挂载以保留跨 tab 状态 */}
      <LibraryView />
      <BundlesView />
      <HealthView />
      {tab === "wizard" && (
        <ProjectSetup
          settings={settings}
          skills={skills}
          onSettings={setSettings}
          onStatus={setStatus}
          onRefresh={refreshCatalog}
        />
      )}
      <RegistryView />
      <SettingsView />
      <SourcesView />
      <OpLogView />

      <a
        className="deerflow-badge"
        href="https://deerflow.tech"
        target="_blank"
        rel="noreferrer"
        title="Created By Deerflow"
      >
        ✦ <span>Deerflow</span>
      </a>
    </div>
  );
}
