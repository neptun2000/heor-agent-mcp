import { z } from "zod";
import type { ToolResult } from "../providers/types.js";
import type {
  DirectComparison,
  IndirectComparisonResult,
} from "../network/types.js";
import { findIndirectPaths } from "../network/pathfinder.js";
import { computeIndirectComparison } from "../network/bucher.js";
import { frequentistNMA } from "../network/frequentistNma.js";
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
  "No inconsistency testing: when both direct and indirect evidence exist, this tool does not test whether they agree",
  "User-supplied data: accuracy depends on correctly entered effect sizes and confidence intervals",
];

export async function handleIndirectComparison(
  rawParams: unknown,
): Promise<ToolResult> {
  const params = IndirectComparisonSchema.parse(rawParams);
  const comparisons = params.comparisons as DirectComparison[];
  const methodPref = params.method ?? "auto";

  let audit = createAuditRecord(
    "indirect_comparison",
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
            const est = computeIndirectComparison(
              path.a,
              path.c,
              path.bridge,
              path.abComparisons,
              path.bcComparisons,
              outcome,
              measure,
            );
            allEstimates.push(est);
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

  const result: IndirectComparisonResult = {
    estimates: allEstimates,
    method: methodUsed,
    warnings,
    limitations: LIMITATIONS,
  };

  const markdown = comparisonToMarkdown(result);

  return { content: markdown, audit };
}

export const indirectComparisonToolSchema = {
  name: "indirect_comparison",
  description:
    "Compute indirect treatment comparisons using the Bucher method (single common comparator) or frequentist network meta-analysis (full network). Requires user-supplied effect sizes (point estimates + 95% CI) from published trials. Supports mean differences (MD) and ratio measures (OR, RR, HR). Auto-selects method based on network structure, or user can specify.",
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
        properties: {
          intervention: { type: "string" },
          comparator: { type: "string" },
        },
        description:
          "Specific comparison to compute. Omit to compute all possible.",
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
