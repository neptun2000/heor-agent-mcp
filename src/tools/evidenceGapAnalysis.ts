/**
 * evidence.gap_analysis — integrated Evidence Generation Plan (iEGP).
 *
 * Assesses the evidence base across HEOR domains, identifies gaps, maps
 * each to a recommended generation activity + the tool that runs it + the
 * deliverable it unblocks, and prioritises by severity (escalated on
 * decision-critical domains). The "iEGP" box of the living-evidence
 * architecture. Pure logic, no I/O. See design log #21.
 */
import { z } from "zod";
import {
  addAssumption,
  addWarning,
  createAuditRecord,
  setMethodology,
} from "../audit/builder.js";
import { auditToMarkdown } from "../formatters/markdown.js";
import { extractDisclosureLevel } from "../formatters/disclosure.js";
import { suggestForEnum } from "../util/didYouMean.js";
import { caseInsensitiveEnum } from "../util/caseInsensitive.js";
import { planIegp } from "../iegp/planner.js";
import { ALL_DOMAINS } from "../iegp/domainRegistry.js";
import type { DomainInput, IegpResult } from "../iegp/types.js";
import type { ToolResult } from "../providers/types.js";

export type { IegpResult } from "../iegp/types.js";

const DOMAINS = ALL_DOMAINS as [string, ...string[]];
const STATUSES = ["robust", "limited", "absent", "discordant"] as const;
const CONTEXTS = ["hta_payer", "jca", "regulatory", "market_access", "internal"] as const;

const DomainInputSchema = z.object({
  domain: caseInsensitiveEnum(DOMAINS),
  status: caseInsensitiveEnum(STATUSES),
  note: z.string().optional(),
});

const EvidenceGapAnalysisSchema = z
  .object({
    intervention: z.string().min(1, "intervention is required"),
    indication: z.string().min(1, "indication is required"),
    decision_context: caseInsensitiveEnum(CONTEXTS).default("hta_payer"),
    domains: z.array(DomainInputSchema).min(1, "assess at least one domain"),
    discordant_outcomes: z.array(z.string()).default([]),
    single_source_outcomes: z.array(z.string()).default([]),
  })
  .strict();

export async function handleEvidenceGapAnalysis(
  rawInput: unknown,
): Promise<ToolResult> {
  const parsed = EvidenceGapAnalysisSchema.safeParse(rawInput);
  if (!parsed.success) {
    const messages: string[] = [];
    for (const issue of parsed.error.issues) {
      if (issue.code === "invalid_enum_value" && typeof issue.received === "string") {
        const suggestions = suggestForEnum(
          issue.received,
          issue.options as readonly string[],
        );
        messages.push(
          `Invalid ${issue.path.join(".")}: "${issue.received}". Allowed: ${(issue.options as string[]).join(", ")}.${
            suggestions.length ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(", ")}?` : ""
          }`,
        );
      } else {
        messages.push(`${issue.path.join(".") || "input"}: ${issue.message}`);
      }
    }
    throw new Error(messages.join("\n"));
  }
  const input = parsed.data;

  let audit = createAuditRecord(
    "evidence.gap_analysis",
    input as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "Integrated Evidence Generation Plan (iEGP): per-domain gap assessment mapped to recommended evidence-generation activities, operationalising tools, and unblocked deliverables; severity escalated on decision-critical domains for the chosen context. Routes and prioritises caller-supplied evidence status — does not verify the underlying evidence.",
  );

  const result = planIegp({
    intervention: input.intervention,
    indication: input.indication,
    decision_context: input.decision_context,
    domains: input.domains as DomainInput[],
    discordant_outcomes: input.discordant_outcomes,
    single_source_outcomes: input.single_source_outcomes,
  });

  audit = addAssumption(
    audit,
    `Readiness ${result.readiness_score}% (${result.summary.robust}/${result.summary.domains_assessed} domains robust); ${result.summary.critical} critical, ${result.summary.high} high, ${result.summary.medium} medium gap(s).`,
  );
  for (const w of result.warnings) audit = addWarning(audit, w);

  const lines: string[] = [];
  lines.push(
    `# Integrated Evidence Generation Plan — ${input.intervention} (${input.indication})`,
  );
  lines.push("");
  lines.push(
    `**Context:** ${input.decision_context} · **Readiness:** ${result.readiness_score}% · **Gaps:** ${result.summary.critical} critical / ${result.summary.high} high / ${result.summary.medium} medium`,
  );
  lines.push("");

  if (result.prioritized_plan.length === 0) {
    lines.push("✅ No gaps identified across the assessed domains — evidence base is submission-ready for this context.");
    lines.push("");
  } else {
    lines.push("## Prioritised generation plan");
    lines.push("| # | Severity | Domain | Recommended activity | Tool | Unblocks |");
    lines.push("|---|----------|--------|----------------------|------|----------|");
    result.prioritized_plan.forEach((g, i) => {
      lines.push(
        `| ${i + 1} | ${badge(g.severity)} | ${g.label} | ${g.recommended_activity} | \`${g.tool}\` | ${g.unblocks.join("; ")} |`,
      );
    });
    lines.push("");

    lines.push("## Rationale per gap");
    for (const g of result.prioritized_plan) {
      lines.push(`- **${g.label}** (${g.severity}): ${g.rationale}`);
    }
    lines.push("");
  }

  if (result.warnings.length) {
    lines.push("## ⚠️ Notes");
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  lines.push("## References");
  lines.push("- ISPOR/ISPE Good Procedural Practices for Real-World Evidence (Berger et al. 2017)");
  lines.push("- EUnetHTA / EU JCA evidence requirements; NICE/EMA reference cases");
  lines.push("");
  lines.push(
    auditToMarkdown(audit, {
      disclosure: { level: extractDisclosureLevel(rawInput, "submission") },
    }),
  );

  return {
    content: lines.join("\n"),
    audit,
    iegp: result,
  } as ToolResult & { iegp: IegpResult };
}

function badge(s: string): string {
  switch (s) {
    case "critical":
      return "🔴 critical";
    case "high":
      return "🟠 high";
    case "medium":
      return "🟡 medium";
    default:
      return s;
  }
}

export const evidenceGapAnalysisToolSchema = {
  name: "evidence.gap_analysis",
  description:
    "Generate an integrated Evidence Generation Plan (iEGP). Assess the evidence base across HEOR domains (epidemiology, disease_burden, clinical_efficacy, comparative_effectiveness, safety, economic_cea, budget_impact, hrqol_utilities, adherence, unmet_need, patient_experience) — each with a status (robust/limited/absent/discordant) — and the tool returns the gaps, a recommended evidence-generation activity for each, the tool that operationalises it, the deliverable it unblocks, and a severity-prioritised plan (gaps on decision-critical domains for the chosen context escalate). Optionally fold in discordant_outcomes / single_source_outcomes from evidence.triangulation. Returns a readiness score (% of domains robust) and a prioritised plan to close the gaps. Use after an SLR/triangulation pass to decide what evidence to generate next, and to feed the iEGP deliverable. Pairs with rwe.method_select (how to fill a gap) and workflow.living_evidence (the end-to-end flow). Pure logic; enum values case-insensitive.",
  annotations: {
    title: "Evidence Generation Plan (iEGP)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      intervention: { type: "string" },
      indication: { type: "string" },
      decision_context: { type: "string", enum: CONTEXTS, default: "hta_payer" },
      domains: {
        type: "array",
        minItems: 1,
        description: "Evidence-base state per domain.",
        items: {
          type: "object",
          properties: {
            domain: { type: "string", enum: DOMAINS },
            status: { type: "string", enum: STATUSES },
            note: { type: "string" },
          },
          required: ["domain", "status"],
        },
      },
      discordant_outcomes: {
        type: "array",
        items: { type: "string" },
        default: [],
        description: "Outcomes flagged discordant by evidence.triangulation.",
      },
      single_source_outcomes: {
        type: "array",
        items: { type: "string" },
        default: [],
        description: "Outcomes with only RCT or only RWE evidence.",
      },
      ai_disclosure_level: {
        type: "string",
        enum: ["off", "standard", "submission"],
      },
    },
    required: ["intervention", "indication", "domains"],
  },
} as const;
