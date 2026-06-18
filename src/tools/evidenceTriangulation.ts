/**
 * evidence.triangulation — per-outcome RCT-vs-RWE concordance synthesis.
 *
 * Takes, for each outcome, what the randomised trials show and what
 * real-world evidence shows, and classifies whether they agree — and if
 * the real-world effect is larger (long-term use, broad populations) or
 * smaller (efficacy–effectiveness gap). Produces a per-outcome concordance
 * table + key messages + an overall triangulation statement, the
 * "literature review of RCTs and RWE, key message per relevant outcome"
 * deliverable. Pure logic, no I/O. See design log #18.
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
import { triangulate } from "../triangulation/concordance.js";
import type { TriangulationResult } from "../triangulation/types.js";
import type { ToolResult } from "../providers/types.js";

export type { TriangulationResult } from "../triangulation/types.js";

const BENEFIT_DIRECTIONS = ["lower_is_better", "higher_is_better"] as const;
const FAVORS = ["intervention", "comparator", "no_difference"] as const;

const EvidenceBodySchema = z.object({
  favors: caseInsensitiveEnum(FAVORS),
  effect_estimate: z.number().optional(),
  effect_measure: z.string().optional(),
  n_studies: z.number().int().nonnegative().optional(),
  n_patients: z.number().int().nonnegative().optional(),
  summary: z.string().optional(),
});

const OutcomeSchema = z
  .object({
    name: z.string().min(1),
    benefit_direction: caseInsensitiveEnum(BENEFIT_DIRECTIONS),
    rct: EvidenceBodySchema.optional(),
    rwe: EvidenceBodySchema.optional(),
  })
  .refine((o) => o.rct || o.rwe, {
    message: "each outcome needs at least one of rct or rwe",
  });

const EvidenceTriangulationSchema = z
  .object({
    intervention: z.string().min(1, "intervention is required"),
    indication: z.string().min(1, "indication is required"),
    outcomes: z.array(OutcomeSchema).min(1, "supply at least one outcome"),
    magnitude_tolerance: z.number().min(0).max(1).default(0.15),
  })
  .strict();

export async function handleEvidenceTriangulation(
  rawInput: unknown,
): Promise<ToolResult> {
  const parsed = EvidenceTriangulationSchema.safeParse(rawInput);
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
    "evidence.triangulation",
    input as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "Per-outcome RCT-vs-RWE concordance. Verdict from the two evidence bodies' direction of benefit; magnitude comparison (larger/smaller real-world effect) when both supply a point estimate on the same effect measure, sign-normalised by benefit direction. Triangulation framing per the efficacy–effectiveness gap literature and ISPOR RWE good-practice guidance; RWE treated as complementary to, not a substitute for, RCTs.",
  );

  const result = triangulate(input);

  audit = addAssumption(
    audit,
    `${result.summary.total} outcomes triangulated: ${result.summary.concordant} concordant, ${result.summary.discordant} discordant, ${result.summary.single_source} single-source.`,
  );
  for (const w of result.warnings) audit = addWarning(audit, w);

  const lines: string[] = [];
  lines.push(
    `# RCT vs RWE Triangulation — ${input.intervention} (${input.indication})`,
  );
  lines.push("");
  lines.push(`**Overall:** ${result.overall_message}`);
  lines.push("");

  // Concordance table.
  lines.push("## Per-outcome concordance");
  lines.push("| Outcome | RCT favours | RWE favours | Magnitude | Verdict |");
  lines.push("|---------|-------------|-------------|-----------|---------|");
  for (const o of result.outcomes) {
    lines.push(
      `| ${o.name} | ${o.rct_favors ?? "—"} | ${o.rwe_favors ?? "—"} | ${humanMagnitude(o.magnitude)} | ${badge(o.verdict)} |`,
    );
  }
  lines.push("");

  // Key messages per outcome (the slide's right-hand column).
  lines.push("## Key message per outcome");
  for (const o of result.outcomes) {
    lines.push(`### ${o.name}`);
    lines.push(o.key_message);
    const rctIn = input.outcomes.find((x) => x.name === o.name);
    if (rctIn?.rct?.summary) lines.push(`- **RCT:** ${rctIn.rct.summary}`);
    if (rctIn?.rwe?.summary) lines.push(`- **RWE:** ${rctIn.rwe.summary}`);
    for (const c of o.caveats) lines.push(`- ⚠️ ${c}`);
    lines.push("");
  }

  lines.push("## Summary");
  lines.push(
    `- Concordant: **${result.summary.concordant}/${result.summary.total}**`,
  );
  lines.push(`- Larger effect in RWE: **${result.summary.larger_in_rwe}**`);
  lines.push(
    `- Smaller effect in RWE (efficacy–effectiveness gap): **${result.summary.smaller_in_rwe}**`,
  );
  lines.push(`- Discordant: **${result.summary.discordant}**`);
  lines.push(`- Single-source (no triangulation): **${result.summary.single_source}**`);
  lines.push("");

  if (result.warnings.length) {
    lines.push("## ⚠️ Interpretation caveats");
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  lines.push("## References");
  lines.push(
    "- ISPOR/ISPE Good Procedural Practices for Real-World Evidence (Berger et al. 2017)",
  );
  lines.push(
    "- Efficacy–effectiveness gap literature (Eichler et al. 2011, *Nat Rev Drug Discov*)",
  );
  lines.push("- FDA Framework for Real-World Evidence Program (2018)");
  lines.push("");
  lines.push(
    auditToMarkdown(audit, {
      disclosure: { level: extractDisclosureLevel(rawInput, "submission") },
    }),
  );

  return {
    content: lines.join("\n"),
    audit,
    triangulation: result,
  } as ToolResult & { triangulation: TriangulationResult };
}

function humanMagnitude(m: string): string {
  switch (m) {
    case "larger_in_rwe":
      return "larger in RWE";
    case "smaller_in_rwe":
      return "smaller in RWE";
    case "similar":
      return "similar";
    default:
      return "—";
  }
}

function badge(verdict: string): string {
  switch (verdict) {
    case "concordant":
      return "✅ concordant";
    case "concordant_larger_in_rwe":
      return "✅ concordant (larger in RWE)";
    case "concordant_smaller_in_rwe":
      return "✅ concordant (smaller in RWE)";
    case "partially_concordant":
      return "🟡 partial";
    case "discordant":
      return "❌ discordant";
    case "rct_only":
      return "RCT only";
    case "rwe_only":
      return "RWE only";
    default:
      return "no evidence";
  }
}

export const evidenceTriangulationToolSchema = {
  name: "evidence.triangulation",
  description:
    "Triangulate RCT vs real-world evidence per outcome. For each outcome supply what the randomised trials show (rct) and what real-world evidence shows (rwe) — each as a direction of benefit (favors: intervention/comparator/no_difference) plus an optional point estimate + measure. The tool classifies concordance (concordant / discordant / partial / single-source), and when both bodies give an estimate on the SAME measure, whether the real-world effect is LARGER (long-term use, broad heterogeneous populations) or SMALLER (efficacy–effectiveness gap) — sign-normalised by benefit_direction so 'larger' always means more benefit. Returns a per-outcome concordance table, a key message per outcome, an overall triangulation statement, and a concordance summary. Use to build the 'literature review of RCTs and RWE — key message per relevant outcome' section of a dossier, or to pressure-test whether RWE corroborates trial efficacy before a submission. RWE is treated as complementary to, not a substitute for, RCTs. Pure logic, no external calls; enum values case-insensitive.",
  annotations: {
    title: "RCT vs RWE Triangulation",
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
      magnitude_tolerance: {
        type: "number",
        minimum: 0,
        maximum: 1,
        default: 0.15,
        description:
          "Relative tolerance for calling two effect estimates 'similar' (0.15 = within 15%).",
      },
      outcomes: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "e.g. 'Monthly Migraine Days (MMD)'.",
            },
            benefit_direction: {
              type: "string",
              enum: BENEFIT_DIRECTIONS,
              description:
                "Whether a LOWER or HIGHER effect estimate means patient benefit (e.g. migraine days = lower_is_better; responder rate = higher_is_better).",
            },
            rct: {
              type: "object",
              description: "Randomised-trial evidence for this outcome.",
              properties: {
                favors: { type: "string", enum: FAVORS },
                effect_estimate: { type: "number" },
                effect_measure: {
                  type: "string",
                  description: "e.g. MD, SMD, RR, OR, HR, %.",
                },
                n_studies: { type: "number" },
                n_patients: { type: "number" },
                summary: { type: "string" },
              },
              required: ["favors"],
            },
            rwe: {
              type: "object",
              description: "Real-world evidence for this outcome.",
              properties: {
                favors: { type: "string", enum: FAVORS },
                effect_estimate: { type: "number" },
                effect_measure: { type: "string" },
                n_studies: { type: "number" },
                n_patients: { type: "number" },
                summary: { type: "string" },
              },
              required: ["favors"],
            },
          },
          required: ["name", "benefit_direction"],
        },
      },
      ai_disclosure_level: {
        type: "string",
        enum: ["off", "standard", "submission"],
        description:
          'AI assistance disclosure level. "off" = no disclosure; "standard" = default; "submission" = adds ISPOR ELEVATE-GenAI citation.',
      },
    },
    required: ["intervention", "indication", "outcomes"],
  },
} as const;
