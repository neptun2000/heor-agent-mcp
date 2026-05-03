/**
 * Examples tool — returns canonical pre-filled inputs for heavy economic
 * tools so Claude/ChatGPT users can demo them with one prompt instead of
 * inventing 50 lines of JSON from scratch.
 *
 * PostHog showed cost_effectiveness_model, budget_impact_model,
 * survival_fitting, and population_adjusted_comparison had ZERO real-world
 * calls in the first week of v1.0.4 traffic despite 100+ tool_calls overall.
 * The input schema is the friction. This tool removes it.
 */

import { z } from "zod";
import type { ToolResult } from "../providers/types.js";
import { createAuditRecord, setMethodology } from "../audit/builder.js";

const ExamplesSchema = z
  .object({
    tool: z
      .enum([
        "cost_effectiveness_model",
        "budget_impact_model",
        "survival_fitting",
        "population_adjusted_comparison",
        "evidence_indirect",
      ])
      .optional()
      .describe(
        "Tool name to get a pre-filled example for. Omit to list all available examples.",
      ),
  })
  .strict();

interface Example {
  description: string;
  input: Record<string, unknown>;
  notes?: string;
}

const EXAMPLES: Record<string, Example> = {
  cost_effectiveness_model: {
    description:
      "Markov cost-effectiveness model: semaglutide 1mg vs sitagliptin 100mg in T2D, NHS lifetime perspective. Realistic NICE-style values. Edit any field and re-run with cost_effectiveness_model.",
    input: {
      intervention: "Semaglutide 1mg SC weekly",
      comparator: "Sitagliptin 100mg PO daily",
      indication: "Type 2 Diabetes Mellitus (HbA1c uncontrolled on metformin)",
      time_horizon: "lifetime",
      perspective: "nhs",
      model_type: "markov",
      clinical_inputs: {
        efficacy_delta: 0.5,
        mortality_reduction: 0.15,
        ae_rate: 0.05,
      },
      cost_inputs: {
        drug_cost_annual: 3200,
        comparator_cost_annual: 480,
        admin_cost: 180,
        ae_cost: 1200,
      },
      utility_inputs: {
        qaly_on_treatment: 0.82,
        qaly_comparator: 0.76,
      },
      run_psa: true,
      psa_iterations: 1000,
      output_format: "text",
    },
    notes:
      "Defaults are NICE reference case (3.5% discounting, half-cycle correction). PSA at 1000 iterations fits the ChatGPT 45s timeout; bump to 10000 in the web UI for tighter CIs.",
  },

  budget_impact_model: {
    description:
      "5-year budget impact: adopting semaglutide for T2D in an NHS region of 50,000 eligible patients with 10-30% uptake curve. ISPOR-compliant.",
    input: {
      intervention: "Semaglutide 1mg SC weekly",
      indication: "Type 2 Diabetes Mellitus",
      perspective: "nhs",
      eligible_population: 50000,
      time_horizon_years: 5,
      uptake_curve: [0.05, 0.1, 0.18, 0.25, 0.3],
      drug_cost_annual: 3200,
      comparator_cost_annual: 480,
      admin_cost_annual: 180,
      population_growth_rate: 0.02,
      output_format: "text",
    },
    notes:
      "Uptake curve is one row per year. Adjust eligible_population and uptake_curve for your market. ChatGPT mode caps psa_iterations at 500.",
  },

  survival_fitting: {
    description:
      "Fit 5 parametric distributions (Exponential, Weibull, Log-logistic, Log-normal, Gompertz) to KM step-summary data. Returns AIC/BIC ranking per NICE DSU TSD 14.",
    input: {
      outcome_name: "Overall survival",
      km_data: [
        { time: 0, survival_prob: 1.0, n_at_risk: 200 },
        { time: 6, survival_prob: 0.92, n_at_risk: 184 },
        { time: 12, survival_prob: 0.81, n_at_risk: 162 },
        { time: 18, survival_prob: 0.68, n_at_risk: 136 },
        { time: 24, survival_prob: 0.55, n_at_risk: 110 },
        { time: 36, survival_prob: 0.4, n_at_risk: 80 },
        { time: 48, survival_prob: 0.28, n_at_risk: 56 },
        { time: 60, survival_prob: 0.2, n_at_risk: 40 },
      ],
      output_format: "text",
    },
    notes:
      "Fits to KM step summary, NOT individual patient time-to-event data. Validate against IPD fits before using in a CEA. Time units = months.",
  },

  population_adjusted_comparison: {
    description:
      "MAIC (Matching-Adjusted Indirect Comparison) per NICE DSU TSD 18 — anchored, summary-level. Compare drug A's IPD-derived data to drug B's published trial after matching on key effect modifiers.",
    input: {
      method: "MAIC",
      target_trial: {
        n: 300,
        intervention: "Drug A",
        comparator: "Placebo",
        outcome_estimate: -0.7,
        outcome_se: 0.12,
        baseline_characteristics: {
          age_mean: 62,
          bmi_mean: 31,
          hba1c_baseline: 8.2,
        },
      },
      external_trial: {
        n: 250,
        intervention: "Drug B",
        comparator: "Placebo",
        outcome_estimate: -0.5,
        outcome_se: 0.14,
        baseline_characteristics: {
          age_mean: 58,
          bmi_mean: 29,
          hba1c_baseline: 7.8,
        },
      },
      effect_modifiers: ["age_mean", "bmi_mean", "hba1c_baseline"],
      output_format: "text",
    },
    notes:
      "⚠️ EXPERIMENTAL — summary-level approximation, not true IPD-level MAIC. For NICE-submission-grade analyses, use IPD with R-package `maicChecks` or equivalent.",
  },

  evidence_indirect: {
    description:
      "Bucher indirect comparison: A vs C via common comparator B. Now auto-runs a consistency check vs any direct h2h evidence in the network (NICE DSU TSD 18 / Cochrane 11.4.3).",
    input: {
      comparisons: [
        {
          intervention: "DrugA",
          comparator: "Placebo",
          outcome: "Overall survival",
          measure: "HR",
          estimate: 0.62,
          ci_lower: 0.48,
          ci_upper: 0.81,
          source: "TRIAL-A vs Placebo",
        },
        {
          intervention: "DrugC",
          comparator: "Placebo",
          outcome: "Overall survival",
          measure: "HR",
          estimate: 0.85,
          ci_lower: 0.7,
          ci_upper: 1.03,
          source: "TRIAL-C vs Placebo",
        },
      ],
      method: "bucher",
      output_format: "text",
    },
    notes:
      "Add a third h2h comparison (DrugA vs DrugC) to trigger the Bucher consistency check. Effect measure can be HR (hazard ratio), OR, RR, or MD (mean difference).",
  },
};

export async function handleExamples(rawParams: unknown): Promise<ToolResult> {
  const params = ExamplesSchema.parse(rawParams);
  let audit = createAuditRecord(
    "examples",
    params as unknown as Record<string, unknown>,
    "text",
    "Returns canonical pre-filled JSON inputs for heavy-schema tools. Users copy, tweak, and pass to the target tool.",
  );
  // setMethodology not strictly needed when constructor already sets it,
  // but keeping the import-side-effect explicit:
  audit = setMethodology(audit, audit.methodology);

  if (!params.tool) {
    const lines: string[] = [
      "## Available examples",
      "",
      "Pass `tool` to get a pre-filled JSON input you can run as-is.",
      "",
    ];
    for (const [name, ex] of Object.entries(EXAMPLES)) {
      lines.push(`### \`${name}\``);
      lines.push(ex.description);
      lines.push("");
    }
    lines.push("---");
    lines.push(
      "Example call: `examples({ tool: 'cost_effectiveness_model' })`",
    );
    return { content: lines.join("\n"), audit };
  }

  const ex = EXAMPLES[params.tool];
  if (!ex) {
    throw new Error(`Unknown tool: ${params.tool}`);
  }

  const lines: string[] = [
    `## Pre-filled example for \`${params.tool}\``,
    "",
    ex.description,
    "",
    "### Input JSON (copy, edit, then call the tool)",
    "",
    "```json",
    JSON.stringify(ex.input, null, 2),
    "```",
    "",
  ];
  if (ex.notes) {
    lines.push("### Notes");
    lines.push(ex.notes);
  }

  return { content: lines.join("\n"), audit };
}

export const examplesToolSchema = {
  name: "examples",
  description:
    "Get a pre-filled, copy-runnable JSON input for any of the heavy-schema tools (cost_effectiveness_model, budget_impact_model, survival_fitting, population_adjusted_comparison, evidence_indirect). Use when you want to demo a tool but don't want to invent inputs from scratch — the example is editable so you can tweak intervention names, costs, populations, etc. before calling the actual tool.",
  inputSchema: {
    type: "object",
    properties: {
      tool: {
        type: "string",
        enum: [
          "cost_effectiveness_model",
          "budget_impact_model",
          "survival_fitting",
          "population_adjusted_comparison",
          "evidence_indirect",
        ],
        description:
          "Which tool to get an example for. Omit to list all available examples.",
      },
    },
  },
  annotations: {
    title: "HEOR Tool Examples",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
