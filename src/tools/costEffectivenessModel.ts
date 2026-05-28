import { z } from "zod";
import type {
  CEModelParams,
  ToolResult,
  CEModelResult,
  WTPAssessment,
  PSASummary,
  OWSASummary,
} from "../providers/types.js";
import { runMarkovModel } from "../models/markov.js";

const CEModelSchema = z.object({
  intervention: z.string().min(1),
  comparator: z.string().min(1),
  indication: z.string().min(1),
  time_horizon: z.union([
    z.enum(["lifetime", "5yr", "10yr"]),
    z.number().positive(),
  ]),
  perspective: z.enum(["nhs", "us_payer", "societal"]),
  model_type: z.enum(["markov", "partsa", "decision_tree"]).optional(),
  clinical_inputs: z.object({
    efficacy_delta: z.number().min(0).max(1),
    mortality_reduction: z.number().min(0).max(1).optional(),
    ae_rate: z.number().min(0).max(1).optional(),
  }),
  cost_inputs: z.object({
    drug_cost_annual: z.number().nonnegative(),
    admin_cost: z.number().nonnegative().optional(),
    ae_cost: z.number().nonnegative().optional(),
    comparator_cost_annual: z.number().nonnegative(),
  }),
  utility_inputs: z
    .object({
      qaly_on_treatment: z.number().min(0).max(1),
      qaly_comparator: z.number().min(0).max(1),
    })
    .optional(),
  run_psa: z.boolean().optional(),
  psa_iterations: z.number().int().min(1).max(10000).optional(),
  run_owsa: z.boolean().optional(),
  scenarios: z
    .array(
      z.object({
        name: z.string().min(1),
        overrides: z.object({
          time_horizon: z
            .union([z.enum(["lifetime", "5yr", "10yr"]), z.number().positive()])
            .optional(),
          perspective: z.enum(["nhs", "us_payer", "societal"]).optional(),
          clinical_inputs: z
            .object({
              efficacy_delta: z.number().min(0).max(1).optional(),
              mortality_reduction: z.number().min(0).max(1).optional(),
            })
            .optional(),
          cost_inputs: z
            .object({
              drug_cost_annual: z.number().nonnegative().optional(),
              comparator_cost_annual: z.number().nonnegative().optional(),
            })
            .optional(),
          utility_inputs: z
            .object({
              qaly_on_treatment: z.number().min(0).max(1).optional(),
              qaly_comparator: z.number().min(0).max(1).optional(),
            })
            .optional(),
        }),
      }),
    )
    .max(10)
    .optional(),
  output_format: z.enum(["text", "json", "docx", "xlsx"]).optional(),
  project: z.string().optional(),
  summary_metric: z
    .enum(["qaly", "evlyg", "both"])
    .optional()
    .describe(
      "Summary metric for the ICER numerator: 'qaly' (default, NICE reference case), 'evlyg' (equal value life-years gained — CMS IRA-compatible, treats every life-year as utility 1.0), or 'both' (reports both). CMS prohibits QALYs in IRA drug price negotiations (§1194(e)(2)); use 'evlyg' for those contexts.",
    ),
  // Required when model_type='partsa'. Codex P1 (2026-05-07): previously
  // omitted from the Zod schema entirely, so Zod's default-strip behaviour
  // dropped any caller-supplied survival_inputs and PartSA was effectively
  // unreachable. The handler now hard-fails when partsa is requested without
  // this object.
  survival_inputs: z
    .object({
      os_median_months: z.number().positive().optional(),
      pfs_median_months: z.number().positive().optional(),
      os_median_months_comparator: z.number().positive().optional(),
      pfs_median_months_comparator: z.number().positive().optional(),
      survival_distribution: z.enum(["exponential", "weibull"]).optional(),
      weibull_shape: z.number().positive().optional(),
    })
    .optional(),
  // Design log #27: MFN price-sensitivity sweep. Cheap deterministic
  // alternative to a full PSA re-run — sweeps drug_cost_annual across
  // [min_basket, current_us_price] at n_points and reports ICER per
  // price plus WTP crossover prices. When omitted, no MFN sensitivity
  // section is added to the output.
  mfn_sensitivity: z
    .object({
      min_basket: z
        .number()
        .nonnegative()
        .finite()
        .describe(
          "Lower bound of the price sweep. Typically min(basket excluding US) from the 19-country GUARD/GLOBE MFN basket (see src/data/mfnBasket.ts).",
        ),
      current_us_price: z
        .number()
        .nonnegative()
        .finite()
        .describe(
          "Upper bound — the drug's current US net price. Must be >= min_basket.",
        ),
      n_points: z
        .number()
        .int()
        .min(2)
        .max(101)
        .optional()
        .describe(
          "Number of price points in the sweep (default 11). Each point is one Markov run, so wall-clock scales linearly with n_points × time_horizon.",
        ),
      wtp_thresholds: z
        .array(z.number().nonnegative().finite())
        .optional()
        .describe(
          "WTP thresholds in $/QALY for crossover detection. Defaults to [30000, 100000, 150000] (NHS / US payer low / US payer mid).",
        ),
    })
    .optional()
    .describe(
      "Optional MFN price-sensitivity sweep. When supplied, the output includes an mfn_sensitivity block with ICER per price point and WTP-crossover prices. Design log #27.",
    ),
});
import { runPartSA } from "../models/partsa.js";
import { runPSA } from "../models/psa.js";
import { runOWSA, buildDefaultOWSAParameters } from "../models/owsa.js";
import {
  runMfnSensitivity,
  type MfnSensitivityResult,
} from "../models/mfnSensitivity.js";
import {
  buildMarkovParamsFromCE,
  runMarkovAndComputeICER,
  getTimeHorizonYears,
} from "../models/modelUtils.js";
import {
  createAuditRecord,
  addAssumption,
  setMethodology,
} from "../audit/builder.js";
import { auditToMarkdown } from "../formatters/markdown.js";
import { extractDisclosureLevel } from "../formatters/disclosure.js";
import { contentToDocx } from "../formatters/docx.js";
import { saveReport } from "../knowledge/index.js";
import { saveModelRun } from "../knowledge/index.js";

const WTP_THRESHOLDS = {
  nhs: { low: 25000, high: 35000, currency: "GBP", symbol: "£" },
  us_payer: { low: 100000, high: 150000, currency: "USD", symbol: "$" },
  societal: { low: 50000, high: 100000, currency: "USD", symbol: "$" },
};

const DISCOUNT_RATE = 0.035;

/**
 * Run scenario analysis: re-run the CE model with parameter overrides.
 * Returns markdown table comparing base case to each scenario.
 */
function buildScenarioSection(
  params: CEModelParams & {
    scenarios?: Array<{ name: string; overrides: Record<string, unknown> }>;
  },
  symbol: string,
): string[] {
  if (!params.scenarios || params.scenarios.length === 0) return [];

  const lines: string[] = [
    `### Scenario Analysis`,
    `| Scenario | ICER | Delta Cost | Delta QALY | Verdict |`,
    `|----------|------|-----------|------------|---------|`,
  ];

  // Base case row
  const baseResult = runMarkovAndComputeICER(params);
  const baseIcer = isFinite(baseResult.icer)
    ? `${symbol}${Math.round(baseResult.icer).toLocaleString()}`
    : baseResult.delta_cost <= 0 && baseResult.delta_qaly >= 0
      ? "Dominant"
      : "Dominated";
  lines.push(
    `| **Base case** | ${baseIcer} | ${symbol}${Math.round(baseResult.delta_cost).toLocaleString()} | ${baseResult.delta_qaly.toFixed(3)} | — |`,
  );

  for (const scenario of params.scenarios) {
    // Deep merge overrides into base params
    const merged: CEModelParams = {
      ...params,
      ...scenario.overrides,
      clinical_inputs: {
        ...params.clinical_inputs,
        ...((scenario.overrides.clinical_inputs as Record<string, unknown>) ??
          {}),
      } as CEModelParams["clinical_inputs"],
      cost_inputs: {
        ...params.cost_inputs,
        ...((scenario.overrides.cost_inputs as Record<string, unknown>) ?? {}),
      } as CEModelParams["cost_inputs"],
      utility_inputs: params.utility_inputs
        ? ({
            ...params.utility_inputs,
            ...((scenario.overrides.utility_inputs as Record<
              string,
              unknown
            >) ?? {}),
          } as CEModelParams["utility_inputs"])
        : undefined,
    };

    // Remove scenarios from merged to avoid recursion
    delete (merged as unknown as Record<string, unknown>).scenarios;

    const result = runMarkovAndComputeICER(merged);
    const perspective =
      (scenario.overrides.perspective as string) ?? params.perspective;
    const threshold =
      WTP_THRESHOLDS[perspective as keyof typeof WTP_THRESHOLDS];
    const verdict = wtpVerdict(
      result.icer,
      threshold,
      result.delta_cost,
      result.delta_qaly,
    );

    const icerStr = isFinite(result.icer)
      ? `${symbol}${Math.round(result.icer).toLocaleString()}`
      : result.delta_cost <= 0 && result.delta_qaly >= 0
        ? "Dominant"
        : "Dominated";

    lines.push(
      `| ${scenario.name} | ${icerStr} | ${symbol}${Math.round(result.delta_cost).toLocaleString()} | ${result.delta_qaly.toFixed(3)} | ${verdict} |`,
    );
  }

  lines.push(``);
  return lines;
}

function buildAlternativeMetricsSection(
  summary_metric: "qaly" | "evlyg" | "both" | undefined,
  delta_cost: number,
  incremental_lys: number,
  evlyg_icer: number,
  symbol: string,
): string[] {
  if (!summary_metric || summary_metric === "qaly") return [];

  const lines: string[] = [];
  lines.push(`### Alternative Summary Metric — evLYG`);
  lines.push(
    `**evLYG (Equal Value Life-Years Gained):** treats every incremental life-year as utility 1.0 regardless of health state. Used as a QALY alternative where QALYs are restricted (e.g., **CMS prohibits QALYs in Medicare IRA drug price negotiations per §1194(e)(2)**).`,
  );
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(
    `| Incremental cost | ${symbol}${Math.round(delta_cost).toLocaleString()} |`,
  );
  lines.push(
    `| Incremental life-years (evLYG) | ${incremental_lys.toFixed(3)} |`,
  );
  const evlygStr = isFinite(evlyg_icer)
    ? incremental_lys > 0
      ? `${symbol}${Math.round(evlyg_icer).toLocaleString()}/LY`
      : "N/A (no life-year gain)"
    : "N/A";
  lines.push(`| Cost per evLYG | ${evlygStr} |`);
  lines.push(``);
  if (summary_metric === "evlyg") {
    lines.push(
      `> Primary metric for this analysis: evLYG (QALY result shown above for reference only).`,
    );
  } else {
    lines.push(
      `> Both QALY and evLYG reported (summary_metric="both"). Choose the appropriate primary metric for your stakeholder context.`,
    );
  }
  lines.push(``);
  return lines;
}

function wtpVerdict(
  icer: number,
  threshold: { low: number; high: number },
  delta_cost: number,
  delta_qaly: number,
): WTPAssessment["verdict"] {
  // Dominant: lower cost AND higher QALYs — always cost-effective
  if (delta_cost <= 0 && delta_qaly >= 0 && (delta_cost < 0 || delta_qaly > 0))
    return "cost_effective";
  // Dominated: higher cost AND lower QALYs — never cost-effective
  if (delta_cost >= 0 && delta_qaly <= 0 && (delta_cost > 0 || delta_qaly < 0))
    return "dominated";
  if (!isFinite(icer)) return "not_cost_effective";
  if (icer < threshold.low) return "cost_effective";
  if (icer < threshold.high) return "borderline";
  return "not_cost_effective";
}

function buildWTPAssessment(
  icer: number,
  perspective: keyof typeof WTP_THRESHOLDS,
  delta_cost: number,
  delta_qaly: number,
): WTPAssessment {
  const threshold = WTP_THRESHOLDS[perspective];
  return {
    threshold_low: threshold.low,
    threshold_high: threshold.high,
    currency: threshold.currency,
    symbol: threshold.symbol,
    verdict: wtpVerdict(icer, threshold, delta_cost, delta_qaly),
  };
}

export async function handleCostEffectivenessModel(
  rawParams: unknown,
): Promise<ToolResult> {
  // 2026-05-05: PostHog showed 40% error rate (n=5). Switch to safeParse
  // and emit a clean field-by-field error so LLM callers can self-correct
  // on the next turn. Surface the most common shape mistake (flattened
  // efficacy_delta) explicitly before Zod's raw issue list.
  if (
    rawParams &&
    typeof rawParams === "object" &&
    !Array.isArray(rawParams) &&
    "efficacy_delta" in rawParams &&
    !("clinical_inputs" in rawParams)
  ) {
    throw new Error(
      "Invalid input: 'efficacy_delta' must be inside the clinical_inputs object, e.g. { clinical_inputs: { efficacy_delta: 0.4, ... } }, not at the top level.",
    );
  }
  const parsed = CEModelSchema.safeParse(rawParams);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `${i.path.join(".") || "input"}: ${i.message}`,
    );
    throw new Error(`Invalid input:\n${lines.join("\n")}`);
  }
  const params = parsed.data as CEModelParams;
  const outputFormat = params.output_format ?? "text";
  let audit = createAuditRecord(
    "models.cost_effectiveness",
    params as unknown as Record<string, unknown>,
    outputFormat,
  );

  const modelType = params.model_type ?? "markov";

  // Fail loudly if PartSA is requested but survival_inputs are missing.
  // Previously this fell through silently to the Markov branch (the gate at
  // `if (modelType === "partsa" && params.survival_inputs)` evaluated false
  // when survival_inputs was undefined), while the audit methodology still
  // claimed "Partitioned Survival Analysis" and PSA was suppressed by
  // `modelType !== "partsa"` — corrupted output, no warning.
  if (modelType === "partsa" && !params.survival_inputs) {
    throw new Error(
      "Invalid input: model_type='partsa' requires survival_inputs " +
        "(provide survival_inputs.os_median_months, pfs_median_months, and " +
        "optionally survival_distribution). Otherwise omit model_type to " +
        "use the Markov default.",
    );
  }

  const years = getTimeHorizonYears(params.time_horizon);
  const threshold = WTP_THRESHOLDS[params.perspective];
  const { symbol } = threshold;

  audit = setMethodology(
    audit,
    `Markov model (multi-state) with half-cycle correction and PSA — ${modelType === "partsa" ? "Partitioned Survival Analysis" : "2-state Markov"}`,
  );

  audit = addAssumption(
    audit,
    `Discount rate: ${DISCOUNT_RATE * 100}% (NICE reference case)`,
  );
  audit = addAssumption(
    audit,
    `Time horizon: ${years} years (${params.time_horizon})`,
  );
  audit = addAssumption(audit, `Perspective: ${params.perspective}`);
  audit = addAssumption(audit, `Markov cycle length: 1 year`);
  if (!params.utility_inputs) {
    audit = addAssumption(
      audit,
      `QALY estimate derived from efficacy delta (utility inputs not provided) — use with caution`,
    );
  }

  // --- Base case ---
  let delta_cost: number;
  let delta_qaly: number;
  let icer: number;
  let intervention_cost: number;
  let comparator_cost: number;
  let intervention_qaly: number;
  let comparator_qaly: number;
  let intervention_lys: number;
  let comparator_lys: number;
  let stateNames: string[];
  let nCycles: number;

  if (modelType === "partsa" && params.survival_inputs) {
    const si = params.survival_inputs;
    const partSAResult = runPartSA({
      intervention_survival: {
        os_median_months: si.os_median_months ?? 24,
        pfs_median_months: si.pfs_median_months ?? 12,
        distribution: si.survival_distribution ?? "exponential",
        weibull_shape: si.weibull_shape,
      },
      comparator_survival: {
        os_median_months: si.os_median_months_comparator ?? 18,
        pfs_median_months: si.pfs_median_months_comparator ?? 9,
        distribution: si.survival_distribution ?? "exponential",
        weibull_shape: si.weibull_shape,
      },
      states: ["PFS", "PD", "Dead"],
      utility_pfs: params.utility_inputs?.qaly_on_treatment ?? 0.75,
      utility_pd: params.utility_inputs?.qaly_comparator ?? 0.55,
      cost_pfs_annual: params.cost_inputs.drug_cost_annual,
      cost_pd_annual: params.cost_inputs.comparator_cost_annual,
      n_cycles: years,
      cycle_length_years: 1,
      discount_rate_costs: DISCOUNT_RATE,
      discount_rate_outcomes: DISCOUNT_RATE,
    });

    delta_cost =
      partSAResult.intervention.total_cost - partSAResult.comparator.total_cost;
    delta_qaly =
      partSAResult.intervention.total_qaly - partSAResult.comparator.total_qaly;
    icer =
      delta_qaly > 0
        ? delta_cost / delta_qaly
        : delta_qaly < 0
          ? -Infinity
          : Infinity;
    intervention_cost = partSAResult.intervention.total_cost;
    comparator_cost = partSAResult.comparator.total_cost;
    intervention_qaly = partSAResult.intervention.total_qaly;
    comparator_qaly = partSAResult.comparator.total_qaly;
    intervention_lys = partSAResult.intervention.total_lys;
    comparator_lys = partSAResult.comparator.total_lys;
    stateNames = ["PFS", "PD", "Dead"];
    nCycles = years;
  } else {
    // Default: Markov
    const markovResult = runMarkovAndComputeICER(params);
    delta_cost = markovResult.delta_cost;
    delta_qaly = markovResult.delta_qaly;
    icer = markovResult.icer;
    intervention_cost = markovResult.intervention_cost;
    comparator_cost = markovResult.comparator_cost;
    intervention_qaly = markovResult.intervention_qaly;
    comparator_qaly = markovResult.comparator_qaly;
    intervention_lys = markovResult.intervention_lys;
    comparator_lys = markovResult.comparator_lys;
    stateNames = params.states ?? ["On-Treatment", "Off-Treatment", "Dead"];
    nCycles = years;
  }

  const incremental_lys = intervention_lys - comparator_lys;

  // evLYG (equal value life-years gained) — treats every life-year as utility 1.0.
  // Used as a QALY alternative for CMS IRA contexts where QALYs are prohibited.
  const evlyg_icer =
    incremental_lys > 0
      ? delta_cost / incremental_lys
      : Number.POSITIVE_INFINITY;

  // --- PSA ---
  let psaSummary: PSASummary | undefined;
  if (params.run_psa !== false && modelType !== "partsa") {
    const n_iterations = Math.min(
      10000,
      Math.max(1, params.psa_iterations ?? 1000),
    );
    const psaResult = runPSA({
      base_params: params,
      n_iterations,
      seed: 12345,
      evpi_lambda: threshold.low,
    });

    psaSummary = {
      iterations: n_iterations,
      mean_icer: psaResult.mean_icer,
      ci_icer_lower: psaResult.ci_icer_lower,
      ci_icer_upper: psaResult.ci_icer_upper,
      prob_cost_effective: psaResult.prob_cost_effective,
      ceac: psaResult.ceac,
      evpi: psaResult.evpi,
      evppi: psaResult.evppi.map((e) => ({
        parameter: e.parameter,
        evppi: e.evppi,
        evppi_proportion: e.evppi_proportion,
        evppi_ci_lower: e.evppi_ci_lower,
        evppi_ci_upper: e.evppi_ci_upper,
        evppi_se: e.evppi_se,
        below_noise_floor: e.below_noise_floor,
      })),
      scatter: psaResult.scatter_sample.map((it) => ({
        delta_cost: it.delta_cost,
        delta_qaly: it.delta_qaly,
      })),
    };
  }

  // --- OWSA ---
  let owsaResults: OWSASummary[] | undefined;
  if (params.run_owsa !== false) {
    const owsaParams = buildDefaultOWSAParameters(params);
    const rawOWSA = runOWSA(params, owsaParams, (p) =>
      runMarkovAndComputeICER(p),
    );
    owsaResults = rawOWSA.map((r) => ({
      parameter: r.parameter,
      low_value: r.low_value,
      high_value: r.high_value,
      icer_low: r.icer_low,
      icer_high: r.icer_high,
      impact: r.impact,
    }));
  }

  // --- MFN sensitivity (design log #27) ---
  let mfnSensitivity: MfnSensitivityResult | undefined;
  if (params.mfn_sensitivity) {
    const mfnRunner =
      modelType === "partsa" && params.survival_inputs
        ? (p: typeof params) => {
            const si = p.survival_inputs!;
            const r = runPartSA({
              intervention_survival: {
                os_median_months: si.os_median_months ?? 24,
                pfs_median_months: si.pfs_median_months ?? 12,
                distribution: si.survival_distribution ?? "exponential",
                weibull_shape: si.weibull_shape,
              },
              comparator_survival: {
                os_median_months: si.os_median_months_comparator ?? 18,
                pfs_median_months: si.pfs_median_months_comparator ?? 9,
                distribution: si.survival_distribution ?? "exponential",
                weibull_shape: si.weibull_shape,
              },
              states: ["PFS", "PD", "Dead"],
              utility_pfs: p.utility_inputs?.qaly_on_treatment ?? 0.75,
              utility_pd: p.utility_inputs?.qaly_comparator ?? 0.55,
              cost_pfs_annual: p.cost_inputs.drug_cost_annual,
              cost_pd_annual: p.cost_inputs.comparator_cost_annual,
              n_cycles: years,
              cycle_length_years: 1,
              discount_rate_costs: DISCOUNT_RATE,
              discount_rate_outcomes: DISCOUNT_RATE,
            });
            const dc = r.intervention.total_cost - r.comparator.total_cost;
            const dq = r.intervention.total_qaly - r.comparator.total_qaly;
            return {
              icer: dq > 0 ? dc / dq : dq < 0 ? -Infinity : Infinity,
            };
          }
        : runMarkovAndComputeICER;
    mfnSensitivity = runMfnSensitivity(
      params,
      params.mfn_sensitivity,
      mfnRunner,
    );
  }

  // --- WTP Analysis ---
  const wtp_analysis = {
    nhs: buildWTPAssessment(icer, "nhs", delta_cost, delta_qaly),
    us_payer: buildWTPAssessment(icer, "us_payer", delta_cost, delta_qaly),
    societal: buildWTPAssessment(icer, "societal", delta_cost, delta_qaly),
  };

  // --- Build result ---
  const modelResult: CEModelResult = {
    base_case: {
      icer,
      delta_cost,
      delta_qaly,
      incremental_lys,
      total_cost_intervention: intervention_cost,
      total_cost_comparator: comparator_cost,
      total_qaly_intervention: intervention_qaly,
      total_qaly_comparator: comparator_qaly,
    },
    psa: psaSummary,
    owsa: owsaResults,
    mfn_sensitivity: mfnSensitivity,
    wtp_analysis,
    model_metadata: {
      model_type: modelType,
      states: stateNames,
      cycles: nCycles,
      cycle_length: "1 year",
      discount_rate_costs: DISCOUNT_RATE,
      discount_rate_outcomes: DISCOUNT_RATE,
      time_horizon_years: years,
    },
    audit,
  };

  if (outputFormat === "json") {
    return { content: modelResult, audit };
  }

  // --- Text output (backwards-compatible) ---
  const isDominant =
    delta_cost <= 0 && delta_qaly >= 0 && (delta_cost < 0 || delta_qaly > 0);
  const isDominated =
    delta_cost >= 0 && delta_qaly <= 0 && (delta_cost > 0 || delta_qaly < 0);
  const icerFormatted = isDominant
    ? "Dominant"
    : isDominated
      ? "Dominated"
      : isFinite(icer)
        ? Math.round(icer).toLocaleString()
        : "N/A";
  const perspectiveVerdict = wtp_analysis[params.perspective];

  const interpretation = isDominant
    ? "Dominant — intervention is less costly and more effective than comparator"
    : isDominated
      ? "Dominated — intervention costs more and provides less benefit than comparator"
      : isFinite(icer) && icer >= 0
        ? icer < threshold.low
          ? `${symbol}${icerFormatted}/QALY — likely cost-effective (below NICE threshold of ${symbol}${threshold.low.toLocaleString()})`
          : icer < threshold.high
            ? `${symbol}${icerFormatted}/QALY — borderline cost-effective (within ${symbol}${threshold.low.toLocaleString()}–${symbol}${threshold.high.toLocaleString()} threshold range)`
            : `${symbol}${icerFormatted}/QALY — not cost-effective at standard threshold`
        : "ICER could not be computed";

  // PSA section
  const psaSection: string[] = [];
  if (psaSummary) {
    const pcePerspective =
      perspectiveVerdict.currency === "GBP"
        ? (psaSummary.prob_cost_effective["nhs_low"] ?? 0)
        : (psaSummary.prob_cost_effective["us_payer_low"] ?? 0);
    const pcePercent = Math.round(pcePerspective * 100);

    psaSection.push(
      `### Probabilistic Sensitivity Analysis (PSA)`,
      `Based on ${psaSummary.iterations.toLocaleString()} Monte Carlo iterations:`,
      `- **Mean ICER:** ${symbol}${Math.round(psaSummary.mean_icer).toLocaleString()}/QALY`,
      `- **95% CI:** ${symbol}${Math.round(psaSummary.ci_icer_lower).toLocaleString()} – ${symbol}${Math.round(psaSummary.ci_icer_upper).toLocaleString()}/QALY`,
      `- **Probability cost-effective** at ${params.perspective} threshold: **${pcePercent}%**`,
      `- **EVPI:** ${symbol}${Math.round(psaSummary.evpi).toLocaleString()} (expected value of perfect information)`,
      ``,
    );

    // EVPPI section
    if (psaSummary.evppi && psaSummary.evppi.length > 0) {
      psaSection.push(`#### EVPPI (Partial Value of Information)`);
      // v1.7.0: noise-floor guard. When totalEVPI is below ~0.5% of NMB
      // standard deviation, every per-parameter EVPPI is binning noise.
      // Suppress the table entirely and surface the explanation rather
      // than print a misleading "top parameters" list of fake signals.
      const allBelow = psaSummary.evppi.every(
        (ev) => ev.below_noise_floor === true,
      );
      if (allBelow) {
        psaSection.push(
          `Decision is robust to all uncertainty (totalEVPI below noise floor relative to NMB standard deviation). No per-parameter EVPPI ranking is meaningful — additional research on any individual parameter would not change the cost-effectiveness verdict at this WTP threshold.`,
        );
      } else {
        psaSection.push(`Which parameters are worth further research:`);
        psaSection.push(`| Parameter | EVPPI | 95% CI | % of EVPI |`);
        psaSection.push(`|-----------|-------|--------|-----------|`);
        for (const ev of psaSummary.evppi.slice(0, 5)) {
          if (ev.below_noise_floor) continue;
          const ci =
            ev.evppi_ci_lower !== undefined && ev.evppi_ci_upper !== undefined
              ? `${symbol}${Math.round(ev.evppi_ci_lower).toLocaleString()}–${symbol}${Math.round(ev.evppi_ci_upper).toLocaleString()}`
              : "—";
          psaSection.push(
            `| ${ev.parameter} | ${symbol}${Math.round(ev.evppi).toLocaleString()} | ${ci} | ${(ev.evppi_proportion * 100).toFixed(1)}% |`,
          );
        }
      }
      psaSection.push(``);
    }
  }

  // OWSA section (top 5)
  const owsaSection: string[] = [];
  if (owsaResults && owsaResults.length > 0) {
    owsaSection.push(`### One-Way Sensitivity Analysis (Tornado)`);
    owsaSection.push(
      `Top ${Math.min(5, owsaResults.length)} parameters by ICER impact:`,
    );
    owsaSection.push(`| Parameter | Low ICER | High ICER | Impact |`);
    owsaSection.push(`|-----------|----------|-----------|--------|`);
    for (const r of owsaResults.slice(0, 5)) {
      const low = isFinite(r.icer_low)
        ? `${symbol}${Math.round(r.icer_low).toLocaleString()}`
        : "N/A";
      const high = isFinite(r.icer_high)
        ? `${symbol}${Math.round(r.icer_high).toLocaleString()}`
        : "N/A";
      const impact = isFinite(r.impact)
        ? `${symbol}${Math.round(r.impact).toLocaleString()}`
        : "N/A";
      owsaSection.push(`| ${r.parameter} | ${low} | ${high} | ${impact} |`);
    }
    owsaSection.push(``);
  }

  // Design log #27: MFN sensitivity section (text).
  const mfnSection: string[] = [];
  if (mfnSensitivity) {
    mfnSection.push(`### MFN Price Sensitivity (design log #27)`);
    mfnSection.push(
      `ICER swept across ${mfnSensitivity.range.n_points} drug-price points from MFN ceiling ${symbol}${mfnSensitivity.range.min_basket.toLocaleString()} to current US ${symbol}${mfnSensitivity.range.current_us_price.toLocaleString()}:`,
    );
    mfnSection.push("");
    mfnSection.push(`| Drug price | ICER |`);
    mfnSection.push(`|---:|---:|`);
    for (const pt of mfnSensitivity.curve) {
      const icerCell = Number.isFinite(pt.icer)
        ? `${symbol}${Math.round(pt.icer).toLocaleString()}`
        : "Infinity";
      mfnSection.push(
        `| ${symbol}${Math.round(pt.drug_price).toLocaleString()} | ${icerCell} |`,
      );
    }
    mfnSection.push("");
    mfnSection.push(
      `**ICER at MFN ceiling (${symbol}${Math.round(mfnSensitivity.range.min_basket).toLocaleString()}):** ${Number.isFinite(mfnSensitivity.icer_at_ceiling) ? `${symbol}${Math.round(mfnSensitivity.icer_at_ceiling).toLocaleString()}` : "Infinity"}/QALY`,
    );
    mfnSection.push(
      `**ICER at current US price (${symbol}${Math.round(mfnSensitivity.range.current_us_price).toLocaleString()}):** ${Number.isFinite(mfnSensitivity.icer_at_current) ? `${symbol}${Math.round(mfnSensitivity.icer_at_current).toLocaleString()}` : "Infinity"}/QALY`,
    );
    mfnSection.push("");
    mfnSection.push(`**WTP crossover prices:**`);
    for (const c of mfnSensitivity.crossovers) {
      if (c.crossover_price === null) {
        mfnSection.push(
          `- ${symbol}${c.wtp.toLocaleString()}/QALY — never crossed in this price range`,
        );
      } else {
        mfnSection.push(
          `- ${symbol}${c.wtp.toLocaleString()}/QALY — crossed at drug price ${symbol}${Math.round(c.crossover_price).toLocaleString()}`,
        );
      }
    }
    mfnSection.push("");
  }

  const textLines = [
    `## Cost-Effectiveness Analysis: ${params.intervention} vs ${params.comparator}`,
    `**Indication:** ${params.indication} | **Perspective:** ${params.perspective.toUpperCase()} | **Horizon:** ${params.time_horizon}`,
    ``,
    `### ICER Result`,
    `**${symbol}${icerFormatted} per QALY gained**`,
    ``,
    `**Interpretation:** ${interpretation}`,
    ``,
    `### Base Case Summary`,
    `| Metric | ${params.intervention} | ${params.comparator} | Incremental |`,
    `|--------|${"-".repeat(params.intervention.length + 2)}|${"-".repeat(params.comparator.length + 2)}|-------------|`,
    `| Total Cost | ${symbol}${Math.round(intervention_cost).toLocaleString()} | ${symbol}${Math.round(comparator_cost).toLocaleString()} | ${symbol}${Math.round(delta_cost).toLocaleString()} |`,
    `| Total QALYs | ${intervention_qaly.toFixed(3)} | ${comparator_qaly.toFixed(3)} | ${delta_qaly.toFixed(3)} |`,
    `| Life Years | ${intervention_lys.toFixed(2)} | ${comparator_lys.toFixed(2)} | ${incremental_lys.toFixed(2)} |`,
    ``,
    ...buildAlternativeMetricsSection(
      params.summary_metric,
      delta_cost,
      incremental_lys,
      evlyg_icer,
      symbol,
    ),
    ...psaSection,
    ...owsaSection,
    ...mfnSection,
    ...buildScenarioSection(params, symbol),
    `### Model Structure`,
    `Multi-state Markov model with half-cycle correction. Discounted at ${DISCOUNT_RATE * 100}% per NICE reference case.`,
    `States: ${stateNames.join(", ")} | Cycles: ${nCycles} annual cycles`,
    ``,
    `---`,
    `> ⚠️ **Disclaimer:** This is a preliminary model for orientation purposes only. Results require validation by a qualified health economist before use in any HTA submission or payer negotiation.`,
    ``,
    auditToMarkdown(audit, { disclosure: { level: extractDisclosureLevel(rawParams, "standard") } }),
  ].join("\n");

  if (params.project) {
    try {
      const metadata = {
        intervention: params.intervention,
        comparator: params.comparator,
        indication: params.indication,
        perspective: params.perspective,
        model_type: params.model_type ?? "markov",
      };
      await saveModelRun(params.project, metadata, textLines);
    } catch {
      // fail silently — don't break the tool
    }
  }

  if (outputFormat === "docx") {
    const base64 = await contentToDocx(
      "Cost-Effectiveness Analysis Report",
      textLines,
      audit,
    );
    const filenameStem = `ce-model-${params.intervention.slice(0, 30)}-vs-${params.comparator.slice(0, 30)}`;
    const savedPath = await saveReport(base64, filenameStem, params.project);
    const sizeKb = Math.round(base64.length / 1024);
    const content = `## DOCX Report Generated\n\n**File:** \`${savedPath}\`\n**Size:** ${sizeKb} KB\n**Intervention:** ${params.intervention}\n**Comparator:** ${params.comparator}\n\nOpen with: \`open "${savedPath}"\``;
    return { content, audit };
  }

  if (outputFormat === "xlsx") {
    const { ceModelToXlsx } = await import("../formatters/xlsx.js");
    const buf = await ceModelToXlsx(params, modelResult, audit);
    const base64 = buf.toString("base64");
    const filenameStem = `ce-model-${params.intervention.slice(0, 30)}-vs-${params.comparator.slice(0, 30)}`;
    const savedPath = await saveReport(
      base64,
      filenameStem,
      params.project,
      "xlsx",
    );
    const sizeKb = Math.round(buf.length / 1024);
    const content = `## Excel Workbook Generated\n\n**File:** \`${savedPath}\`\n**Size:** ${sizeKb} KB\n**Intervention:** ${params.intervention}\n**Comparator:** ${params.comparator}\n\nTabs: Summary | Inputs | Transition Matrix | PSA | CEAC | Audit\n\n> **Note:** This is a structured report — editing cells does NOT re-run the model. Re-run by calling cost_effectiveness_model with modified parameters. The workbook shows all inputs and PSA iterations transparently for review.\n\nOpen with: \`open "${savedPath}"\``;
    return { content, audit };
  }

  const content = textLines;
  return { content, audit };
}

export const costEffectivenessModelToolSchema = {
  name: "models.cost_effectiveness",
  description:
    "Build a cost-utility analysis (ICER, QALY, PSA, sensitivity analysis) for a drug vs comparator. Follows ISPOR good practice guidelines and NICE reference case. Includes probabilistic sensitivity analysis (PSA), one-way sensitivity, and cost-effectiveness acceptability curve (CEAC). NOTE: utility inputs are value-set-dependent — UK submissions in 2026+ will transition from DSU 3L→5L mapping to the new UK EQ-5D-5L value set (NICE consultation 2026-04-15 to 2026-05-13). Use utility_value_set tool to check expected impact on ICER before finalising inputs.",
  annotations: {
    title: "Cost-Effectiveness Model",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      intervention: { type: "string", description: "Drug or treatment name" },
      comparator: {
        type: "string",
        description: "Comparator (standard of care)",
      },
      indication: { type: "string", description: "Disease or condition" },
      time_horizon: {
        type: "string",
        description:
          "Modelling horizon: 'lifetime', '5yr', '10yr', or years as number",
      },
      perspective: {
        type: "string",
        enum: ["nhs", "us_payer", "societal"],
        description:
          "Economic perspective: 'nhs' (UK NHS, WTP £25-35K/QALY), 'us_payer' ($100-150K/QALY ICER standard), or 'societal' (broader costs incl. productivity).",
      },
      model_type: {
        type: "string",
        enum: ["markov", "partsa", "decision_tree"],
        description:
          "Model type. Default: markov. Use 'partsa' for oncology — requires survival_inputs (the handler now hard-fails when partsa is set without it).",
      },
      survival_inputs: {
        type: "object",
        description:
          "Required when model_type='partsa'. Median survival inputs (months) for OS/PFS, optional comparator overrides, and parametric distribution choice. Codex P1 fix (2026-05-07).",
        properties: {
          os_median_months: { type: "number", minimum: 0 },
          pfs_median_months: { type: "number", minimum: 0 },
          os_median_months_comparator: { type: "number", minimum: 0 },
          pfs_median_months_comparator: { type: "number", minimum: 0 },
          survival_distribution: {
            type: "string",
            enum: ["exponential", "weibull"],
          },
          weibull_shape: { type: "number", minimum: 0 },
        },
      },
      clinical_inputs: {
        type: "object",
        description:
          "Clinical efficacy and safety parameters driving the Markov transitions.",
        properties: {
          efficacy_delta: {
            type: "number",
            description:
              "Relative efficacy of intervention vs comparator (0-1). Higher = stronger treatment effect. Drives probability of staying on treatment.",
          },
          mortality_reduction: {
            type: "number",
            description:
              "Relative mortality reduction (0-1). E.g., 0.2 = 20% lower mortality vs baseline 2%.",
          },
          ae_rate: {
            type: "number",
            description: "Annual adverse event rate (0-1).",
          },
        },
        required: ["efficacy_delta"],
      },
      cost_inputs: {
        type: "object",
        description:
          "Annual costs per patient in the base currency for the selected perspective.",
        properties: {
          drug_cost_annual: {
            type: "number",
            description: "Annual drug acquisition cost for the intervention.",
          },
          admin_cost: {
            type: "number",
            description:
              "Annual administration cost (applies to both arms if shared).",
          },
          ae_cost: {
            type: "number",
            description: "Annual adverse event management cost.",
          },
          comparator_cost_annual: {
            type: "number",
            description: "Annual drug acquisition cost for the comparator.",
          },
        },
        required: ["drug_cost_annual", "comparator_cost_annual"],
      },
      utility_inputs: {
        type: "object",
        description:
          "QALY weights for each health state (optional — defaults derived from efficacy if omitted).",
        properties: {
          qaly_on_treatment: {
            type: "number",
            description:
              "Utility weight (0-1) for on-treatment state. 1=perfect health, 0=death.",
          },
          qaly_comparator: {
            type: "number",
            description:
              "Utility weight (0-1) for comparator / off-treatment state.",
          },
        },
      },
      run_psa: {
        type: "boolean",
        description: "Run probabilistic sensitivity analysis (default: true)",
      },
      psa_iterations: {
        type: "number",
        description: "PSA iterations (default: 1000, max: 10000)",
      },
      run_owsa: {
        type: "boolean",
        description:
          "Run one-way sensitivity analysis (default: true). Set to false to skip OWSA and speed up large PSA runs.",
      },
      scenarios: {
        type: "array",
        description:
          "Optional scenario analysis: array of named parameter overrides. Each scenario re-runs the model with the specified changes. Max 10 scenarios.",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Scenario name (e.g., '20% price reduction')",
            },
            overrides: {
              type: "object",
              description:
                "Parameter overrides (time_horizon, perspective, clinical_inputs, cost_inputs, utility_inputs)",
            },
          },
          required: ["name", "overrides"],
        },
      },
      mfn_sensitivity: {
        type: "object",
        description:
          "Optional MFN price-sensitivity sweep. When supplied, the output includes an mfn_sensitivity block with ICER per price point and WTP-crossover prices. Design log #27.",
        properties: {
          min_basket: {
            type: "number",
            description:
              "Lower bound of the price sweep. Typically min(basket excluding US) from the 19-country GUARD/GLOBE MFN basket.",
          },
          current_us_price: {
            type: "number",
            description:
              "Upper bound — the drug's current US net price. Must be >= min_basket.",
          },
          n_points: {
            type: "number",
            description:
              "Number of price points in the sweep (default 11, max 101).",
          },
          wtp_thresholds: {
            type: "array",
            items: { type: "number" },
            description:
              "WTP thresholds in $/QALY for crossover detection. Defaults to [30000, 100000, 150000].",
          },
        },
        required: ["min_basket", "current_us_price"],
      },
      output_format: {
        type: "string",
        enum: ["text", "json", "docx", "xlsx"],
        description:
          "Use 'xlsx' for a structured Excel report with inputs, transition matrix, PSA iterations, and CEAC in separate tabs. The workbook is a REPORT — editing cells does not re-run the model. Re-run by calling the tool again with modified parameters.",
      },
      project: {
        type: "string",
        description:
          "Project ID for knowledge base persistence. When set, model run is saved to ~/.heor-agent/projects/{project}/raw/models/",
      },
      summary_metric: {
        type: "string",
        enum: ["qaly", "evlyg", "both"],
        description:
          "Summary metric for the ICER numerator. 'qaly' (default, NICE reference case), 'evlyg' (equal value life-years gained — CMS IRA-compatible; CMS prohibits QALYs in Medicare IRA drug price negotiations per §1194(e)(2)), or 'both' to report both side-by-side.",
      },
    },
      ai_disclosure_level: {
        type: "string",
        enum: ["off", "standard", "submission"],
        description: "AI assistance disclosure level. \"off\" = no disclosure; \"standard\" = default (model/tools/sources/date + human-review reminder); \"submission\" = adds ISPOR ELEVATE-GenAI citation. Default is tool-specific.",
      },
    required: [
      "intervention",
      "comparator",
      "indication",
      "time_horizon",
      "perspective",
      "clinical_inputs",
      "cost_inputs",
    ],
  },
};
