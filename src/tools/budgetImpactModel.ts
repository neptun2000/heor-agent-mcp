import { z } from "zod";
import type { ToolResult } from "../providers/types.js";
import {
  createAuditRecord,
  addAssumption,
  setMethodology,
} from "../audit/builder.js";
import { auditToMarkdown } from "../formatters/markdown.js";
import { contentToDocx } from "../formatters/docx.js";
import { saveReport } from "../knowledge/index.js";

const BudgetImpactSchema = z.object({
  intervention: z.string().min(1),
  comparator: z.string().min(1),
  indication: z.string().min(1),
  perspective: z.enum(["nhs", "us_payer", "societal"]),
  time_horizon_years: z.number().int().min(1).max(10).default(5),
  eligible_population: z.number().positive(),
  population_growth_rate: z.number().min(-0.1).max(0.2).default(0.0),
  market_share: z.object({
    year_1: z.number().min(0).max(1),
    year_2: z.number().min(0).max(1).optional(),
    year_3: z.number().min(0).max(1).optional(),
    year_4: z.number().min(0).max(1).optional(),
    year_5: z.number().min(0).max(1).optional(),
  }),
  drug_cost_annual: z.number().nonnegative(),
  comparator_cost_annual: z.number().nonnegative(),
  admin_cost_annual: z.number().nonnegative().default(0),
  monitoring_cost_annual: z.number().nonnegative().default(0),
  ae_cost_annual: z.number().nonnegative().default(0),
  comparator_ae_cost_annual: z.number().nonnegative().default(0),
  displacement: z
    .array(
      z.object({
        treatment: z.string(),
        share: z.number().min(0).max(1),
        cost_annual: z.number().nonnegative(),
      }),
    )
    .optional(),
  output_format: z.enum(["text", "json", "docx", "xlsx"]).optional(),
  project: z.string().optional(),
});

type BudgetImpactParams = z.infer<typeof BudgetImpactSchema>;

const CURRENCY: Record<string, { symbol: string; name: string }> = {
  nhs: { symbol: "\u00A3", name: "GBP" },
  us_payer: { symbol: "$", name: "USD" },
  societal: { symbol: "$", name: "USD" },
};

interface YearResult {
  year: number;
  eligible_population: number;
  treated_population: number;
  intervention_cost: number;
  comparator_cost: number;
  displaced_cost_saved: number;
  net_budget_impact: number;
  per_patient_cost: number;
}

function computeBudgetImpact(params: BudgetImpactParams): YearResult[] {
  const years = params.time_horizon_years;
  const shares = [
    params.market_share.year_1,
    params.market_share.year_2,
    params.market_share.year_3,
    params.market_share.year_4,
    params.market_share.year_5,
  ];

  // Interpolate/extrapolate market share for missing years
  let lastDefinedIdx = 0;
  for (let i = 0; i < shares.length; i++) {
    if (shares[i] !== undefined) lastDefinedIdx = i;
  }
  for (let i = 1; i < years; i++) {
    if (shares[i] === undefined) {
      shares[i] = shares[lastDefinedIdx];
    }
  }

  const interventionAnnualCost =
    params.drug_cost_annual +
    params.admin_cost_annual +
    params.monitoring_cost_annual +
    params.ae_cost_annual;

  const comparatorAnnualCost =
    params.comparator_cost_annual +
    params.admin_cost_annual +
    params.comparator_ae_cost_annual;

  // Displaced treatments: cost saved by switching patients from existing therapies
  const displacementCostPerPatient = (params.displacement ?? []).reduce(
    (sum, d) => sum + d.share * d.cost_annual,
    0,
  );

  const results: YearResult[] = [];

  for (let y = 0; y < years; y++) {
    const pop = Math.round(
      params.eligible_population *
        Math.pow(1 + params.population_growth_rate, y),
    );
    const share = shares[y] ?? shares[lastDefinedIdx] ?? 0;
    const treated = Math.round(pop * share);
    const untreated = pop - treated;

    const intCost = treated * interventionAnnualCost;
    const compCost = untreated * comparatorAnnualCost;
    const displacedSaved = treated * displacementCostPerPatient;

    // Net = new world cost - old world cost
    // Old world: everyone on comparator
    const oldWorldCost = pop * comparatorAnnualCost;
    const newWorldCost = intCost + compCost;
    const net = newWorldCost - oldWorldCost - displacedSaved;

    results.push({
      year: y + 1,
      eligible_population: pop,
      treated_population: treated,
      intervention_cost: intCost,
      comparator_cost: compCost,
      displaced_cost_saved: displacedSaved,
      net_budget_impact: net,
      per_patient_cost: treated > 0 ? net / treated : 0,
    });
  }

  return results;
}

export async function handleBudgetImpactModel(
  rawParams: unknown,
): Promise<ToolResult> {
  const params = BudgetImpactSchema.parse(rawParams);
  const outputFormat = params.output_format ?? "text";
  const { symbol } = CURRENCY[params.perspective];

  let audit = createAuditRecord(
    "budget_impact_model",
    params as unknown as Record<string, unknown>,
    outputFormat,
  );
  audit = setMethodology(
    audit,
    "ISPOR Budget Impact Analysis good practice (Mauskopf 2007, Sullivan 2014)",
  );
  audit = addAssumption(audit, `Perspective: ${params.perspective}`);
  audit = addAssumption(
    audit,
    `Time horizon: ${params.time_horizon_years} years`,
  );
  audit = addAssumption(
    audit,
    `Eligible population: ${params.eligible_population.toLocaleString()} (growth: ${(params.population_growth_rate * 100).toFixed(1)}%/yr)`,
  );

  const results = computeBudgetImpact(params);
  const totalNetImpact = results.reduce((s, r) => s + r.net_budget_impact, 0);
  const totalTreated = results.reduce((s, r) => s + r.treated_population, 0);

  if (outputFormat === "json") {
    return {
      content: {
        years: results,
        total_net_budget_impact: totalNetImpact,
        total_patients_treated: totalTreated,
        currency: CURRENCY[params.perspective].name,
      },
      audit,
    };
  }

  const fmt = (n: number) => `${symbol}${Math.round(n).toLocaleString()}`;

  const lines = [
    `## Budget Impact Analysis: ${params.intervention} vs ${params.comparator}`,
    `**Indication:** ${params.indication} | **Perspective:** ${params.perspective.toUpperCase()} | **Horizon:** ${params.time_horizon_years} years`,
    ``,
    `### Year-by-Year Budget Impact`,
    `| Year | Eligible Pop. | Treated | Market Share | Net Budget Impact | Per Patient |`,
    `|------|--------------|---------|-------------|-------------------|-------------|`,
    ...results.map(
      (r) =>
        `| ${r.year} | ${r.eligible_population.toLocaleString()} | ${r.treated_population.toLocaleString()} | ${((r.treated_population / r.eligible_population) * 100).toFixed(1)}% | ${fmt(r.net_budget_impact)} | ${fmt(r.per_patient_cost)} |`,
    ),
    `| **Total** | | **${totalTreated.toLocaleString()}** | | **${fmt(totalNetImpact)}** | |`,
    ``,
    `### Summary`,
    `- **Total net budget impact** over ${params.time_horizon_years} years: **${fmt(totalNetImpact)}**`,
    `- **Average per-patient annual cost difference:** ${fmt(totalNetImpact / (totalTreated || 1))}`,
    totalNetImpact > 0
      ? `- The intervention **increases** total budget by ${fmt(totalNetImpact)} over ${params.time_horizon_years} years`
      : `- The intervention **saves** ${fmt(Math.abs(totalNetImpact))} over ${params.time_horizon_years} years`,
    ``,
    params.displacement && params.displacement.length > 0
      ? `### Treatment Displacement\n${params.displacement.map((d) => `- ${d.treatment}: ${(d.share * 100).toFixed(0)}% displaced (${fmt(d.cost_annual)}/yr)`).join("\n")}\n`
      : "",
    `---`,
    `> **Disclaimer:** This is a preliminary budget impact estimate for orientation purposes only. Results require validation by a qualified health economist before use in any HTA submission or payer negotiation.`,
    ``,
    auditToMarkdown(audit),
  ]
    .filter(Boolean)
    .join("\n");

  if (outputFormat === "docx") {
    const base64 = await contentToDocx(
      "Budget Impact Analysis Report",
      lines,
      audit,
    );
    const filenameStem = `bia-${params.intervention.slice(0, 30)}-vs-${params.comparator.slice(0, 30)}`;
    const savedPath = await saveReport(base64, filenameStem, params.project);
    const sizeKb = Math.round(base64.length / 1024);
    return {
      content: `## DOCX Report Generated\n\n**File:** \`${savedPath}\`\n**Size:** ${sizeKb} KB\n\nOpen with: \`open "${savedPath}"\``,
      audit,
    };
  }

  if (outputFormat === "xlsx") {
    const { bimToXlsx } = await import("../formatters/xlsx.js");
    const buf = await bimToXlsx(
      params as unknown as Record<string, unknown>,
      results,
      audit,
    );
    const base64 = buf.toString("base64");
    const filenameStem = `bia-${params.intervention.slice(0, 30)}-vs-${params.comparator.slice(0, 30)}`;
    const savedPath = await saveReport(
      base64,
      filenameStem,
      params.project,
      "xlsx",
    );
    const sizeKb = Math.round(buf.length / 1024);
    return {
      content: `## Excel Workbook Generated\n\n**File:** \`${savedPath}\`\n**Size:** ${sizeKb} KB\n\nTabs: Summary | Inputs (editable) | Year-by-Year | Audit\n\nYellow cells = editable inputs. Local teams can localize pricing and re-run.\n\nOpen with: \`open "${savedPath}"\``,
      audit,
    };
  }

  return { content: lines, audit };
}

export const budgetImpactModelToolSchema = {
  name: "budget_impact_model",
  description:
    "Estimate the total budget impact of adopting a new intervention over 1-5 years. Follows ISPOR Budget Impact Analysis good practice guidelines (Mauskopf 2007, Sullivan 2014). Computes year-by-year net cost to payer, including market share uptake, treatment displacement, and population growth.",
  annotations: {
    title: "Budget Impact Model",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      intervention: { type: "string", description: "New drug or treatment" },
      comparator: {
        type: "string",
        description: "Current standard of care",
      },
      indication: { type: "string", description: "Disease or condition" },
      perspective: { type: "string", enum: ["nhs", "us_payer", "societal"] },
      time_horizon_years: {
        type: "number",
        description: "Budget horizon in years (1-10, default 5)",
      },
      eligible_population: {
        type: "number",
        description: "Number of eligible patients in Year 1",
      },
      population_growth_rate: {
        type: "number",
        description:
          "Annual population growth rate (e.g., 0.02 for 2%). Default 0.",
      },
      market_share: {
        type: "object",
        description:
          "Expected market share of intervention by year (0-1). Missing years extrapolate from last defined.",
        properties: {
          year_1: { type: "number" },
          year_2: { type: "number" },
          year_3: { type: "number" },
          year_4: { type: "number" },
          year_5: { type: "number" },
        },
        required: ["year_1"],
      },
      drug_cost_annual: {
        type: "number",
        description: "Annual drug acquisition cost for intervention",
      },
      comparator_cost_annual: {
        type: "number",
        description: "Annual drug cost for comparator",
      },
      admin_cost_annual: {
        type: "number",
        description:
          "Annual administration cost (applies to both arms). Default 0.",
      },
      monitoring_cost_annual: {
        type: "number",
        description: "Annual monitoring cost for intervention. Default 0.",
      },
      ae_cost_annual: {
        type: "number",
        description: "Annual adverse event cost for intervention. Default 0.",
      },
      comparator_ae_cost_annual: {
        type: "number",
        description: "Annual adverse event cost for comparator. Default 0.",
      },
      displacement: {
        type: "array",
        description:
          "Existing treatments displaced by intervention (share of patients switching, cost saved)",
        items: {
          type: "object",
          properties: {
            treatment: { type: "string" },
            share: {
              type: "number",
              description: "Fraction of treated patients displaced (0-1)",
            },
            cost_annual: {
              type: "number",
              description: "Annual cost of displaced treatment",
            },
          },
          required: ["treatment", "share", "cost_annual"],
        },
      },
      output_format: {
        type: "string",
        enum: ["text", "json", "docx", "xlsx"],
        description:
          "Use 'xlsx' for editable Excel workbook — local market-access teams can modify inputs and re-run.",
      },
      project: { type: "string", description: "Project ID for persistence" },
    },
    required: [
      "intervention",
      "comparator",
      "indication",
      "perspective",
      "eligible_population",
      "market_share",
      "drug_cost_annual",
      "comparator_cost_annual",
    ],
  },
};
