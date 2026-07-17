import type { CopyPlanItem, CopyPreview } from "./types";

export const CONFLICT_LABELS: Record<string, string> = {
  overwrite: "覆盖原文件",
  skip: "跳过（保留已有）",
  rename: "另存为新名称",
  prompt: "询问（逐项选择）",
};

/** 将 preview 中仍为 prompt 的项解析为具体 action；取消则返回 null */
export function resolvePromptItems(
  preview: CopyPreview,
  ask: (item: CopyPlanItem) => "overwrite" | "skip" | "rename" | null,
): CopyPreview | null {
  const items: CopyPlanItem[] = [];
  for (const it of preview.items) {
    if (it.action !== "prompt") {
      items.push(it);
      continue;
    }
    const choice = ask(it);
    if (!choice) return null;
    items.push({ ...it, action: choice });
  }
  return { items };
}

export function askConflictChoice(item: CopyPlanItem): "overwrite" | "skip" | "rename" | null {
  const raw = window.prompt(
    `「${item.skillName}」目标已存在，请选择处理方式：\n` +
      `overwrite（覆盖）/ skip（跳过）/ rename（改名）\n\n${item.targetPath}`,
    "overwrite",
  );
  if (raw == null) return null;
  const v = raw.trim().toLowerCase();
  if (v === "overwrite" || v === "skip" || v === "rename") return v;
  return null;
}
