/** 将 invoke / 未知错误转为可读文案 */
export function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; code?: unknown };
    if (typeof o.message === "string" && o.message) {
      return typeof o.code === "string" && o.code
        ? `[${o.code}] ${o.message}`
        : o.message;
    }
  }
  return String(e);
}
