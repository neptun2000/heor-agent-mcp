/**
 * Comparative class-level safety profiling from spontaneous-report data
 * (FAERS / EudraVigilance / VigiBase). Pure math, no I/O.
 *
 * Where pv_signal_workflow scores ONE drug × ONE adverse event, this ranks
 * MANY adverse events across MANY products in a therapeutic class and lays
 * them side-by-side — the "Top-N ranking adverse events, reporting rate per
 * 1,000 exposed, by product" view used in real-world class safety analyses.
 *
 * Two complementary metrics:
 *   1. Reporting rate per 1,000 exposed = drug-event reports / exposed × 1000
 *      (requires an exposure denominator per product).
 *   2. Disproportionality (PRR/ROR/IC/EBGM) per drug-AE pair — reuses the
 *      pv_signal_workflow statistics — when the database 2×2 marginals
 *      (per-product total reports, per-AE event total, database grand total)
 *      are supplied.
 *
 * Reporting rates and disproportionality scores derived from spontaneous
 * reports are descriptive/hypothesis-generating: they reflect reporting
 * behaviour, not incidence, and cannot be compared across products as if
 * they were risks. Callers must treat the ranking as a reporting profile.
 */
import { computeAllStats } from "./signalDecision.js";

export interface AdverseEventInput {
  name: string;
  /** a — reports of THIS product AND THIS event. */
  drug_event_count: number;
  /** a+c — all reports of THIS event in the database (enables disproportionality). */
  event_total?: number;
  /** Serious (fatal / life-threatening / hospitalisation) → lower signal thresholds. */
  serious?: boolean;
}

export interface ProductInput {
  name: string;
  /** Exposure denominator for the reporting rate per 1,000 exposed. */
  exposed_population?: number;
  /** a+b — all reports of THIS product in the database (enables disproportionality). */
  total_reports?: number;
  adverse_events: AdverseEventInput[];
}

export interface ComparativeSafetyInput {
  drug_class: string;
  indication: string;
  data_source: string;
  reporting_period_months?: number;
  /** a+b+c+d — all reports in the database (enables disproportionality). */
  grand_total?: number;
  top_n: number;
  products: ProductInput[];
  /** Adverse events to report on explicitly across all products (e.g. "cardiovascular"). */
  events_of_interest: string[];
}

export interface RankedAe {
  rank: number;
  name: string;
  count: number;
  reporting_rate_per_1000: number | null;
  serious: boolean;
  disproportionality: {
    prr: number;
    ror: number;
    ic025: number;
    eb05: number;
    signal: boolean;
  } | null;
}

export interface ProductRanking {
  product: string;
  exposed_population: number | null;
  ranked: RankedAe[];
  ranked_by: "reporting_rate" | "report_count";
}

export interface ClassComparisonCell {
  product: string;
  rank: number | null; // null = not in this product's top-N (or absent)
  count: number | null;
  reporting_rate_per_1000: number | null;
}

export interface ClassComparisonRow {
  adverse_event: string;
  cells: ClassComparisonCell[];
}

export interface EventOfInterestFinding {
  adverse_event: string;
  in_top_n_for: string[];
  not_in_top_n_for: string[];
  absent_from: string[];
}

export interface ComparativeSafetyResult {
  drug_class: string;
  indication: string;
  data_source: string;
  top_n: number;
  per_product: ProductRanking[];
  class_comparison: ClassComparisonRow[];
  events_of_interest_findings: EventOfInterestFinding[];
  observations: string[];
  warnings: string[];
  disproportionality_computed: boolean;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function rankProduct(
  product: ProductInput,
  input: ComparativeSafetyInput,
): ProductRanking {
  const hasExposure =
    typeof product.exposed_population === "number" &&
    product.exposed_population > 0;
  const ranked_by: ProductRanking["ranked_by"] = hasExposure
    ? "reporting_rate"
    : "report_count";

  const enriched = product.adverse_events.map((ae) => {
    const rate = hasExposure
      ? (ae.drug_event_count / (product.exposed_population as number)) * 1000
      : null;

    let disproportionality: RankedAe["disproportionality"] = null;
    if (
      typeof input.grand_total === "number" &&
      typeof product.total_reports === "number" &&
      typeof ae.event_total === "number"
    ) {
      const stats = computeAllStats(
        {
          drug_event: ae.drug_event_count,
          drug_total: product.total_reports,
          event_total: ae.event_total,
          grand_total: input.grand_total,
        },
        ae.serious ?? false,
      );
      const triggers = [
        stats.prr.threshold_met,
        stats.ror.threshold_met,
        stats.ic.threshold_met,
        stats.mgps.threshold_met,
      ].filter(Boolean).length;
      disproportionality = {
        prr: stats.prr.value,
        ror: stats.ror.value,
        ic025: stats.ic.ic025,
        eb05: stats.mgps.eb05,
        signal: triggers >= 2,
      };
    }

    return {
      name: ae.name,
      count: ae.drug_event_count,
      reporting_rate_per_1000: rate,
      serious: ae.serious ?? false,
      disproportionality,
    };
  });

  // Sort by the primary metric desc, tie-break by count desc then name asc
  // for deterministic output.
  enriched.sort((a, b) => {
    const aKey = hasExposure
      ? (a.reporting_rate_per_1000 as number)
      : a.count;
    const bKey = hasExposure
      ? (b.reporting_rate_per_1000 as number)
      : b.count;
    if (bKey !== aKey) return bKey - aKey;
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name);
  });

  const ranked: RankedAe[] = enriched
    .slice(0, input.top_n)
    .map((e, i) => ({ rank: i + 1, ...e }));

  return {
    product: product.name,
    exposed_population: hasExposure
      ? (product.exposed_population as number)
      : null,
    ranked,
    ranked_by,
  };
}

/** Build the side-by-side class comparison for every AE appearing in any top-N. */
function buildClassComparison(
  rankings: ProductRanking[],
): ClassComparisonRow[] {
  // Union of AE names that appear in at least one product's top-N, keyed by
  // normalised name but preserving the first-seen display label.
  const labelByKey = new Map<string, string>();
  for (const r of rankings) {
    for (const ae of r.ranked) {
      const k = norm(ae.name);
      if (!labelByKey.has(k)) labelByKey.set(k, ae.name);
    }
  }

  const rows: ClassComparisonRow[] = [];
  for (const [key, label] of labelByKey) {
    const cells: ClassComparisonCell[] = rankings.map((r) => {
      const hit = r.ranked.find((ae) => norm(ae.name) === key);
      return {
        product: r.product,
        rank: hit ? hit.rank : null,
        count: hit ? hit.count : null,
        reporting_rate_per_1000: hit ? hit.reporting_rate_per_1000 : null,
      };
    });
    rows.push({ adverse_event: label, cells });
  }

  // Order rows by best (lowest) rank achieved across products.
  rows.sort((a, b) => {
    const bestA = Math.min(
      ...a.cells.map((c) => c.rank ?? Number.POSITIVE_INFINITY),
    );
    const bestB = Math.min(
      ...b.cells.map((c) => c.rank ?? Number.POSITIVE_INFINITY),
    );
    if (bestA !== bestB) return bestA - bestB;
    return a.adverse_event.localeCompare(b.adverse_event);
  });

  return rows;
}

function findEventsOfInterest(
  input: ComparativeSafetyInput,
  rankings: ProductRanking[],
): EventOfInterestFinding[] {
  return input.events_of_interest.map((eoi) => {
    const k = norm(eoi);
    const in_top_n_for: string[] = [];
    const not_in_top_n_for: string[] = [];
    const absent_from: string[] = [];
    for (let i = 0; i < input.products.length; i++) {
      const product = input.products[i];
      const ranking = rankings[i];
      const inTop = ranking.ranked.some((ae) => norm(ae.name).includes(k));
      const present = product.adverse_events.some((ae) =>
        norm(ae.name).includes(k),
      );
      if (inTop) in_top_n_for.push(product.name);
      else if (present) not_in_top_n_for.push(product.name);
      else absent_from.push(product.name);
    }
    return {
      adverse_event: eoi,
      in_top_n_for,
      not_in_top_n_for,
      absent_from,
    };
  });
}

function buildObservations(
  input: ComparativeSafetyInput,
  rankings: ProductRanking[],
  comparison: ClassComparisonRow[],
  eoiFindings: EventOfInterestFinding[],
): string[] {
  const out: string[] = [];

  // AEs common to every product's top-N → the shared class profile.
  const allProducts = rankings.map((r) => r.product);
  const common = comparison.filter((row) =>
    row.cells.every((c) => c.rank !== null),
  );
  if (common.length > 0) {
    out.push(
      `Reported across all ${allProducts.length} products' top ${input.top_n}: ${common
        .map((r) => r.adverse_event)
        .join(", ")} — the shared class reporting profile.`,
    );
  }

  // AEs that rank for exactly one product → differentiators.
  for (const row of comparison) {
    const ranked = row.cells.filter((c) => c.rank !== null);
    if (ranked.length === 1) {
      const cell = ranked[0];
      out.push(
        `${row.adverse_event} ranks #${cell.rank} for ${cell.product} but does not reach the top ${input.top_n} for the other product(s) — a product-level differentiator.`,
      );
    }
  }

  // Events of interest call-outs (e.g. cardiovascular).
  for (const f of eoiFindings) {
    if (f.in_top_n_for.length === 0) {
      out.push(
        `${f.adverse_event}: did NOT rank in the top ${input.top_n} for any product${
          f.absent_from.length === input.products.length
            ? " (not reported for any product in the supplied data)"
            : ""
        }.`,
      );
    } else {
      out.push(
        `${f.adverse_event}: in the top ${input.top_n} for ${f.in_top_n_for.join(", ")}${
          f.not_in_top_n_for.length
            ? `; below the top ${input.top_n} for ${f.not_in_top_n_for.join(", ")}`
            : ""
        }.`,
      );
    }
  }

  return out;
}

export function computeComparativeSafety(
  input: ComparativeSafetyInput,
): ComparativeSafetyResult {
  const warnings: string[] = [];

  const per_product = input.products.map((p) => rankProduct(p, input));

  // Mixed ranking basis → comparison across products is not apples-to-apples.
  const bases = new Set(per_product.map((r) => r.ranked_by));
  if (bases.size > 1) {
    warnings.push(
      "Products are ranked on different bases (some by reporting rate per 1,000 exposed, some by raw report count) because exposure denominators were supplied for only some products. Cross-product comparison is not directly comparable — supply exposed_population for every product for a like-for-like ranking.",
    );
  } else if (per_product.every((r) => r.ranked_by === "report_count")) {
    warnings.push(
      "No exposure denominators supplied — ranking uses raw report counts, which are confounded by differential market exposure and reporting. Supply exposed_population per product to rank by reporting rate per 1,000 exposed.",
    );
  }

  const disproportionality_computed = per_product.some((r) =>
    r.ranked.some((ae) => ae.disproportionality !== null),
  );
  if (!disproportionality_computed) {
    warnings.push(
      "Disproportionality (PRR/ROR/IC/EBGM) not computed — supply grand_total, per-product total_reports, and per-AE event_total to add signal-detection statistics alongside the reporting-rate ranking.",
    );
  }

  // Standing caveat: spontaneous-report rates are not incidence.
  warnings.push(
    "Reporting rates and disproportionality from spontaneous reports reflect reporting behaviour, not incidence or risk. Use this ranking as a comparative reporting profile (hypothesis-generating), not as a head-to-head safety comparison.",
  );

  const class_comparison = buildClassComparison(per_product);
  const events_of_interest_findings = findEventsOfInterest(input, per_product);
  const observations = buildObservations(
    input,
    per_product,
    class_comparison,
    events_of_interest_findings,
  );

  return {
    drug_class: input.drug_class,
    indication: input.indication,
    data_source: input.data_source,
    top_n: input.top_n,
    per_product,
    class_comparison,
    events_of_interest_findings,
    observations,
    warnings,
    disproportionality_computed,
  };
}
