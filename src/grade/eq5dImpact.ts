/**
 * Baseline-utility-aware EQ-5D 3L→5L impact estimator.
 *
 * Biz, Hernández Alava, Wailoo (2026) report category-level medians for the
 * UK 3L→5L value-set transition. The new 5L value set has compressed utilities
 * in mild–moderate health states relative to 3L (DSU mapping), which means
 * the ICER impact of the transition depends strongly on the patient cohort's
 * baseline utility:
 *
 *   - non_cancer_qol_only: utility loss is concentrated in the 0.6–0.9 zone.
 *     Drugs treating MILD chronic conditions (baseline ~0.85, e.g., mild
 *     plaque psoriasis) see the biggest ICER increase. SEVERE versions of
 *     these conditions (baseline ~0.45, e.g., severe HS Hurley III) see
 *     less impact because patients spend more time in low-utility states
 *     where 5L compression is less severe.
 *
 *   - cancer_life_extending: improvement is concentrated in severe states
 *     (5L assigns higher utility to the worst states than DSU mapping does),
 *     so a drug treating advanced/metastatic disease (baseline ~0.4) sees
 *     a bigger ICER decrease than one treating early-stage disease.
 *
 *   - non_cancer_life_extending: Biz report mixed direction (7/11 decreased,
 *     4/11 increased). Modulation is not defensible without the underlying
 *     state-by-state utility differences, so we return median + warning.
 *
 * The modulation factor is deliberately conservative — labelled as an
 * extrapolation, not a finding from the paper. Users are advised to re-run
 * their economic model with both value sets for an exact estimate.
 */

import type { IndicationType } from "../data/eq5dValueSets.js";
import { getImpactEstimate } from "../data/eq5dValueSets.js";

export interface BaselineAdjustedImpact {
  indication_type: IndicationType;
  icer_change_pct: {
    point: number;
    lower: number;
    upper: number;
  };
  is_baseline_adjusted: boolean;
  baseline_utility?: number;
  rationale: string;
}

/**
 * Modulate the published median by baseline utility.
 *
 * Reference baselines (calibrated so multiplier=1.0 ≈ published median):
 *   - non_cancer_qol_only:    ref_baseline = 0.65 (typical of NICE TA dataset)
 *   - cancer_life_extending:  ref_baseline = 0.55
 *
 * Linear scaling within plausible bounds (×0.4 to ×1.7) — wider than the
 * IQR of the published distribution to acknowledge extrapolation uncertainty.
 */
function multiplierForQolOnly(baseline: number): number {
  const ref = 0.65;
  const slope = 1.5; // each +0.1 baseline → +15% multiplier
  const raw = 1 + slope * (baseline - ref);
  return Math.min(1.7, Math.max(0.4, raw));
}

function multiplierForCancer(baseline: number): number {
  // For cancer life-extending, a LOWER baseline means BIGGER impact (more negative %).
  // ref=0.55 → multiplier=1.0
  const ref = 0.55;
  const slope = -2.0; // each +0.1 baseline → -20% multiplier (less impact)
  const raw = 1 + slope * (baseline - ref);
  return Math.min(1.7, Math.max(0.4, raw));
}

export function estimateBaselineAdjustedImpact(
  indication: IndicationType,
  baseline_utility: number | undefined,
): BaselineAdjustedImpact {
  if (baseline_utility !== undefined) {
    if (baseline_utility < 0 || baseline_utility > 1) {
      throw new Error(
        `baseline_utility must be in [0, 1]; got ${baseline_utility}`,
      );
    }
  }

  const published = getImpactEstimate(indication);
  const median = published?.median_icer_change_pct ?? 0;

  // Range for unmodulated estimate (±25% of median to reflect inter-study spread)
  const baseRange = {
    point: median,
    lower: median - Math.abs(median) * 0.25,
    upper: median + Math.abs(median) * 0.25,
  };

  if (baseline_utility === undefined) {
    return {
      indication_type: indication,
      icer_change_pct: baseRange,
      is_baseline_adjusted: false,
      rationale: `Published median for ${indication} (Biz et al. 2026, n=${published?.examples?.length ?? 0} indication examples).`,
    };
  }

  if (indication === "non_cancer_life_extending") {
    return {
      indication_type: indication,
      icer_change_pct: baseRange,
      is_baseline_adjusted: false,
      baseline_utility,
      rationale:
        "Mixed/heterogeneous direction in Biz 2026 (7/11 decreased, 4/11 increased) — cannot reliably modulate by baseline utility. Re-run the model with both value sets for an exact estimate.",
    };
  }

  let multiplier: number;
  let directionalNote: string;
  if (indication === "non_cancer_qol_only") {
    multiplier = multiplierForQolOnly(baseline_utility);
    directionalNote =
      baseline_utility > 0.75
        ? `MILD baseline utility (${baseline_utility.toFixed(2)}) → 5L compression in mild-moderate states hits this cohort harder; expect larger ICER increase than category median.`
        : baseline_utility < 0.55
          ? `SEVERE baseline utility (${baseline_utility.toFixed(2)}) → patients spend more time in low-utility states where 5L compression is less severe; expect smaller ICER increase than category median.`
          : `Baseline utility (${baseline_utility.toFixed(2)}) near typical NICE TA dataset average — expect impact close to published median.`;
  } else {
    multiplier = multiplierForCancer(baseline_utility);
    directionalNote =
      baseline_utility < 0.45
        ? `Advanced/metastatic disease (baseline=${baseline_utility.toFixed(2)}) — 5L assigns higher utility to severe states than DSU mapping; expect larger ICER decrease than median.`
        : baseline_utility > 0.65
          ? `Earlier-stage disease (baseline=${baseline_utility.toFixed(2)}) — patients spend less time in severe states; expect smaller ICER decrease than median.`
          : `Baseline utility (${baseline_utility.toFixed(2)}) near typical advanced-cancer dataset average — expect impact close to published median.`;
  }

  const adjustedPoint = median * multiplier;
  return {
    indication_type: indication,
    icer_change_pct: {
      point: adjustedPoint,
      lower: adjustedPoint - Math.abs(adjustedPoint) * 0.30,
      upper: adjustedPoint + Math.abs(adjustedPoint) * 0.30,
    },
    is_baseline_adjusted: true,
    baseline_utility,
    rationale: `${directionalNote} This is an EXTRAPOLATION beyond Biz 2026 (which reports only category-level medians) — not a direct finding. Approximation: multiplier ${multiplier.toFixed(2)}× applied to published median ${median}%. Validate by re-running your model under both value sets.`,
  };
}
