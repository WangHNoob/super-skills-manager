import { useState } from "react";
import { api } from "../api";
import HelpTip from "../components/HelpTip";
import { useCatalog } from "../context/CatalogContext";
import { errMsg } from "../errMsg";

/** 在线安装：搜索、安装、更新、移除 skills.sh 上的技能 */
export default function RegistryView() {
  const { tab, setStatus, handleScan } = useCatalog();

  const [regQuery, setRegQuery] = useState("");
  const [regPackage, setRegPackage] = useState("vercel-labs/agent-skills");
  const [regOutput, setRegOutput] = useState("");
  const [regBusy, setRegBusy] = useState(false);

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
      setStatus(errMsg(e));
      setRegOutput(errMsg(e));
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
      setStatus(errMsg(e));
      setRegOutput(errMsg(e));
    }
  }

  if (tab !== "registry") return null;

  return (
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
  );
}
