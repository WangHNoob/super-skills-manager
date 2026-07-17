import { useCatalog } from "../context/CatalogContext";

/** 操作记录：复制、删除、导入等历史 */
export default function OpLogView() {
  const { tab, oplog } = useCatalog();

  if (tab !== "oplog") return null;

  return (
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
  );
}
