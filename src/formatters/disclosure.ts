import type { AuditRecord } from "../audit/types.js";

export const ISPOR_TASK_FORCE_CITATION =
  "Fleurence RL, Dawoud D, Bian J, Higashi MK, Wang X, Xu H, Chhatwal J, Ayer T; " +
  "ISPOR Working Group on Generative AI. " +
  "ELEVATE-GenAI: Reporting Guidelines for the Use of Large Language Models in " +
  "Health Economics and Outcomes Research: An ISPOR Working Group Report. " +
  "Value Health. 2025;28(11):1611–1625. doi:10.1016/j.jval.2025.06.018";

export type AiDisclosureLevel = "off" | "standard" | "submission";

export type DisclosureOpts = {
  level: AiDisclosureLevel;
  modelId?: string;
  dateISO?: string;
};

const DEFAULT_MODEL = "claude-sonnet-4-6";

const VALID_LEVELS = new Set<AiDisclosureLevel>([
  "off",
  "standard",
  "submission",
]);

export function extractDisclosureLevel(
  args: unknown,
  defaultLevel: AiDisclosureLevel,
): AiDisclosureLevel {
  const raw = (args as Record<string, unknown>)?.ai_disclosure_level;
  return VALID_LEVELS.has(raw as AiDisclosureLevel)
    ? (raw as AiDisclosureLevel)
    : defaultLevel;
}

export const AI_DISCLOSURE_LEVEL_SCHEMA_PROPERTY = {
  type: "string",
  enum: ["off", "standard", "submission"] as const,
  description:
    "AI assistance disclosure level appended to the output. " +
    '"off" = no disclosure (analyst scratch mode); ' +
    '"standard" = default visible block (model, tools called, sources, date, human-review reminder); ' +
    '"submission" = standard + ISPOR ELEVATE-GenAI citation (use for regulatory or payer submissions).',
} as const;

function formatToolCalls(audit: AuditRecord): string {
  if (audit.tools_called.length === 0) return "this tool only";
  return audit.tools_called
    .map((t) => {
      const ms = t.ms >= 1000 ? `${(t.ms / 1000).toFixed(1)} s` : `${t.ms} ms`;
      const suffix = t.outcome !== "ok" ? ` — ${t.outcome}` : "";
      return `${t.name} (${ms}${suffix})`;
    })
    .join(", ");
}

export function buildDisclosure(
  audit: AuditRecord,
  opts: DisclosureOpts,
): string {
  if (opts.level === "off") return "";

  const model = opts.modelId ?? DEFAULT_MODEL;
  const date = opts.dateISO ?? new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push("---");
  lines.push("### AI Assistance Disclosure (ISPOR-aligned)");
  lines.push("");
  lines.push(
    "This output was generated with AI assistance and " +
      "**requires human review before use in regulatory submission, " +
      "payer dossier, or clinical decision-making.**",
  );
  lines.push("");
  lines.push(`- **Model:** ${model} (Anthropic)`);
  lines.push(`- **Generated:** ${date}`);
  lines.push(`- **Tools called:** ${formatToolCalls(audit)}`);

  if (audit.sources_queried.length > 0) {
    const sourceParts = audit.sources_queried.map(
      (s) => `${s.source} (n=${s.results_included} hits)`,
    );
    lines.push(`- **Sources queried:** ${sourceParts.join(", ")}`);
  }

  lines.push("");
  lines.push(
    "_Per ISPOR Task Force on GenAI in HEOR (2025), the user/reviewer remains responsible " +
      "for verifying clinical claims, regulatory status, and any cost-effectiveness or " +
      "budget-impact figures against the cited primary sources._",
  );

  if (opts.level === "submission") {
    lines.push("");
    lines.push("**Submission-grade detail:**");
    lines.push(`- **ISPOR citation:** ${ISPOR_TASK_FORCE_CITATION}`);
  }

  return lines.join("\n");
}
