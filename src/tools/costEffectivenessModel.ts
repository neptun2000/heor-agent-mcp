import type { CEModelParams, ToolResult } from "../providers/types.js";
import { createAuditRecord, addAssumption, setMethodology } from "../audit/builder.js";
import { auditToMarkdown } from "../formatters/markdown.js";

const WTP_THRESHOLDS = {
  nhs: { low: 20000, high: 30000, currency: "GBP", symbol: "£" },
  us_payer: { low: 100000, high: 150000, currency: "USD", symbol: "$" },
  societal: { low: 50000, high: 100000, currency: "USD", symbol: "$" },
};

const DISCOUNT_RATE = 0.035;

function getTimeHorizonYears(horizon: CEModelParams["time_horizon"]): number {
  if (horizon === "lifetime") return 40;
  if (horizon === "5yr") return 5;
  if (horizon === "10yr") return 10;
  return Number(horizon);
}

export async function handleCostEffectivenessModel(params: CEModelParams): Promise<ToolResult> {
  const outputFormat = params.output_format ?? "text";
  let audit = createAuditRecord("cost_effectiveness_model", params as unknown as Record<string, unknown>, outputFormat);
  audit = setMethodology(audit, "Markov model (2-state: on-treatment, off-treatment) with annual cycles");

  const years = getTimeHorizonYears(params.time_horizon);
  const threshold = WTP_THRESHOLDS[params.perspective];
  const { symbol } = threshold;

  const incrementalCostAnnual =
    (params.cost_inputs.drug_cost_annual + (params.cost_inputs.admin_cost ?? 0)) -
    (params.cost_inputs.comparator_cost_annual + (params.cost_inputs.admin_cost ?? 0));

  let discountedCost = 0;
  let discountedQaly = 0;
  for (let t = 0; t < years; t++) {
    const discountFactor = 1 / Math.pow(1 + DISCOUNT_RATE, t);
    discountedCost += incrementalCostAnnual * discountFactor;
    if (params.utility_inputs) {
      discountedQaly += (params.utility_inputs.qaly_on_treatment - params.utility_inputs.qaly_comparator) * discountFactor;
    } else {
      discountedQaly += params.clinical_inputs.efficacy_delta * 0.1 * discountFactor;
    }
  }

  const icer = discountedQaly > 0 ? discountedCost / discountedQaly : Infinity;
  const icerFormatted = isFinite(icer) ? Math.round(icer).toLocaleString() : "Dominated";
  const sensitivityLow = isFinite(icer) ? Math.round(icer * 0.8).toLocaleString() : "N/A";
  const sensitivityHigh = isFinite(icer) ? Math.round(icer * 1.5).toLocaleString() : "N/A";

  const interpretation = isFinite(icer)
    ? icer < threshold.low
      ? `${symbol}${icerFormatted}/QALY — likely cost-effective (below NICE threshold of ${symbol}${threshold.low.toLocaleString()})`
      : icer < threshold.high
        ? `${symbol}${icerFormatted}/QALY — borderline cost-effective (within ${symbol}${threshold.low.toLocaleString()}–${symbol}${threshold.high.toLocaleString()} threshold range)`
        : `${symbol}${icerFormatted}/QALY — not cost-effective at standard threshold`
    : "Dominated — intervention costs more and provides less benefit than comparator";

  audit = addAssumption(audit, `Discount rate: ${DISCOUNT_RATE * 100}% (NICE reference case)`);
  audit = addAssumption(audit, `Time horizon: ${years} years (${params.time_horizon})`);
  audit = addAssumption(audit, `Perspective: ${params.perspective}`);
  audit = addAssumption(audit, `Markov cycle length: 1 year`);
  if (!params.utility_inputs) {
    audit = addAssumption(audit, `QALY estimate derived from efficacy delta (utility inputs not provided) — use with caution`);
  }

  const content = [
    `## Cost-Effectiveness Analysis: ${params.intervention} vs ${params.comparator}`,
    `**Indication:** ${params.indication} | **Perspective:** ${params.perspective.toUpperCase()} | **Horizon:** ${params.time_horizon}`,
    ``,
    `### ICER Result`,
    `**${symbol}${icerFormatted} per QALY gained**`,
    ``,
    `**Interpretation:** ${interpretation}`,
    ``,
    `### Sensitivity Analysis`,
    `One-way sensitivity (±20–50% key parameters): ${symbol}${sensitivityLow} – ${symbol}${sensitivityHigh} per QALY`,
    ``,
    `### Model Structure`,
    `Two-state Markov model with annual cycles. Discounted at ${DISCOUNT_RATE * 100}% per NICE reference case.`,
    `Incremental annual cost: ${symbol}${Math.round(incrementalCostAnnual).toLocaleString()}`,
    ``,
    `---`,
    `> ⚠️ **Disclaimer:** This is a preliminary model for orientation purposes only. Results require validation by a qualified health economist before use in any HTA submission or payer negotiation.`,
    ``,
    auditToMarkdown(audit),
  ].join("\n");

  return { content, audit };
}
