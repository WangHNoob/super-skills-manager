import { api } from "../api";
import { useCatalog } from "../context/CatalogContext";

/** 操作记录：复制、删除、导入、恢复等历史 */
export default function OpLogView() {
  const { tab, oplog, setStatus, refreshCatalog } = useCatalog();

  if (tab !== "oplog") return null;

  async function restoreEntry(sources: string[]) {
    const verb = sources.length > 1 ? `这 ${sources.length} 个技能` : "该技能";
    if (!confirm(`将从系统回收站恢复${verb}到原位置，确认？`)) return;
    try {
      const entry = await api.restoreSkills(sources);
      await refreshCatalog();
      const missing = (entry.detail?.missing as string[] | undefined) ?? [];
      setStatus(
        `恢复: ${entry.status}（${entry.sources.length} 个已还原${
          missing.length ? ` · ${missing.length} 个回收站未找到` : ""
        }）`,
      );
    } catch (e) {
      setStatus(String(e));
    }
  }

  return (
    <div className="page">
      <h2>操作记录</h2>
      <p className="page-lead">
        复制、删除、导入、恢复等操作的历史，便于核对写到了哪里。删除会进系统回收站，「恢复」可从回收站还原。
      </p>
      <table className="log-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>操作</th>
            <th>状态</th>
            <th>目标数</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {oplog.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.ts).toLocaleString()}</td>
              <td>{e.op}</td>
              <td>{e.status}</td>
              <td>{e.targets.length}</td>
              <td>
                {e.op === "delete" && e.sources.length > 0 && (
                  <button
                    className="linkish"
                    style={{ width: "auto" }}
                    title={`从回收站恢复：\n${e.sources.join("\n")}`}
                    onClick={() => void restoreEntry(e.sources)}
                  >
                    恢复
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
