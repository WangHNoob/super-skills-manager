import type { OutlineHeading, SkillDecisionBrief } from "../types";
import { registryFreshness, riskSummary } from "../skillFreshness";

type Props = {
  brief: SkillDecisionBrief;
  /** 紧凑模式：用于列表展开区 */
  compact?: boolean;
};

/** 装机决策卡：用途说明 + 大纲 + 风险 + 过期徽章 */
export default function SkillDecisionCard({ brief, compact }: Props) {
  const freshness = registryFreshness(brief.registry);
  const risks = riskSummary(brief.health?.issues);
  const outline = brief.outline.filter((h) => h.level <= 2).slice(0, 8);

  return (
    <div className={`decision-card${compact ? " compact" : ""}`}>
      <div className="decision-card-badges">
        {brief.descriptionMissing && (
          <span className="decision-badge warn" title="frontmatter 缺少 description">
            说明不足
          </span>
        )}
        {freshness.kind === "outdated" && (
          <span className="decision-badge stale" title={freshness.title}>
            {freshness.label}
          </span>
        )}
        {freshness.kind === "check_failed" && (
          <span className="decision-badge muted" title={freshness.title}>
            {freshness.label}
          </span>
        )}
        {freshness.kind === "matched" && !compact && (
          <span className="decision-badge ok" title={freshness.title}>
            {freshness.label}
          </span>
        )}
        {brief.health && (
          <span
            className={`decision-badge grade g-${brief.health.grade.toLowerCase()}`}
            title={`健康分 ${Math.round(brief.health.score)}`}
          >
            {brief.health.grade}
          </span>
        )}
      </div>

      <section className="decision-sec">
        <h4>用途</h4>
        {brief.descriptionMissing ? (
          <p className="decision-missing">
            缺少 description。装进项目前建议先补一句「何时使用」。
          </p>
        ) : (
          <p className="decision-desc">{brief.description}</p>
        )}
      </section>

      {outline.length > 0 && (
        <section className="decision-sec">
          <h4>大纲</h4>
          <ul className="decision-outline">
            {outline.map((h, i) => (
              <OutlineItem key={i} heading={h} />
            ))}
          </ul>
        </section>
      )}

      {risks.length > 0 && (
        <section className="decision-sec">
          <h4>风险与依赖</h4>
          <ul className="decision-risks">
            {risks.map((r, i) => (
              <li key={i} className={`sev-${r.severity}`}>
                <span className="sev">{r.severity}</span>
                {r.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!risks.length && brief.health && brief.health.issues.length === 0 && (
        <p className="muted tiny">本地规则未发现问题。</p>
      )}
    </div>
  );
}

/** 列表行上的迷你徽章（不展开也能看到过期/说明不足/风险数） */
export function SkillDecisionBadges({
  descriptionMissing,
  registry,
  riskCount,
  grade,
}: {
  descriptionMissing?: boolean;
  registry?: SkillDecisionBrief["registry"];
  riskCount?: number;
  grade?: string | null;
}) {
  const freshness = registryFreshness(registry);
  return (
    <span className="decision-inline-badges">
      {descriptionMissing && (
        <span className="decision-badge warn" title="缺少 description">
          说明不足
        </span>
      )}
      {freshness.kind === "outdated" && (
        <span className="decision-badge stale" title={freshness.title}>
          {freshness.label}
        </span>
      )}
      {freshness.kind === "check_failed" && (
        <span className="decision-badge muted" title={freshness.title}>
          {freshness.label}
        </span>
      )}
      {typeof riskCount === "number" && riskCount > 0 && (
        <span className="decision-badge warn" title={`${riskCount} 条 error/warn`}>
          {riskCount} 风险
        </span>
      )}
      {grade && (
        <span className={`decision-badge grade g-${grade.toLowerCase()}`}>
          {grade}
        </span>
      )}
    </span>
  );
}

function OutlineItem({ heading }: { heading: OutlineHeading }) {
  return (
    <li className={`lv-${heading.level}`}>
      {heading.text}
    </li>
  );
}
