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
  fitSurvivalCurvesFromEventData,
  type SurvivalFitResult,
} from "../models/survivalFitting.js";

const SurvivalFittingSchema = z
  .object({
    km_data: z
      .array(
        z.object({
          time: z.number().nonnegative(),
          survival: z.number().min(0).max(1),
          n_at_risk: z.number().int().positive().optional(),
          n_events: z.number().int().nonnegative().optional(),
        }),
      )
      .min(3, "At least 3 KM data points required")
      .optional(),
    /**
     * v1.9.0 IPD path. Patient-level event/censoring rows. When supplied,
     * triggers true right-censored MLE per Collett 2015 / NICE DSU TSD 14.
     * `event=1` for an observed event at `time`; `event=0` for right-
     * censoring at `time`. At least 5 rows required for stable fitting.
     */
    event_data: z
      .array(
        z.object({
          time: z.number().nonnegative(),
          event: z.union([z.literal(0), z.literal(1)]),
        }),
      )
      .min(5, "At least 5 patient-level event-data rows required")
      .optional(),
    time_unit: z.enum(["months", "years"]).default("months"),
    endpoint: z.string().default("OS"),
    output_format: z.enum(["text", "json"]).optional(),
    project: z.string().optional(),
  })
  .refine((d) => (d.km_data && !d.event_data) || (!d.km_data && d.event_data), {
    message:
      "Provide exactly one of `km_data` (KM step-summary, legacy approximation) or `event_data` (patient-level, true MLE — preferred per NICE DSU TSD 14).",
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
  const usingEventData = !!params.event_data;

  let audit = createAuditRecord(
    "evidence.survival",
    params as unknown as Record<string, unknown>,
    outputFormat,
  );

  if (usingEventData) {
    audit = setMethodology(
      audit,
      "Right-censored maximum likelihood estimation on patient-level event-time data per Collett (2015) and NICE DSU TSD 14 (Latimer 2013). Log-likelihood = Σᵢ [δᵢ·log(f(tᵢ)) + (1-δᵢ)·log(S(tᵢ))], where δᵢ=1 for observed events and 0 for right-censoring. Optimization via Nelder-Mead simplex. Model selection via AIC/BIC. KM curve estimated from the same event data using the standard Kaplan-Meier estimator.",
    );
    audit = addAssumption(
      audit,
      `${params.event_data!.length} patient-level event-data rows provided (${params.event_data!.filter((d) => d.event === 1).length} events, ${params.event_data!.filter((d) => d.event === 0).length} censored)`,
    );
  } else {
    audit = setMethodology(
      audit,
      "Approximate parametric survival curve fitting from KM step-summary data. Likelihood backs out events/censored from survival drops between consecutive KM rows — this is an interval-censored approximation, not true patient-level MLE. For NICE DSU TSD 14 (Latimer 2013) compliant analysis, supply patient-level event_data instead.",
    );
    audit = addWarning(
      audit,
      "KM step-summary path is an APPROXIMATION. AIC/BIC values and extrapolations are less reliable than patient-level MLE. When you have access to IPD, supply event_data instead of km_data — same tool, true MLE, no warning.",
    );
    const missingNAtRisk = params.km_data!.filter(
      (d) => d.n_at_risk === undefined,
    ).length;
    if (missingNAtRisk > 0) {
      audit = addWarning(
        audit,
        `${missingNAtRisk} of ${params.km_data!.length} KM rows missing n_at_risk — a default sample size is assumed, which reduces fit quality. Provide n_at_risk per row for more reliable AIC/BIC values.`,
      );
    }
    audit = addAssumption(
      audit,
      `${params.km_data!.length} KM data points provided`,
    );
  }
  audit = addAssumption(
    audit,
    `Endpoint: ${params.endpoint}, time unit: ${params.time_unit}`,
  );
  audit = addAssumption(
    audit,
    `Distributions fitted: Exponential, Weibull, Log-logistic, Log-normal, Gompertz`,
  );

  const result = usingEventData
    ? fitSurvivalCurvesFromEventData(params.event_data!, params.time_unit)
    : fitSurvivalCurves(params.km_data!, params.time_unit);

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
  name: "evidence.survival",
  description:
    "Fit parametric survival distributions (Exponential, Weibull, Log-logistic, Log-normal, Gompertz) to either patient-level event-time data (preferred — true right-censored MLE per Collett 2015 / NICE DSU TSD 14) OR Kaplan-Meier step-summary data (legacy approximation, used when only published KM digitization is available). Returns AIC/BIC model comparison and extrapolation table. Supply EXACTLY ONE of `event_data` (patient-level rows) or `km_data` (KM table).",
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
      event_data: {
        type: "array",
        description:
          "Patient-level event-time rows (PREFERRED — true MLE per NICE DSU TSD 14). Each row: { time, event } where event=1 for an observed event, event=0 for right-censoring. At least 5 rows required.",
        items: {
          type: "object",
          properties: {
            time: { type: "number", description: "Event or censoring time" },
            event: {
              type: "integer",
              enum: [0, 1],
              description: "1 = event observed; 0 = right-censored",
            },
          },
          required: ["time", "event"],
        },
      },
      km_data: {
        type: "array",
        description:
          "Kaplan-Meier step-summary data points (LEGACY approximation; use event_data when patient-level data is available). At least 3 required. Extract from published KM curves or trial reports.",
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
    // Caller supplies EXACTLY ONE of event_data / km_data — enforced at
    // runtime by the Zod .refine() above. Top-level `required` left
    // empty so the JSON Schema doesn't falsely demand both.
    required: [],
  },
};
