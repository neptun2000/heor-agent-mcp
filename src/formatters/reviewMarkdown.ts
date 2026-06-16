// heor-agent-mcp/src/formatters/reviewMarkdown.ts
/**
 * Markdown renderer for hta.review_simulation (design log #38).
 * Self-contained render types so this module has no dependency on the tool
 * (avoids an import cycle). The tool's ReviewQuestion is structurally a
 * superset of RenderQuestion and passes directly.
 */
export type RenderSeverity = "critical" | "standard" | "minor";

export interface RenderQuestion {
  category_label: string;
  question: string;
  rationale: string;
  severity: RenderSeverity;
  what_they_look_for: string;
  suggested_response: string;
  locator: string;
  precedent?: { id: string; title: string; url: string };
}

export interface RenderSummary {
  critical: number;
  standard: number;
  minor: number;
  biggest_exposure: string;
  total: number;
  shown: number;
}

export interface RenderMeta {
  drug: string;
  indication: string;
  body_label: string;
}

const GROUPS: Array<[RenderSeverity, string, string]> = [
  ["critical", "Critical", "C"],
  ["standard", "Standard", "S"],
  ["minor", "Minor", "M"],
];

export function renderReviewSimulation(
  meta: RenderMeta,
  questions: RenderQuestion[],
  summary: RenderSummary,
): string {
  const lines: string[] = [];
  lines.push(`## HTA Review Simulation — ${meta.drug} (${meta.indication})`);
  lines.push("");
  lines.push(
    `**Body:** ${meta.body_label}  ·  **Anticipated questions:** ${summary.total}  ·  ` +
      `Critical ${summary.critical} · Standard ${summary.standard} · Minor ${summary.minor}`,
  );
  lines.push(`**Biggest exposure:** ${summary.biggest_exposure}`);
  if (summary.shown < summary.total) {
    lines.push("");
    lines.push(
      `_Showing the top ${summary.shown} of ${summary.total} anticipated questions ` +
        `(max_questions). Raise max_questions to see the rest._`,
    );
  }
  lines.push("");
  lines.push(
    `> ⚠️ **Anticipated** questions — a structured prior over what ${meta.body_label} is ` +
      `likely to ask, not a record of questions historically asked.`,
  );

  for (const [sev, heading, prefix] of GROUPS) {
    const qs = questions.filter((q) => q.severity === sev);
    if (qs.length === 0) continue;
    lines.push("");
    lines.push(`### ${heading}`);
    qs.forEach((q, i) => {
      lines.push("");
      lines.push(`**${prefix}${i + 1} · ${q.category_label}.** ${q.question}`);
      lines.push(`  ↳ *Why:* ${q.rationale}`);
      lines.push(`  ↳ *What they look for:* ${q.what_they_look_for}`);
      lines.push(`  ↳ *Suggested response:* ${q.suggested_response}`);
      if (q.precedent) {
        lines.push(
          `  ↳ *Related precedent:* [${q.precedent.id} — ${q.precedent.title}](${q.precedent.url})`,
        );
      }
    });
  }

  return lines.join("\n").trim();
}
