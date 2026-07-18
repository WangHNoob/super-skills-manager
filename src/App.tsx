import { CatalogProvider, useCatalog } from "./context/CatalogContext";
import ProjectSetup from "./ProjectSetup";
import BundlesView from "./views/BundlesView";
import HealthView from "./views/HealthView";
import LibraryView from "./views/LibraryView";
import SkillsExplorerView from "./views/SkillsExplorerView";
import OpLogView from "./views/OpLogView";
import RegistryView from "./views/RegistryView";
import SettingsView from "./views/SettingsView";
import SourcesView from "./views/SourcesView";
import "./App.css";

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
              ["explorer", "分类浏览", "按工具 / 全局·项目 / 项目一览本机技能"],
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
          <button
            type="button"
            onClick={() => setStatus("")}
            aria-label="关闭提示"
          >
            关闭
          </button>
        </div>
      )}

      {/* 各视图内部依据 tab 自行决定是否渲染；始终挂载以保留跨 tab 状态
          （如详情弹层、在线安装的输出框），与拆分前行为一致 */}
      <LibraryView />
      <SkillsExplorerView />
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
