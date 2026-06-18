/**
 * Pure claim extractors: map a tool's structured result onto candidate
 * claims for the registry, so the "single source of truth" self-populates
 * instead of manual upserts. No I/O.
 *
 * Recognises the result shapes of models.cost_effectiveness and
 * models.budget_impact. Unknown sources return [] (the caller warns).
 * Defensive: navigates optional fields and skips anything missing or
 * non-finite — never throws on a partial/odd result.
 */

export interface ExtractedClaim {
  id: string;
  statement: string;
  numeric_value?: number;
  value_display?: string;
  unit?: string;
  keywords: string[];
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function num(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function round(n: number): number {
  // Whole numbers for money/QALY scale; 3 dp for small QALY deltas.
  return Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 1000) / 1000;
}

function group(n: number): string {
  return round(n).toLocaleString("en-US");
}

function extractCostEffectiveness(result: unknown): ExtractedClaim[] {
  const root = isRecord(result) ? result : {};
  // Accept either the raw modelResult or a {content: modelResult} envelope.
  const model = isRecord(root.base_case)
    ? root
    : isRecord(root.content)
      ? (root.content as Record<string, unknown>)
      : root;
  const base = isRecord(model.base_case) ? model.base_case : undefined;
  if (!base) return [];

  const out: ExtractedClaim[] = [];
  const icer = num(base.icer);
  if (icer !== null) {
    out.push({
      id: "icer-base-case",
      statement: `Base-case ICER is ${group(icer)} per QALY`,
      numeric_value: round(icer),
      value_display: group(icer),
      unit: "per QALY",
      keywords: ["ICER", "per QALY"],
    });
  }
  const dQaly = num(base.delta_qaly);
  if (dQaly !== null) {
    out.push({
      id: "incremental-qalys",
      statement: `Incremental QALYs vs comparator: ${round(dQaly)}`,
      numeric_value: round(dQaly),
      value_display: String(round(dQaly)),
      unit: "QALYs",
      keywords: ["incremental QALY", "QALYs gained", "incremental QALYs"],
    });
  }
  const dCost = num(base.delta_cost);
  if (dCost !== null) {
    out.push({
      id: "incremental-cost",
      statement: `Incremental cost vs comparator: ${group(dCost)}`,
      numeric_value: round(dCost),
      value_display: group(dCost),
      unit: "currency",
      keywords: ["incremental cost"],
    });
  }
  return out;
}

function extractBudgetImpact(result: unknown): ExtractedClaim[] {
  const root = isRecord(result) ? result : {};
  const model = isRecord(root.summary)
    ? root
    : isRecord(root.content)
      ? (root.content as Record<string, unknown>)
      : root;
  const summary = isRecord(model.summary) ? model.summary : undefined;
  if (!summary) return [];

  const net = num(summary.total_net_budget_impact);
  if (net === null) return [];
  const currency =
    typeof summary.currency === "string" ? summary.currency : "";
  const disp = `${currency ? currency + " " : ""}${group(net)}`.trim();
  return [
    {
      id: "net-budget-impact",
      statement: `Total net budget impact: ${disp}`,
      numeric_value: round(net),
      value_display: disp,
      unit: currency || "currency",
      keywords: ["net budget impact", "budget impact"],
    },
  ];
}

const EXTRACTORS: Record<string, (r: unknown) => ExtractedClaim[]> = {
  "models.cost_effectiveness": extractCostEffectiveness,
  "models.budget_impact": extractBudgetImpact,
};

export const SUPPORTED_IMPORT_SOURCES = Object.keys(EXTRACTORS);

export function extractClaims(
  sourceTool: string,
  result: unknown,
): ExtractedClaim[] {
  const fn = EXTRACTORS[sourceTool];
  return fn ? fn(result) : [];
}
