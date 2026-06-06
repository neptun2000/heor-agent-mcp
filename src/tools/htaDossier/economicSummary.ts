/**
 * Shared economic-summary extraction + placeholder-aware rendering for
 * dossier prose. Consumed by both the GVD section router and the
 * NICE/EMA/FDA/IQWiG/HAS `buildSection` path so the placeholder banner and
 * gating stay identical across dossier formats.
 *
 * Design log #37 — the `_placeholder` guard set upstream in hta_workflow
 * (design log #35) must reach the renderers. The CE result rides through
 * Zod intact because CEModelResultSchema is `.passthrough()`.
 */

export interface EconomicSummary {
  /** Deterministic ICER from `base_case.icer` (or top-level `icer` fallback). */
  icer?: number;
  /** `model_results.currency` when stamped, else "USD" (no perspective field on the dossier yet). */
  currency: string;
  /** True when the ICER was derived from DEFAULTED inputs (hta_workflow placeholder mode). */
  placeholder: boolean;
  /** Names of the inputs that were defaulted (for the banner). */
  defaultedInputs: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Pull the economic figures + placeholder flags out of a `cost_effectiveness_model`
 * result object (the shape piped as `hta_dossier({ model_results })`).
 */
export function extractEconomicSummary(modelResults: unknown): EconomicSummary {
  const mr = isRecord(modelResults) ? modelResults : {};
  const baseCase = isRecord(mr.base_case) ? mr.base_case : {};

  const icer =
    typeof baseCase.icer === "number"
      ? baseCase.icer
      : typeof mr.icer === "number"
        ? mr.icer
        : undefined;

  const defaultedInputs = Array.isArray(mr._defaulted_inputs)
    ? mr._defaulted_inputs.filter((x): x is string => typeof x === "string")
    : [];

  return {
    icer,
    currency: typeof mr.currency === "string" ? mr.currency : "USD",
    placeholder: mr._placeholder === true,
    defaultedInputs,
  };
}

/**
 * The shared ⚠️ banner emitted whenever a placeholder ICER would otherwise be
 * rendered as authoritative prose. Mirrors the wording hta_workflow uses in its
 * audit warning so the two layers read consistently.
 */
export function renderPlaceholderBanner(s: EconomicSummary): string {
  const defaulted =
    s.defaultedInputs.length > 0
      ? s.defaultedInputs.join(", ")
      : "unspecified economic inputs";
  const icerText =
    s.icer != null ? `${s.currency} ${s.icer.toLocaleString()}/QALY` : "the value below";
  return (
    `⚠️ **PLACEHOLDER ICER — NOT VALID FOR SUBMISSION.** ` +
    `${icerText} was derived from DEFAULTED inputs (${defaulted}); ` +
    `no cost-effectiveness conclusion can be drawn. Supply real \`ce_inputs\` ` +
    `(or pipe a \`cost_effectiveness_model\` run with actual costs and utilities) before using this figure.`
  );
}
