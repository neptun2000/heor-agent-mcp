/**
 * MFN price-sensitivity sweep for the cost-effectiveness model (design log #27).
 *
 * Given a basket-driven MFN ceiling and the drug's current US net price,
 * sweep the price across that range at N discrete points and report the
 * ICER at each. Cheaper alternative to a full PSA re-run — produces a
 * curve users can read directly: "at the MFN ceiling, ICER drops to $X;
 * the WTP crossover happens at price $Y."
 *
 * Why a deterministic sweep rather than another Monte Carlo CEAC?
 *
 *   - The MFN scenario is an exogenous price shock, not statistical
 *     uncertainty. Treating it as a CEAC over a uniform distribution
 *     conflates two distinct questions.
 *   - A 11-point sweep is ~11 model runs vs PSA's 1000+. Ships fast.
 *   - The output (ICER per price point + crossover price) is more
 *     payer-readable than another CEAC slide.
 *
 * If a true MFN-stressed PSA is needed later, this module stays — it's
 * the deterministic complement.
 */

import type { CEModelParams } from "../providers/types.js";

export type CEModelInputs = CEModelParams;

export interface MfnSensitivityInputs {
  /** Lower bound of the price sweep — typically min(basket excluding US). */
  min_basket: number;
  /** Upper bound — typically the drug's current US net price. */
  current_us_price: number;
  /** Number of price points to sweep (default 11 → step every 10% of range). */
  n_points?: number;
  /**
   * Willingness-to-pay threshold(s) for crossover detection. When the
   * ICER curve crosses any of these as price falls, we record the
   * approximate crossover price. Defaults match the WTP catalog used
   * elsewhere in this module: NHS £30K, US $100K, US $150K.
   */
  wtp_thresholds?: number[];
}

export interface MfnSensitivityPoint {
  drug_price: number;
  /** ICER at this price; Infinity when delta_qaly <= 0. */
  icer: number;
}

export interface MfnCrossover {
  wtp: number;
  /**
   * Approximate price where ICER = wtp. Null when the ICER never
   * crosses the threshold over the sweep range (cost-effective at
   * every point, or cost-INeffective at every point).
   */
  crossover_price: number | null;
}

export interface MfnSensitivityResult {
  /** Echoes inputs so the caller can stamp the output for audit. */
  range: { min_basket: number; current_us_price: number; n_points: number };
  /** ICER per price point, ordered low-price → high-price. */
  curve: MfnSensitivityPoint[];
  /** Crossover prices per WTP threshold (linear interpolation between points). */
  crossovers: MfnCrossover[];
  /** ICER at the MFN ceiling itself (min_basket); first point in `curve`. */
  icer_at_ceiling: number;
  /** ICER at the unstressed US price; last point in `curve`. */
  icer_at_current: number;
}

const DEFAULT_WTP = [30000, 100000, 150000];

/**
 * Run the price sweep. The caller injects a `runModel` callback so this
 * module stays decoupled from the Markov / PartSA implementations and
 * is trivially mockable in tests.
 *
 * Returns sorted by ascending price. Crossover prices use linear
 * interpolation between adjacent points — accurate enough for the
 * payer-conversation purpose; not a root-finding bisection.
 */
export function runMfnSensitivity(
  baseParams: CEModelInputs,
  inputs: MfnSensitivityInputs,
  runModel: (params: CEModelInputs) => { icer: number },
): MfnSensitivityResult {
  const n = Math.max(2, inputs.n_points ?? 11);
  if (!Number.isFinite(inputs.min_basket) || !Number.isFinite(inputs.current_us_price)) {
    throw new TypeError(
      "runMfnSensitivity: min_basket and current_us_price must be finite numbers",
    );
  }
  if (inputs.min_basket < 0 || inputs.current_us_price < 0) {
    throw new TypeError(
      "runMfnSensitivity: prices must be non-negative",
    );
  }
  if (inputs.min_basket > inputs.current_us_price) {
    throw new TypeError(
      `runMfnSensitivity: min_basket (${inputs.min_basket}) must be <= current_us_price (${inputs.current_us_price})`,
    );
  }

  const step = (inputs.current_us_price - inputs.min_basket) / (n - 1);
  const curve: MfnSensitivityPoint[] = [];

  for (let i = 0; i < n; i++) {
    const price = inputs.min_basket + step * i;
    const perturbed: CEModelInputs = {
      ...baseParams,
      cost_inputs: {
        ...baseParams.cost_inputs,
        drug_cost_annual: price,
      },
    };
    const { icer } = runModel(perturbed);
    curve.push({ drug_price: price, icer });
  }

  const thresholds = inputs.wtp_thresholds ?? DEFAULT_WTP;
  const crossovers: MfnCrossover[] = thresholds.map((wtp) => ({
    wtp,
    crossover_price: findCrossover(curve, wtp),
  }));

  return {
    range: {
      min_basket: inputs.min_basket,
      current_us_price: inputs.current_us_price,
      n_points: n,
    },
    curve,
    crossovers,
    icer_at_ceiling: curve[0]!.icer,
    icer_at_current: curve[curve.length - 1]!.icer,
  };
}

/**
 * Find the price at which the ICER curve crosses `wtp` using linear
 * interpolation between adjacent points. Returns null when the curve
 * doesn't cross — either ICER stays below wtp everywhere (cost-effective
 * at every price in range) or stays above (cost-INeffective everywhere).
 *
 * Infinity ICERs (delta_qaly <= 0) are treated as "doesn't cross" rather
 * than collapsing the interpolation — a degenerate iteration shouldn't
 * fabricate a crossover.
 */
function findCrossover(
  curve: MfnSensitivityPoint[],
  wtp: number,
): number | null {
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i]!;
    const b = curve[i + 1]!;
    if (!Number.isFinite(a.icer) || !Number.isFinite(b.icer)) continue;
    const aDelta = a.icer - wtp;
    const bDelta = b.icer - wtp;
    if (aDelta === 0) return a.drug_price;
    if (bDelta === 0) return b.drug_price;
    if (aDelta * bDelta < 0) {
      // Sign change between a and b → interpolate.
      const t = aDelta / (aDelta - bDelta);
      return a.drug_price + t * (b.drug_price - a.drug_price);
    }
  }
  return null;
}
