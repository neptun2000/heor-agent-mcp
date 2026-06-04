// heor-agent-mcp/src/formatters/governanceMarkdown.ts
import type { Rag, Scorecard } from "../governance/scoring.js";
import { UNSCORED_DOMAINS } from "../governance/crosswalk.js";

export interface RenderedDimension {
  key: string;
  label: string;
  rag: Rag;
  elevate_refs: string[];
  finding: string;
  recommended_mitigation: string;
}

const RAG_ICON: Record<Rag, string> = {
  green: "🟢",
  amber: "🟡",
  red: "🔴",
  insufficient: "⚪",
};

export function renderGovernanceScorecard(
  dims: RenderedDimension[],
  scorecard: Scorecard,
  verdict: string,
): string {
  const lines: string[] = [];
  lines.push("## GenAI-in-HTA Governance Self-Check");
  lines.push("");
  lines.push(`**Verdict:** ${verdict}`);
  lines.push("");
  lines.push(
    `**Scorecard:** 🟢 ${scorecard.green} · 🟡 ${scorecard.amber} · 🔴 ${scorecard.red} · ⚪ ${scorecard.insufficient} (insufficient)`,
  );
  lines.push("");
  lines.push("| Dimension | Score | ELEVATE domain(s) | Finding | Recommended mitigation |");
  lines.push("|---|---|---|---|---|");
  for (const d of dims) {
    const mit = d.recommended_mitigation || "—";
    lines.push(
      `| ${d.label} | ${RAG_ICON[d.rag]} ${d.rag} | ${d.elevate_refs.join("; ")} | ${d.finding} | ${mit} |`,
    );
  }
  lines.push("");
  lines.push(
    `_Scope: this tool scores 6 governance dimensions. ELEVATE-GenAI also defines model-evaluation domains not scored here (${UNSCORED_DOMAINS.join(", ")}). "Insufficient" means no evidence was supplied — it is never a pass._`,
  );
  return lines.join("\n");
}
