import { z } from "zod";
import type { ToolResult } from "../providers/types.js";
import {
  createAuditRecord,
  addAssumption,
  addWarning,
  setMethodology,
} from "../audit/builder.js";
import { auditToMarkdown } from "../formatters/markdown.js";
import {
  fitSurvivalCurves,
  type SurvivalFitResult,
} from "../models/survivalFitting.js";

const SurvivalFittingSchema = z.object({
  km_data: z
    .array(
      z.object({
        time: z.number().nonnegative(),
        survival: z.number().min(0).max(1),
        n_at_risk: z.number().int().positive().optional(),
        n_events: z.number().int().nonnegative().optional(),
      }),
    )
    .min(3, "At least 3 KM data points required"),
  time_unit: z.enum(["months", "years"]).default("months"),
  endpoint: z.string().default("OS"),
  output_format: z.enum(["text", "json"]).optional(),
  project: z.string().optional(),
});

function formatResult(result: SurvivalFitResult, endpoint: string): string {
  const unit = result.time_unit;

  const lines: string[] = [
    `## Survival Curve Fitting: ${endpoint}`,
    ``,
    `### Model Comparison`,
    `| Distribution | AIC | BIC | Log-L | Median (${unit}) | Parameters |`,
    `|-------------|-----|-----|-------|--------|------------|`,
  ];

  for (const fit of result.fits) {
    const paramStr = Object.entries(fit.params)
      .map(([k, v]) => `${k}=${v.toFixed(4)}`)
      .join(", ");
    const isBestAIC = fit.name === result.best_aic.name;
    const isBestBIC = fit.name === result.best_bic.name;
    const badge =
      isBestAIC && isBestBIC
        ? " **[Best]**"
        : isBestAIC
          ? " *[Best AIC]*"
          : isBestBIC
            ? " *[Best BIC]*"
            : "";

    lines.push(
      `| ${fit.name}${badge} | ${fit.aic.toFixed(1)} | ${fit.bic.toFixed(1)} | ${fit.log_likelihood.toFixed(1)} | ${fit.median_survival.toFixed(1)} | ${paramStr} |`,
    );
  }

  lines.push(``);
  lines.push(`### Recommended Model`);
  lines.push(
    `**${result.best_aic.name}** (AIC: ${result.best_aic.aic.toFixed(1)}) — median ${endpoint}: ${result.best_aic.median_survival.toFixed(1)} ${unit}`,
  );

  if (result.best_aic.name !== result.best_bic.name) {
    lines.push(
      `Note: BIC prefers **${result.best_bic.name}** — consider clinical plausibility when AIC/BIC disagree.`,
    );
  }

  lines.push(``);
  lines.push(`### Extrapolation Table`);
  lines.push(
    `| Time (${unit}) | KM Observed | Exponential | Weibull | Log-logistic | Log-normal | Gompertz |`,
  );
  lines.push(
    `|------|------------|-------------|---------|-------------|------------|----------|`,
  );

  for (const row of result.extrapolations) {
    const km = row.km_observed !== undefined ? row.km_observed.toFixed(3) : "—";
    lines.push(
      `| ${row.time.toFixed(1)} | ${km} | ${row.exponential.toFixed(3)} | ${row.weibull.toFixed(3)} | ${row.log_logistic.toFixed(3)} | ${row.log_normal.toFixed(3)} | ${row.gompertz.toFixed(3)} |`,
    );
  }

  lines.push(``);
  lines.push(`### Clinical Plausibility Check`);
  lines.push(
    `Per NICE DSU TSD 14, statistical fit (AIC/BIC) should be considered alongside:`,
  );
  lines.push(`1. **Visual fit** to the KM curve`);
  lines.push(`2. **Clinical plausibility** of the long-term extrapolation`);
  lines.push(`3. **External data** (registry data, natural history studies)`);
  lines.push(
    `4. **Hazard function shape** — does it match expected disease trajectory?`,
  );
  lines.push(``);

  const bestFit = result.best_aic;
  if (bestFit.name === "log_logistic" || bestFit.name === "log_normal") {
    lines.push(
      `> **Note:** ${bestFit.name} has a long tail — extrapolated survival may be optimistic for long time horizons. Compare against Gompertz/Weibull for conservative estimates.`,
    );
  }

  return lines.join("\n");
}

export async function handleSurvivalFitting(
  rawParams: unknown,
): Promise<ToolResult> {
  const params = SurvivalFittingSchema.parse(rawParams);
  const outputFormat = params.output_format ?? "text";

  let audit = createAuditRecord(
    "survival_fitting",
    params as unknown as Record<string, unknown>,
    outputFormat,
  );
  audit = setMethodology(
    audit,
    "Approximate parametric survival curve fitting (orientation-only). Likelihood computed from KM step-summary rows, not from individual patient event/censoring times. Model selection via AIC/BIC. For NICE DSU TSD 14 (Latimer 2013) compliant analysis, use IPD with flexsurv (R) or equivalent.",
  );
  audit = addWarning(
    audit,
    "EXPERIMENTAL: fits are based on KM summary data only. AIC/BIC values and extrapolations are approximate. Validate against IPD-based fits before using for cost-effectiveness modeling.",
  );
  const missingNAtRisk = params.km_data.filter(
    (d) => d.n_at_risk === undefined,
  ).length;
  if (missingNAtRisk > 0) {
    audit = addWarning(
      audit,
      `${missingNAtRisk} of ${params.km_data.length} KM rows missing n_at_risk — a default sample size is assumed, which reduces fit quality. Provide n_at_risk per row for more reliable AIC/BIC values.`,
    );
  }
  audit = addAssumption(
    audit,
    `${params.km_data.length} KM data points provided`,
  );
  audit = addAssumption(
    audit,
    `Endpoint: ${params.endpoint}, time unit: ${params.time_unit}`,
  );
  audit = addAssumption(
    audit,
    `Distributions fitted: Exponential, Weibull, Log-logistic, Log-normal, Gompertz`,
  );

  const result = fitSurvivalCurves(params.km_data, params.time_unit);

  if (outputFormat === "json") {
    return {
      content: {
        fits: result.fits.map((f) => ({
          name: f.name,
          params: f.params,
          aic: f.aic,
          bic: f.bic,
          log_likelihood: f.log_likelihood,
          median_survival: f.median_survival,
          mean_survival_restricted: f.mean_survival_restricted,
        })),
        best_aic: result.best_aic.name,
        best_bic: result.best_bic.name,
        extrapolations: result.extrapolations,
        time_unit: result.time_unit,
      },
      audit,
    };
  }

  const text =
    formatResult(result, params.endpoint) + "\n" + auditToMarkdown(audit);
  return { content: text, audit };
}

export const survivalFittingToolSchema = {
  name: "survival_fitting",
  description:
    "⚠️ EXPERIMENTAL. Fit parametric survival distributions (Exponential, Weibull, Log-logistic, Log-normal, Gompertz) to Kaplan-Meier SUMMARY data. Returns AIC/BIC model comparison for orientation. IMPORTANT: this fits to KM step data (time, survival proportion, n_at_risk), not individual patient-level events/censoring times. Results are approximate compared to true MLE on IPD. For NICE DSU TSD 14 compliant survival modeling, use IPD with flexsurv (R) or equivalent. Provide n_at_risk on each KM row for better fits — otherwise a default sample size is assumed.",
  annotations: {
    title: "Survival Curve Fitting",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      km_data: {
        type: "array",
        description:
          "Kaplan-Meier data points. At least 3 required. Extract from published KM curves or trial reports.",
        items: {
          type: "object",
          properties: {
            time: { type: "number", description: "Time point" },
            survival: {
              type: "number",
              description: "Survival proportion (0-1)",
            },
            n_at_risk: {
              type: "number",
              description: "Number at risk (optional, improves fit)",
            },
            n_events: {
              type: "number",
              description: "Events in interval (optional)",
            },
          },
          required: ["time", "survival"],
        },
      },
      time_unit: {
        type: "string",
        enum: ["months", "years"],
        description: "Time unit for KM data (default: months)",
      },
      endpoint: {
        type: "string",
        description: "Endpoint name (e.g., 'OS', 'PFS', 'DFS'). Default: 'OS'.",
      },
      output_format: { type: "string", enum: ["text", "json"] },
      project: { type: "string", description: "Project ID for persistence" },
    },
    required: ["km_data"],
  },
};
