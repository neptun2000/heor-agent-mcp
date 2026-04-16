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
});
import { runPartSA } from "../models/partsa.js";
import { runPSA } from "../models/psa.js";
import { runOWSA, buildDefaultOWSAParameters } from "../models/owsa.js";
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
  const params = CEModelSchema.parse(rawParams) as CEModelParams;
  const outputFormat = params.output_format ?? "text";
  let audit = createAuditRecord(
    "cost_effectiveness_model",
    params as unknown as Record<string, unknown>,
    outputFormat,
  );

  const modelType = params.model_type ?? "markov";
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
      psaSection.push(`Which parameters are worth further research:`);
      psaSection.push(`| Parameter | EVPPI | % of EVPI |`);
      psaSection.push(`|-----------|-------|-----------|`);
      for (const ev of psaSummary.evppi.slice(0, 5)) {
        psaSection.push(
          `| ${ev.parameter} | ${symbol}${Math.round(ev.evppi).toLocaleString()} | ${(ev.evppi_proportion * 100).toFixed(1)}% |`,
        );
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
    ...psaSection,
    ...owsaSection,
    ...buildScenarioSection(params, symbol),
    `### Model Structure`,
    `Multi-state Markov model with half-cycle correction. Discounted at ${DISCOUNT_RATE * 100}% per NICE reference case.`,
    `States: ${stateNames.join(", ")} | Cycles: ${nCycles} annual cycles`,
    ``,
    `---`,
    `> ⚠️ **Disclaimer:** This is a preliminary model for orientation purposes only. Results require validation by a qualified health economist before use in any HTA submission or payer negotiation.`,
    ``,
    auditToMarkdown(audit),
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
  name: "cost_effectiveness_model",
  description:
    "Build a cost-utility analysis (ICER, QALY, PSA, sensitivity analysis) for a drug vs comparator. Follows ISPOR good practice guidelines and NICE reference case. Includes probabilistic sensitivity analysis (PSA), one-way sensitivity, and cost-effectiveness acceptability curve (CEAC).",
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
      perspective: { type: "string", enum: ["nhs", "us_payer", "societal"] },
      model_type: {
        type: "string",
        enum: ["markov", "partsa", "decision_tree"],
        description: "Model type. Default: markov. Use 'partsa' for oncology.",
      },
      clinical_inputs: {
        type: "object",
        properties: {
          efficacy_delta: { type: "number" },
          mortality_reduction: { type: "number" },
          ae_rate: { type: "number" },
        },
        required: ["efficacy_delta"],
      },
      cost_inputs: {
        type: "object",
        properties: {
          drug_cost_annual: { type: "number" },
          admin_cost: { type: "number" },
          ae_cost: { type: "number" },
          comparator_cost_annual: { type: "number" },
        },
        required: ["drug_cost_annual", "comparator_cost_annual"],
      },
      utility_inputs: {
        type: "object",
        properties: {
          qaly_on_treatment: { type: "number" },
          qaly_comparator: { type: "number" },
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
