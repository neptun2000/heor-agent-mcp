/**
 * rwe_method_select — real-world-evidence study-design selection.
 *
 * Given a research objective, the data sources available, the decision
 * context, and the rigour required, ranks the five core RWE methodologies
 * (retrospective database analysis, survey, literature review, chart
 * review, social-media listening) and returns a primary recommendation +
 * alternatives, each with its validity tier, bias caveats, and the
 * downstream tools in this server that operationalise it.
 *
 * Pure decision logic, no I/O — modelled on pv_classify. Acts as a router
 * into the rest of the HEOR toolset (literature.search, pv.signal_workflow,
 * evidence.population_adjusted, …). See design log #16.
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
import { selectRweMethod } from "../rwe/decisionTree.js";
import { profileFor } from "../rwe/methodRegistry.js";
import type { RweMethodSelection } from "../rwe/types.js";
import type { ToolResult } from "../providers/types.js";

export type { RweMethodSelection } from "../rwe/types.js";

const RESEARCH_OBJECTIVES = [
  "treatment_effectiveness",
  "safety_surveillance",
  "cost_effectiveness",
  "treatment_patterns",
  "patient_preferences",
  "adherence",
  "disease_epidemiology",
  "evidence_synthesis",
  "patient_experience",
] as const;

const DATA_SOURCES = [
  "claims_database",
  "ehr",
  "patient_charts",
  "patient_survey_access",
  "hcp_survey_access",
  "published_literature",
  "social_media",
] as const;

const DECISION_CONTEXTS = [
  "hta_payer",
  "regulatory",
  "clinical_guideline",
  "internal_strategy",
  "exploratory",
] as const;

const RIGOR_LEVELS = ["exploratory", "supportive", "submission_grade"] as const;

const RweMethodSelectSchema = z
  .object({
    research_objective: caseInsensitiveEnum(RESEARCH_OBJECTIVES),
    available_data: z.array(caseInsensitiveEnum(DATA_SOURCES)).default([]),
    decision_context: caseInsensitiveEnum(DECISION_CONTEXTS).default(
      "internal_strategy",
    ),
    rigor_required: caseInsensitiveEnum(RIGOR_LEVELS).default("supportive"),
  })
  .strict();

export async function handleRweMethodSelect(
  rawInput: unknown,
): Promise<ToolResult> {
  const parsed = RweMethodSelectSchema.safeParse(rawInput);
  if (!parsed.success) {
    const messages: string[] = [];
    for (const issue of parsed.error.issues) {
      if (
        issue.code === "invalid_enum_value" &&
        typeof issue.received === "string"
      ) {
        const suggestions = suggestForEnum(
          issue.received,
          issue.options as readonly string[],
        );
        messages.push(
          `Invalid ${issue.path.join(".")}: "${issue.received}". Allowed: ${(issue.options as string[]).join(", ")}.${
            suggestions.length
              ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(", ")}?`
              : ""
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
    "rwe.method_select",
    input as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "RWE method-comparison framework (retrospective database analysis, survey, literature review, chart review, social-media listening) scored against research objective, data availability, decision context, and required rigour. Validity tiers reflect typical internal validity of each design per ISPOR/ISPE Good Procedural Practices for RWE and the FDA RWE framework — not a normative worth ranking.",
  );

  const selection = selectRweMethod(input);

  if (selection.primary) {
    audit = addAssumption(
      audit,
      `Primary recommendation: ${selection.primary.label} (score ${selection.primary.score}, ${selection.primary.results_validity} validity).`,
    );
  }
  for (const w of selection.advisory_warnings) {
    audit = addWarning(audit, w);
  }

  const lines: string[] = [];
  lines.push(
    `# RWE Method Selection — ${humanise(input.research_objective)}`,
  );
  lines.push("");
  lines.push(
    `**Decision context:** ${humanise(input.decision_context)} · **Rigour required:** ${humanise(input.rigor_required)} · **Data declared:** ${input.available_data.length ? input.available_data.map(humanise).join(", ") : "none"}`,
  );
  lines.push("");

  if (selection.primary) {
    lines.push(`## Recommended method: ${selection.primary.label}`);
    lines.push("");
    lines.push(selection.primary.rationale);
    lines.push("");
    const p = profileFor(selection.primary.method);
    lines.push(`- **Source:** ${p.source}`);
    lines.push(`- **Methodology:** ${p.methodology}`);
    lines.push(`- **Inclusion criteria:** ${p.inclusion_criteria}`);
    lines.push(
      `- **Results validity:** ${p.results_validity} — ${p.results_validity_note}`,
    );
    lines.push(`- **Decision support:** ${p.decision_support}`);
    lines.push(`- **Common use:** ${p.common_use}`);
    if (selection.primary.pairs_with_tools.length) {
      lines.push(
        `- **Operationalise with:** ${selection.primary.pairs_with_tools.map((t) => `\`${t}\``).join(", ")}`,
      );
    }
    lines.push("");
  } else {
    lines.push("## No feasible method");
    lines.push(
      "No method is feasible with the declared data sources. See warnings below.",
    );
    lines.push("");
  }

  if (selection.advisory_warnings.length) {
    lines.push("## ⚠️ Advisory");
    for (const w of selection.advisory_warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  if (selection.alternatives.length) {
    lines.push("## Alternatives (ranked)");
    lines.push("| Method | Score | Validity | Feasible | Operationalise with |");
    lines.push("|--------|-------|----------|----------|---------------------|");
    for (const a of selection.alternatives) {
      lines.push(
        `| ${a.label} | ${a.score} | ${a.results_validity} | ${a.feasible ? "✅" : "❌"} | ${a.pairs_with_tools.map((t) => `\`${t}\``).join(", ") || "—"} |`,
      );
    }
    lines.push("");
  }

  if (selection.infeasible.length) {
    lines.push("## Excluded — required data not available");
    for (const i of selection.infeasible) {
      const p = profileFor(i.method);
      lines.push(
        `- **${i.label}** — requires ${p.requires_any_data.map(humanise).join(" or ")}.`,
      );
    }
    lines.push("");
  }

  lines.push("## Method comparison matrix");
  lines.push(
    "| Method | Source | Results validity | Common use |",
  );
  lines.push("|--------|--------|------------------|------------|");
  for (const m of [
    "retrospective_database_analysis",
    "literature_review",
    "chart_review",
    "survey",
    "social_media_listening",
  ] as const) {
    const p = profileFor(m);
    lines.push(
      `| ${p.label} | ${p.source} | ${p.results_validity} | ${p.common_use} |`,
    );
  }
  lines.push("");

  lines.push("## References");
  lines.push(
    "- ISPOR/ISPE Good Procedural Practices for Real-World Evidence (Berger et al. 2017, *Value in Health*)",
  );
  lines.push(
    "- FDA Framework for Real-World Evidence Program (2018) + RWE guidance series (2021–2024)",
  );
  lines.push(
    "- EMA / HMA Big Data and RWE guidance; ENCePP methodological standards",
  );
  lines.push("");
  lines.push(
    auditToMarkdown(audit, {
      disclosure: { level: extractDisclosureLevel(rawInput, "standard") },
    }),
  );

  return {
    content: lines.join("\n"),
    audit,
    rwe_method_selection: selection,
  } as ToolResult & { rwe_method_selection: RweMethodSelection };
}

function humanise(s: string): string {
  return s.replace(/_/g, " ");
}

export const rweMethodSelectToolSchema = {
  name: "rwe.method_select",
  description:
    "Select an appropriate real-world-evidence (RWE) study design for a research question. Ranks the five core RWE methodologies — retrospective database analysis, survey, literature review, chart review, social-media listening — against your research objective, the data you can access, the decision context (HTA/payer, regulatory, clinical guideline, internal strategy, exploratory), and the rigour required (exploratory / supportive / submission-grade). Returns a primary recommendation + ranked alternatives, each with its results-validity tier, bias caveats, and the downstream tools in this server that operationalise it (e.g. literature.search, pv.signal_workflow, evidence.population_adjusted). Flags when no feasible method can meet the requested rigour and suggests triangulation across complementary designs. Pure decision logic, <200ms, no external calls. Enum values are case-insensitive.",
  annotations: {
    title: "RWE Method Selection",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      research_objective: {
        type: "string",
        enum: RESEARCH_OBJECTIVES,
        description: "The primary research question type.",
      },
      available_data: {
        type: "array",
        items: { type: "string", enum: DATA_SOURCES },
        default: [],
        description:
          "Data sources you can access. Leave empty if unknown — feasibility will be flagged as unconfirmed rather than excluding methods.",
      },
      decision_context: {
        type: "string",
        enum: DECISION_CONTEXTS,
        default: "internal_strategy",
      },
      rigor_required: {
        type: "string",
        enum: RIGOR_LEVELS,
        default: "supportive",
      },
      ai_disclosure_level: {
        type: "string",
        enum: ["off", "standard", "submission"],
        description:
          'AI assistance disclosure level. "off" = no disclosure; "standard" = default (model/tools/sources/date + human-review reminder); "submission" = adds ISPOR ELEVATE-GenAI citation. Default is tool-specific.',
      },
    },
    required: ["research_objective"],
  },
} as const;
