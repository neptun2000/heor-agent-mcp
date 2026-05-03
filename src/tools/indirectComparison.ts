import { z } from "zod";
import type { ToolResult } from "../providers/types.js";
import type {
  DirectComparison,
  IndirectComparisonResult,
  HeterogeneitySummary,
} from "../network/types.js";
import { findIndirectPaths } from "../network/pathfinder.js";
import { computeIndirectComparison } from "../network/bucher.js";
import { frequentistNMA } from "../network/frequentistNma.js";
import { computeHeterogeneity } from "../network/heterogeneity.js";
import { comparisonToMarkdown } from "../formatters/comparisonMarkdown.js";
import { createAuditRecord, setMethodology } from "../audit/builder.js";

const DirectComparisonSchema = z.object({
  intervention: z.string().describe("Treatment name (e.g., 'Semaglutide')"),
  comparator: z.string().describe("Comparator name (e.g., 'Placebo')"),
  outcome: z.string().describe("Outcome measured (e.g., 'HbA1c change')"),
  measure: z
    .enum(["MD", "OR", "RR", "HR"])
    .describe(
      "Effect measure: MD (mean difference), OR (odds ratio), RR (risk ratio), HR (hazard ratio)",
    ),
  estimate: z.number().describe("Point estimate"),
  ci_lower: z.number().describe("Lower bound of 95% CI"),
  ci_upper: z.number().describe("Upper bound of 95% CI"),
  source: z.string().describe("Trial or study name (e.g., 'SUSTAIN-1')"),
});

const IndirectComparisonSchema = z.object({
  comparisons: z
    .array(DirectComparisonSchema)
    .min(2)
    .max(100)
    .describe(
      "Array of direct comparisons with effect sizes. Need at least 2 comparisons sharing a common comparator.",
    ),
  target: z
    .object({
      intervention: z.string(),
      comparator: z.string(),
    })
    .optional()
    .describe(
      "Specific comparison to compute. If omitted, all possible indirect comparisons are computed.",
    ),
  method: z
    .enum(["auto", "bucher", "frequentist_nma"])
    .optional()
    .describe(
      "Method: 'auto' (default) selects based on network structure, 'bucher' for simple A-B-C paths, 'frequentist_nma' for full network analysis.",
    ),
});

const LIMITATIONS = [
  "Transitivity assumption: populations across trials must be similar enough for the common comparator to act as a valid bridge",
  "Fixed-effect model: does not account for between-study heterogeneity beyond sampling error",
  "Indirect comparisons are always less precise (wider CIs) than direct head-to-head evidence",
  "Consistency check (direct vs indirect when h2h available) flags violations only — interpretation requires examining trial population differences for effect-modifier imbalance",
  "User-supplied data: accuracy depends on correctly entered effect sizes and confidence intervals",
];

export async function handleIndirectComparison(
  rawParams: unknown,
): Promise<ToolResult> {
  const params = IndirectComparisonSchema.parse(rawParams);
  const comparisons = params.comparisons as DirectComparison[];
  const methodPref = params.method ?? "auto";

  let audit = createAuditRecord(
    "evidence.indirect",
    {
      n_comparisons: comparisons.length,
      method: methodPref,
      target: params.target,
    },
    "text",
  );
  audit = setMethodology(
    audit,
    "Indirect treatment comparison (Bucher method / Frequentist NMA)",
  );

  // Determine method
  const treatments = new Set<string>();
  for (const c of comparisons) {
    treatments.add(c.intervention.toLowerCase());
    treatments.add(c.comparator.toLowerCase());
  }
  const nTreatments = treatments.size;

  // Group by outcome
  const outcomes = new Set(comparisons.map((c) => c.outcome));
  const allEstimates: IndirectComparisonResult["estimates"] = [];
  const warnings: string[] = [];
  let methodUsed: "bucher" | "frequentist_nma" | "mixed" = "bucher";

  for (const outcome of outcomes) {
    const outcomeComparisons = comparisons.filter((c) => c.outcome === outcome);
    const measures = new Set(outcomeComparisons.map((c) => c.measure));

    for (const measure of measures) {
      const measureComparisons = outcomeComparisons.filter(
        (c) => c.measure === measure,
      );

      // Count unique edges for this outcome+measure
      const edges = new Set(
        measureComparisons.map((c) =>
          [c.intervention, c.comparator]
            .map((s) => s.toLowerCase())
            .sort()
            .join("↔"),
        ),
      );

      const useNMA =
        methodPref === "frequentist_nma" ||
        (methodPref === "auto" && edges.size >= 3 && nTreatments >= 3);

      if (useNMA) {
        const nmaEstimates = frequentistNMA(
          measureComparisons,
          outcome,
          measure,
        );
        allEstimates.push(...nmaEstimates);
        if (methodUsed === "bucher" && allEstimates.length > 0) {
          methodUsed = "frequentist_nma";
        }
      } else {
        // Bucher: find paths and compute
        const paths = findIndirectPaths(measureComparisons, params.target);

        if (paths.length === 0 && !params.target) {
          warnings.push(
            `No indirect paths found for outcome "${outcome}" (${measure}). Ensure comparisons share a common comparator.`,
          );
        }

        for (const path of paths) {
          try {
            // Find any direct A-vs-C h2h evidence for the consistency check
            const directAC = measureComparisons.filter((c) => {
              const i = c.intervention.toLowerCase();
              const j = c.comparator.toLowerCase();
              const a = path.a.toLowerCase();
              const cc = path.c.toLowerCase();
              return (i === a && j === cc) || (i === cc && j === a);
            });
            const est = computeIndirectComparison(
              path.a,
              path.c,
              path.bridge,
              path.abComparisons,
              path.bcComparisons,
              outcome,
              measure,
              directAC.length > 0 ? directAC : undefined,
            );
            allEstimates.push(est);
            // Surface conflict warnings to the audit trail
            if (
              est.consistency_check?.has_conflict &&
              est.consistency_check.severity === "substantial"
            ) {
              warnings.push(
                `⚠️ Consistency violation for ${path.a} vs ${path.c}: ${est.consistency_check.rationale}`,
              );
            }
          } catch (err) {
            warnings.push(
              `Failed to compute ${path.a} vs ${path.c} via ${path.bridge}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    }
  }

  if (
    methodUsed === "bucher" &&
    allEstimates.some((e) => e.method === "frequentist_nma")
  ) {
    methodUsed = "mixed";
  }

  // Per-comparison heterogeneity across studies sharing the same edge + outcome + measure
  const heterogeneity: HeterogeneitySummary[] = [];
  const groupMap = new Map<string, DirectComparison[]>();
  for (const c of comparisons) {
    const key = [c.intervention.toLowerCase(), c.comparator.toLowerCase()]
      .sort()
      .concat([c.outcome, c.measure])
      .join("||");
    const arr = groupMap.get(key) ?? [];
    arr.push(c);
    groupMap.set(key, arr);
  }
  for (const [key, group] of groupMap) {
    if (group.length < 2) continue;
    const [, , outcome, measure] = key.split("||");
    const effects = group.map((c) => {
      const logScale =
        c.measure === "OR" || c.measure === "RR" || c.measure === "HR";
      const y = logScale ? Math.log(c.estimate) : c.estimate;
      const se = logScale
        ? (Math.log(c.ci_upper) - Math.log(c.ci_lower)) / (2 * 1.96)
        : (c.ci_upper - c.ci_lower) / (2 * 1.96);
      return { estimate: y, se: Math.max(se, 1e-9) };
    });
    const h = computeHeterogeneity(effects);
    const label = `${group[0].intervention} vs ${group[0].comparator} (${outcome}, ${measure})`;
    heterogeneity.push({
      comparison_label: label,
      n_studies: h.n_studies,
      cochran_q: h.cochran_q,
      df: h.df,
      p_value: h.p_value,
      i_squared_pct: h.i_squared_pct,
      tau_squared: h.tau_squared,
      interpretation: h.interpretation,
      interpretation_band: h.interpretation_band,
    });
  }

  const result: IndirectComparisonResult = {
    estimates: allEstimates,
    method: methodUsed,
    warnings,
    limitations: LIMITATIONS,
    heterogeneity: heterogeneity.length > 0 ? heterogeneity : undefined,
  };

  const markdown = comparisonToMarkdown(result);

  return { content: markdown, audit };
}

export const indirectComparisonToolSchema = {
  name: "evidence.indirect",
  description:
    "Compute indirect treatment comparisons using the Bucher method (single common comparator) or frequentist network meta-analysis (full network). Requires user-supplied effect sizes (point estimates + 95% CI) from published trials. Supports MD, OR, RR, HR. Auto-selects method by network structure. When direct head-to-head A-vs-C evidence is also in the network, automatically tests Bucher's consistency assumption (z = (direct − indirect) / SE_diff) per NICE DSU TSD 18 / Cochrane 11.4.3 — flags |z|≥1.96 as 'substantial inconsistency' so the agent can warn the user before relying on the indirect estimate.",
  annotations: {
    title: "Indirect Treatment Comparison",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      comparisons: {
        type: "array",
        items: {
          type: "object",
          properties: {
            intervention: {
              type: "string",
              description: "Treatment name",
            },
            comparator: {
              type: "string",
              description: "Comparator name",
            },
            outcome: {
              type: "string",
              description: "Outcome (e.g., 'HbA1c change')",
            },
            measure: {
              type: "string",
              enum: ["MD", "OR", "RR", "HR"],
              description:
                "MD = mean difference, OR = odds ratio, RR = risk ratio, HR = hazard ratio",
            },
            estimate: {
              type: "number",
              description: "Point estimate",
            },
            ci_lower: {
              type: "number",
              description: "Lower 95% CI",
            },
            ci_upper: {
              type: "number",
              description: "Upper 95% CI",
            },
            source: {
              type: "string",
              description: "Trial name (e.g., 'SUSTAIN-1')",
            },
          },
          required: [
            "intervention",
            "comparator",
            "outcome",
            "measure",
            "estimate",
            "ci_lower",
            "ci_upper",
            "source",
          ],
        },
        description:
          "Direct comparisons with effect sizes. Need at least 2 sharing a common comparator. Ask the user for: point estimate, 95% CI, outcome name, and effect measure (MD/OR/RR/HR) from each trial.",
      },
      target: {
        type: "object",
        description:
          "Optional: specific comparison to compute. Omit to compute all possible pairwise comparisons.",
        properties: {
          intervention: {
            type: "string",
            description: "Treatment to be compared (numerator).",
          },
          comparator: {
            type: "string",
            description: "Reference treatment (denominator).",
          },
        },
      },
      method: {
        type: "string",
        enum: ["auto", "bucher", "frequentist_nma"],
        description:
          "auto (default): Bucher for simple paths, Frequentist NMA for 3+ edges. Or force a specific method.",
      },
    },
    required: ["comparisons"],
  },
};
