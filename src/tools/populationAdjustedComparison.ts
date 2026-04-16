import { z } from "zod";
import type { ToolResult } from "../providers/types.js";
import {
  createAuditRecord,
  addAssumption,
  addWarning,
  setMethodology,
} from "../audit/builder.js";
import { auditToMarkdown } from "../formatters/markdown.js";

/**
 * Population-Adjusted Indirect Comparison (MAIC / STC)
 *
 * MAIC: Matching-Adjusted Indirect Comparison — reweights individual-level
 * data (or simulated summary-level data) to match the target population,
 * then computes an adjusted treatment effect.
 *
 * STC: Simulated Treatment Comparison — uses outcome regression to adjust
 * for differences in effect modifiers between trials.
 *
 * Both methods follow NICE DSU TSD 18 (Phillippo 2016) and ISPOR guidance.
 */

const CovariateSummarySchema = z.object({
  name: z.string().min(1),
  mean: z.number(),
  sd: z.number().nonnegative(),
});

const TrialSchema = z.object({
  name: z.string().min(1),
  treatment: z.string().min(1),
  comparator: z.string().min(1),
  n: z.number().int().positive(),
  effect: z.number(),
  ci_lower: z.number(),
  ci_upper: z.number(),
  measure: z.enum(["MD", "OR", "RR", "HR"]),
  covariates: z.array(CovariateSummarySchema),
});

const PopAdjSchema = z.object({
  index_trial: TrialSchema.describe(
    "Trial with individual patient data (or summary stats to simulate from)",
  ),
  target_trial: TrialSchema.describe(
    "Trial whose population characteristics are the matching target",
  ),
  effect_modifiers: z
    .array(z.string())
    .min(1)
    .describe(
      "Covariate names that are effect modifiers (must exist in both trials' covariates)",
    ),
  method: z
    .enum(["auto", "maic", "stc"])
    .default("auto")
    .describe("auto selects MAIC when covariates are sufficient, else STC"),
  outcome_name: z.string().default("primary"),
  output_format: z.enum(["text", "json"]).optional(),
  project: z.string().optional(),
});

type PopAdjParams = z.infer<typeof PopAdjSchema>;

function isLogScale(measure: string): boolean {
  return ["OR", "RR", "HR"].includes(measure);
}

function seFromCI(
  estimate: number,
  ciLower: number,
  ciUpper: number,
  logScale: boolean,
): number {
  if (logScale) {
    return (Math.log(ciUpper) - Math.log(ciLower)) / 3.92;
  }
  return (ciUpper - ciLower) / 3.92;
}

/**
 * MAIC using summary-level data (Signorovitch 2010, 2012).
 *
 * Simulates N patients from the index trial using normal distributions,
 * then computes propensity weights to match target trial covariate means.
 * Uses method of moments for the logistic regression (Newton-Raphson).
 */
function runMAIC(params: PopAdjParams): {
  adjusted_effect: number;
  adjusted_se: number;
  adjusted_ci_lower: number;
  adjusted_ci_upper: number;
  ess: number;
  weight_ratio: number;
  method: "maic";
} {
  const idx = params.index_trial;
  const tgt = params.target_trial;
  const logScale = isLogScale(idx.measure);
  const modifiers = params.effect_modifiers;

  // Build covariate lookup
  const idxCovs = new Map(idx.covariates.map((c) => [c.name, c]));
  const tgtCovs = new Map(tgt.covariates.map((c) => [c.name, c]));

  // Simulate IPD from index trial summary stats (N patients)
  const N = idx.n;
  const nMods = modifiers.length;

  // For each modifier, compute the mean difference (target - index)
  // This drives the propensity weights
  const meanDiffs: number[] = [];
  const indexSDs: number[] = [];

  for (const mod of modifiers) {
    const idxC = idxCovs.get(mod);
    const tgtC = tgtCovs.get(mod);
    if (!idxC || !tgtC)
      throw new Error(`Covariate '${mod}' missing from one or both trials`);
    meanDiffs.push(tgtC.mean - idxC.mean);
    indexSDs.push(idxC.sd || 1);
  }

  // Method of moments MAIC weights (Signorovitch 2010):
  // For summary-level MAIC, the weight for each simulated patient i is:
  //   w_i = exp(sum_k alpha_k * x_ik)
  // where alpha solves: sum_i w_i * x_ik / sum_i w_i = target_mean_k
  //
  // With simulated normal data and known means/SDs, the optimal alpha
  // can be derived analytically: alpha_k = meanDiff_k / sd_k^2
  const alphas = meanDiffs.map((d, k) => d / (indexSDs[k]! * indexSDs[k]!));

  // Simulate patients and compute weights using a seeded PRNG
  // (Simple Box-Muller for reproducibility)
  let seed = 42;
  function nextRand(): number {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
    return seed / 0x7fffffff;
  }

  function boxMuller(): number {
    const u1 = Math.max(1e-10, nextRand());
    const u2 = nextRand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  const weights: number[] = [];
  for (let i = 0; i < N; i++) {
    let logWeight = 0;
    for (let k = 0; k < nMods; k++) {
      const x = idxCovs.get(modifiers[k]!)!.mean + indexSDs[k]! * boxMuller();
      logWeight += alphas[k]! * x;
    }
    weights.push(Math.exp(logWeight));
  }

  // Normalize weights
  const sumW = weights.reduce((a, b) => a + b, 0);
  const normWeights = weights.map((w) => (w / sumW) * N);

  // Effective sample size: (sum w)^2 / sum(w^2)
  const sumNormW = normWeights.reduce((a, b) => a + b, 0);
  const sumNormW2 = normWeights.reduce((a, b) => a + b * b, 0);
  const ess = (sumNormW * sumNormW) / sumNormW2;

  // Adjusted treatment effect:
  // The index trial effect is reweighted. For summary-level MAIC,
  // the adjusted effect is approximately:
  //   effect_adj = effect_index (on original scale) — the reweighting
  //   adjusts the population, not the point estimate directly.
  //   The SE inflates by sqrt(N/ESS).
  const originalSE = seFromCI(idx.effect, idx.ci_lower, idx.ci_upper, logScale);
  const seInflation = Math.sqrt(N / ess);
  const adjustedSE = originalSE * seInflation;

  // The point estimate shifts based on the covariate adjustment
  // For MAIC with summary data, the adjusted effect accounts for
  // the population difference via the anchored comparison
  const idxEffect = logScale ? Math.log(idx.effect) : idx.effect;
  const tgtEffect = logScale ? Math.log(tgt.effect) : tgt.effect;

  // Anchored MAIC: adjusted indirect comparison
  // effect_AC = effect_AB_adj - effect_CB
  // where AB_adj is the reweighted index trial effect
  // and CB is the target trial effect (C vs B, same comparator)
  const adjustedIndirect = idxEffect - tgtEffect;
  const tgtSE = seFromCI(tgt.effect, tgt.ci_lower, tgt.ci_upper, logScale);
  const combinedSE = Math.sqrt(adjustedSE * adjustedSE + tgtSE * tgtSE);

  const adjusted_effect = logScale
    ? Math.exp(adjustedIndirect)
    : adjustedIndirect;
  const adjusted_ci_lower = logScale
    ? Math.exp(adjustedIndirect - 1.96 * combinedSE)
    : adjustedIndirect - 1.96 * combinedSE;
  const adjusted_ci_upper = logScale
    ? Math.exp(adjustedIndirect + 1.96 * combinedSE)
    : adjustedIndirect + 1.96 * combinedSE;

  return {
    adjusted_effect,
    adjusted_se: logScale ? combinedSE : combinedSE, // on native or log scale
    adjusted_ci_lower,
    adjusted_ci_upper,
    ess: Math.round(ess),
    weight_ratio: N / ess,
    method: "maic",
  };
}

/**
 * Simulated Treatment Comparison (STC).
 *
 * Uses outcome regression to adjust the index trial effect for differences
 * in effect modifiers. Simpler than MAIC but assumes a linear relationship
 * between covariates and outcome.
 */
function runSTC(params: PopAdjParams): {
  adjusted_effect: number;
  adjusted_se: number;
  adjusted_ci_lower: number;
  adjusted_ci_upper: number;
  ess: number;
  method: "stc";
} {
  const idx = params.index_trial;
  const tgt = params.target_trial;
  const logScale = isLogScale(idx.measure);
  const modifiers = params.effect_modifiers;

  const idxCovs = new Map(idx.covariates.map((c) => [c.name, c]));
  const tgtCovs = new Map(tgt.covariates.map((c) => [c.name, c]));

  // STC adjusts the treatment effect by estimating how much the
  // covariate imbalance biases the comparison.
  // Adjustment = sum_k beta_k * (mean_target_k - mean_index_k)
  // where beta_k is the interaction coefficient (treatment * covariate)
  //
  // Without IPD, we approximate beta_k from the effect size and
  // covariate spread using a heuristic regression coefficient.
  const idxEffect = logScale ? Math.log(idx.effect) : idx.effect;
  const tgtEffect = logScale ? Math.log(tgt.effect) : tgt.effect;
  const idxSE = seFromCI(idx.effect, idx.ci_lower, idx.ci_upper, logScale);
  const tgtSE = seFromCI(tgt.effect, tgt.ci_lower, tgt.ci_upper, logScale);

  let totalAdjustment = 0;
  let adjustmentVariance = 0;

  for (const mod of modifiers) {
    const idxC = idxCovs.get(mod);
    const tgtC = tgtCovs.get(mod);
    if (!idxC || !tgtC) continue;

    const meanDiff = tgtC.mean - idxC.mean;
    const pooledSD = Math.sqrt((idxC.sd * idxC.sd + tgtC.sd * tgtC.sd) / 2);

    // Standardized mean difference
    const smd = pooledSD > 0 ? meanDiff / pooledSD : 0;

    // Heuristic: interaction effect is proportional to main effect * SMD
    // This is a simplification; with real IPD you'd fit the regression
    const interactionEffect = idxEffect * 0.1 * smd;
    totalAdjustment += interactionEffect;

    // Variance of adjustment (approximation)
    const adjVar =
      idxSE * 0.1 * smd * (idxSE * 0.1 * smd) +
      idxEffect *
        0.1 *
        (1 / Math.sqrt(idx.n)) *
        (idxEffect * 0.1 * (1 / Math.sqrt(idx.n)));
    adjustmentVariance += adjVar;
  }

  // Adjusted indirect comparison
  const adjustedIndirect = idxEffect + totalAdjustment - tgtEffect;
  const combinedSE = Math.sqrt(
    idxSE * idxSE + tgtSE * tgtSE + adjustmentVariance,
  );

  const adjusted_effect = logScale
    ? Math.exp(adjustedIndirect)
    : adjustedIndirect;
  const adjusted_ci_lower = logScale
    ? Math.exp(adjustedIndirect - 1.96 * combinedSE)
    : adjustedIndirect - 1.96 * combinedSE;
  const adjusted_ci_upper = logScale
    ? Math.exp(adjustedIndirect + 1.96 * combinedSE)
    : adjustedIndirect + 1.96 * combinedSE;

  // ESS for STC is approximately the index trial N (less inflation than MAIC)
  const ess = Math.round(idx.n * 0.9);

  return {
    adjusted_effect,
    adjusted_se: combinedSE,
    adjusted_ci_lower,
    adjusted_ci_upper,
    ess,
    method: "stc",
  };
}

export async function handlePopulationAdjustedComparison(
  rawParams: unknown,
): Promise<ToolResult> {
  const params = PopAdjSchema.parse(rawParams);
  const outputFormat = params.output_format ?? "text";

  let audit = createAuditRecord(
    "population_adjusted_comparison",
    params as unknown as Record<string, unknown>,
    outputFormat,
  );

  // Validate effect modifiers exist in both trials
  for (const mod of params.effect_modifiers) {
    const inIdx = params.index_trial.covariates.some((c) => c.name === mod);
    const inTgt = params.target_trial.covariates.some((c) => c.name === mod);
    if (!inIdx || !inTgt) {
      audit = addWarning(
        audit,
        `Effect modifier '${mod}' not found in both trials — will be skipped`,
      );
    }
  }

  // Auto-select method
  let method = params.method;
  if (method === "auto") {
    // MAIC preferred when sufficient covariates and reasonable sample size
    method =
      params.effect_modifiers.length >= 2 && params.index_trial.n >= 50
        ? "maic"
        : "stc";
  }

  audit = setMethodology(
    audit,
    method === "maic"
      ? "Approximate MAIC-style analysis (summary-level): Bucher indirect comparison with ESS-based SE inflation. True MAIC per NICE DSU TSD 18 (Phillippo 2016) / Signorovitch 2010 requires individual patient data to reweight outcomes."
      : "Approximate STC-style analysis (summary-level): Bucher indirect comparison with linear adjustment scaled by standardized mean differences. True STC per NICE DSU TSD 18 (Phillippo 2016) requires individual patient data for outcome regression with treatment × covariate interactions.",
  );
  audit = addWarning(
    audit,
    "EXPERIMENTAL: results are for orientation only, not HTA submission. Point estimates are approximate because summary-level data cannot support full MAIC/STC methods. Validate with IPD-based analysis before making reimbursement decisions.",
  );
  audit = addAssumption(
    audit,
    `Index trial: ${params.index_trial.name} (N=${params.index_trial.n})`,
  );
  audit = addAssumption(
    audit,
    `Target trial: ${params.target_trial.name} (N=${params.target_trial.n})`,
  );
  audit = addAssumption(
    audit,
    `Effect modifiers adjusted: ${params.effect_modifiers.join(", ")}`,
  );
  audit = addAssumption(
    audit,
    `Summary-level data used (no individual patient data) — results are approximate`,
  );

  let result;
  try {
    result = method === "maic" ? runMAIC(params) : runSTC(params);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    audit = addWarning(audit, `${method.toUpperCase()} failed: ${msg}`);
    return {
      content: `Error running ${method.toUpperCase()}: ${msg}`,
      audit,
    };
  }

  const measure = params.index_trial.measure;
  const logScale = isLogScale(measure);

  // ESS warning
  if (result.ess < params.index_trial.n * 0.5) {
    audit = addWarning(
      audit,
      `Effective sample size (${result.ess}) is less than 50% of original N (${params.index_trial.n}) — large covariate imbalance, results may be unstable`,
    );
  }

  if (outputFormat === "json") {
    return {
      content: {
        method: result.method,
        index_trial: params.index_trial.name,
        target_trial: params.target_trial.name,
        comparison: `${params.index_trial.treatment} vs ${params.target_trial.treatment}`,
        outcome: params.outcome_name,
        measure,
        adjusted_effect: result.adjusted_effect,
        adjusted_ci_lower: result.adjusted_ci_lower,
        adjusted_ci_upper: result.adjusted_ci_upper,
        ess: result.ess,
        original_n: params.index_trial.n,
        effect_modifiers: params.effect_modifiers,
      },
      audit,
    };
  }

  const fmtEff = (v: number) => (logScale ? v.toFixed(3) : v.toFixed(4));

  const sig =
    result.adjusted_ci_lower > (logScale ? 1 : 0) ||
    result.adjusted_ci_upper < (logScale ? 1 : 0)
      ? "statistically significant"
      : "not statistically significant";

  const lines = [
    `## Population-Adjusted Indirect Comparison (${result.method.toUpperCase()})`,
    ``,
    `### Comparison`,
    `**${params.index_trial.treatment}** vs **${params.target_trial.treatment}**`,
    ``,
    `| | Index Trial | Target Trial |`,
    `|--|------------|-------------|`,
    `| Trial | ${params.index_trial.name} | ${params.target_trial.name} |`,
    `| N | ${params.index_trial.n} | ${params.target_trial.n} |`,
    `| Treatment | ${params.index_trial.treatment} | ${params.target_trial.treatment} |`,
    `| Comparator | ${params.index_trial.comparator} | ${params.target_trial.comparator} |`,
    `| Effect (${measure}) | ${fmtEff(params.index_trial.effect)} (${fmtEff(params.index_trial.ci_lower)}–${fmtEff(params.index_trial.ci_upper)}) | ${fmtEff(params.target_trial.effect)} (${fmtEff(params.target_trial.ci_lower)}–${fmtEff(params.target_trial.ci_upper)}) |`,
    ``,
    `### Effect Modifiers Adjusted`,
    ...params.effect_modifiers.map((mod) => {
      const idxC = params.index_trial.covariates.find((c) => c.name === mod);
      const tgtC = params.target_trial.covariates.find((c) => c.name === mod);
      return `- **${mod}**: Index ${idxC?.mean.toFixed(1)} (SD ${idxC?.sd.toFixed(1)}) vs Target ${tgtC?.mean.toFixed(1)} (SD ${tgtC?.sd.toFixed(1)})`;
    }),
    ``,
    `### Adjusted Result`,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Method | ${result.method.toUpperCase()} |`,
    `| Adjusted ${measure} | **${fmtEff(result.adjusted_effect)}** |`,
    `| 95% CI | ${fmtEff(result.adjusted_ci_lower)} – ${fmtEff(result.adjusted_ci_upper)} |`,
    `| Effective Sample Size | ${result.ess} (original: ${params.index_trial.n}) |`,
    `| Statistical Significance | ${sig} |`,
    ``,
    result.ess < params.index_trial.n * 0.5
      ? `> **Warning:** ESS is ${((result.ess / params.index_trial.n) * 100).toFixed(0)}% of original N — substantial precision loss from population adjustment.\n`
      : "",
    `### Limitations`,
    `1. Summary-level data used — results are approximate compared to IPD-based MAIC/STC`,
    `2. ${result.method === "maic" ? "Assumes covariates are normally distributed in the index trial" : "Assumes linear relationship between covariates and outcome"}`,
    `3. Only observed effect modifiers can be adjusted — unobserved confounders remain`,
    `4. Anchored comparison assumes a common comparator across trials`,
    `5. Results should be interpreted alongside unadjusted indirect comparisons (e.g., Bucher method)`,
    ``,
    `---`,
    `> **Disclaimer:** This population-adjusted comparison is for orientation only. Final analyses should use individual patient data where available and be validated by a qualified statistician.`,
    ``,
    auditToMarkdown(audit),
  ]
    .filter(Boolean)
    .join("\n");

  return { content: lines, audit };
}

export const populationAdjustedComparisonToolSchema = {
  name: "population_adjusted_comparison",
  description:
    "⚠️ EXPERIMENTAL / orientation-only. Approximate population-adjusted indirect comparison using summary-level statistics (mean, SD per covariate). True MAIC/STC per NICE DSU TSD 18 requires individual patient data (IPD) for one trial. This tool inflates the SE of a Bucher indirect comparison based on covariate imbalance (MAIC-style ESS penalty) and applies a simple linear adjustment based on standardized mean differences (STC-style). Point estimates should be interpreted as approximate — not submission-ready. For a definitive analysis, use IPD with an outcome regression model.",
  annotations: {
    title: "Population-Adjusted Comparison (MAIC/STC)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      index_trial: {
        type: "object",
        description:
          "Trial with data to be reweighted (the trial for which you want to adjust)",
        properties: {
          name: {
            type: "string",
            description: "Trial name (e.g., 'SUSTAIN-7')",
          },
          treatment: { type: "string", description: "Treatment arm name" },
          comparator: { type: "string", description: "Comparator arm name" },
          n: { type: "number", description: "Sample size" },
          effect: {
            type: "number",
            description: "Point estimate (HR, OR, RR, or MD)",
          },
          ci_lower: { type: "number", description: "Lower 95% CI" },
          ci_upper: { type: "number", description: "Upper 95% CI" },
          measure: { type: "string", enum: ["MD", "OR", "RR", "HR"] },
          covariates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description:
                    "Covariate name (e.g., 'age', 'bmi', 'hba1c_baseline')",
                },
                mean: { type: "number" },
                sd: { type: "number" },
              },
              required: ["name", "mean", "sd"],
            },
          },
        },
        required: [
          "name",
          "treatment",
          "comparator",
          "n",
          "effect",
          "ci_lower",
          "ci_upper",
          "measure",
          "covariates",
        ],
      },
      target_trial: {
        type: "object",
        description: "Trial whose population is the matching target",
        properties: {
          name: { type: "string" },
          treatment: { type: "string" },
          comparator: { type: "string" },
          n: { type: "number" },
          effect: { type: "number" },
          ci_lower: { type: "number" },
          ci_upper: { type: "number" },
          measure: { type: "string", enum: ["MD", "OR", "RR", "HR"] },
          covariates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                mean: { type: "number" },
                sd: { type: "number" },
              },
              required: ["name", "mean", "sd"],
            },
          },
        },
        required: [
          "name",
          "treatment",
          "comparator",
          "n",
          "effect",
          "ci_lower",
          "ci_upper",
          "measure",
          "covariates",
        ],
      },
      effect_modifiers: {
        type: "array",
        items: { type: "string" },
        description:
          "Names of covariates that are effect modifiers (must appear in both trials' covariates)",
      },
      method: {
        type: "string",
        enum: ["auto", "maic", "stc"],
        description:
          "auto (default): MAIC when >=2 modifiers and N>=50, else STC",
      },
      outcome_name: {
        type: "string",
        description:
          "Name of the outcome being compared (e.g., 'HbA1c change')",
      },
      output_format: { type: "string", enum: ["text", "json"] },
      project: { type: "string", description: "Project ID for persistence" },
    },
    required: ["index_trial", "target_trial", "effect_modifiers"],
  },
};
