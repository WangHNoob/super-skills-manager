import type { HealthIssue, RegistrySyncInfo } from "./types";

/** 装机决策：官方对照新鲜度（仅锁文件有记录时有意义） */
export type FreshnessKind =
  | "outdated"
  | "check_failed"
  | "matched"
  | "unsupported"
  | "none";

export interface FreshnessInfo {
  kind: FreshnessKind;
  /** 徽章短文案；none 时为空 */
  label: string;
  title: string;
}

/**
 * 过期判定规则（grilling 锁定）：
 * - diverged → 可能不是最新（弱提示）
 * - fetch_failed → 未能检查更新（不当成过期）
 * - untracked / no_lock / 无 registry → 不展示
 */
export function registryFreshness(
  registry?: RegistrySyncInfo | null,
): FreshnessInfo {
  if (!registry) {
    return { kind: "none", label: "", title: "" };
  }
  switch (registry.status) {
    case "diverged":
      return {
        kind: "outdated",
        label: "可能不是最新",
        title: registry.message || "与 skills.sh / GitHub 远端不一致",
      };
    case "fetch_failed":
      return {
        kind: "check_failed",
        label: "未能检查更新",
        title: registry.message || "网络或远端不可用，未判定为过期",
      };
    case "matched":
      return {
        kind: "matched",
        label: "与远端一致",
        title: registry.message || "本地与远端 SKILL.md 一致",
      };
    case "unsupported":
      return {
        kind: "unsupported",
        label: "无法对照远端",
        title: registry.message || "锁文件有记录但无法构造远端 URL",
      };
    default:
      // untracked / no_lock 等
      return { kind: "none", label: "", title: "" };
  }
}

/** 装机决策关注的风险：error + warn，最多取若干条 */
export function riskSummary(
  issues: HealthIssue[] | undefined | null,
  limit = 4,
): HealthIssue[] {
  if (!issues?.length) return [];
  return issues
    .filter((i) => i.severity === "error" || i.severity === "warn")
    .slice(0, limit);
}
