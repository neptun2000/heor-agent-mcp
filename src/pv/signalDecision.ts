/**
 * Pure decision logic for pv_signal_workflow. Given disproportionality
 * statistics, decide the signal verdict per EMA GVP Module IX rev 2 +
 * common Bayesian / frequentist thresholds.
 */
import {
  type CaseCounts,
  computeIc,
  computeMgps,
  computePrr,
  computeRor,
} from "./signalStatistics.js";

export type SignalVerdict =
  | "no_signal"
  | "strengthening_signal"
  | "confirmed_signal"
  | "previously_known_signal"
  | "refuted_signal";

export interface SignalThresholds {
  /** PRR ≥ this AND chi-squared ≥ chi2 AND N ≥ n_min triggers PRR */
  prr_min: number;
  ror_min: number;
  ic025_min: number;
  eb05_min: number;
  chi2_min: number;
  n_min: number;
}

const DEFAULT_THRESHOLDS: SignalThresholds = {
  prr_min: 2.0,
  ror_min: 2.0,
  ic025_min: 0.0,
  eb05_min: 2.0,
  chi2_min: 4.0,
  n_min: 3,
};

/** Lower thresholds when the AE is serious (fatal / life-threatening / hospitalisation). */
const SERIOUS_THRESHOLDS: SignalThresholds = {
  prr_min: 1.5,
  ror_min: 1.5,
  ic025_min: 0.0,
  eb05_min: 1.5,
  chi2_min: 4.0,
  n_min: 3,
};

export interface SignalStatisticsResult {
  prr: {
    value: number;
    ci_low: number;
    ci_high: number;
    threshold_met: boolean;
  };
  ror: {
    value: number;
    ci_low: number;
    ci_high: number;
    threshold_met: boolean;
  };
  ic: { value: number; ic025: number; threshold_met: boolean };
  mgps: { ebgm: number; eb05: number; eb95: number; threshold_met: boolean };
  chi_squared: number;
  n_cases: number;
  thresholds_used: "default" | "serious";
}

export function computeAllStats(
  counts: CaseCounts,
  outcomeSerious: boolean,
): SignalStatisticsResult {
  const T = outcomeSerious ? SERIOUS_THRESHOLDS : DEFAULT_THRESHOLDS;
  const prr = computePrr(counts);
  const ror = computeRor(counts);
  const ic = computeIc(counts);
  const mgps = computeMgps(counts);
  return {
    prr: {
      value: prr.value,
      ci_low: prr.ci_low,
      ci_high: prr.ci_high,
      threshold_met:
        prr.value >= T.prr_min &&
        prr.chi_squared >= T.chi2_min &&
        counts.drug_event >= T.n_min,
    },
    ror: {
      value: ror.value,
      ci_low: ror.ci_low,
      ci_high: ror.ci_high,
      threshold_met: ror.value >= T.ror_min && counts.drug_event >= T.n_min,
    },
    ic: {
      value: ic.value,
      ic025: ic.ic025,
      threshold_met: ic.ic025 > T.ic025_min,
    },
    mgps: {
      ebgm: mgps.ebgm,
      eb05: mgps.eb05,
      eb95: mgps.eb95,
      threshold_met: mgps.eb05 >= T.eb05_min,
    },
    chi_squared: prr.chi_squared,
    n_cases: counts.drug_event,
    thresholds_used: outcomeSerious ? "serious" : "default",
  };
}

export interface SignalDecisionInput {
  stats: SignalStatisticsResult;
  prior_known_signals: string[];
  outcome_serious: boolean;
  reported_event?: string; // optional human-readable event name for matching
  thresholds?: SignalThresholds;
}

/**
 * Returns true if `reported_event` matches any string in `prior_known_signals`
 * by case-insensitive substring containment in either direction. Avoids both
 * false negatives ("severe lactic acidosis" should match prior "lactic
 * acidosis") and false positives ("myocardial infarction" must NOT match
 * prior "lactic acidosis" just because both are non-empty strings).
 */
function reportedEventMatchesPriorSignal(
  reportedEvent: string | undefined,
  priorKnownSignals: string[],
): boolean {
  if (!reportedEvent) return false;
  if (!priorKnownSignals || priorKnownSignals.length === 0) return false;
  const ev = reportedEvent.trim().toLowerCase();
  if (!ev) return false;
  for (const prior of priorKnownSignals) {
    const p = prior.trim().toLowerCase();
    if (!p) continue;
    if (ev.includes(p) || p.includes(ev)) return true;
  }
  return false;
}

export function decideVerdict(input: SignalDecisionInput): SignalVerdict {
  const triggers = [
    input.stats.prr.threshold_met,
    input.stats.ror.threshold_met,
    input.stats.ic.threshold_met,
    input.stats.mgps.threshold_met,
  ].filter(Boolean).length;

  // Previously-known classification fires only when the SPECIFIC reported
  // event matches one of the prior known signals. Bare "prior_known_signals
  // is non-empty" is NOT sufficient — that would suppress new signals for
  // any drug with any known signal in its RMP.
  if (
    triggers >= 2 &&
    reportedEventMatchesPriorSignal(
      input.reported_event,
      input.prior_known_signals,
    )
  ) {
    return "previously_known_signal";
  }

  // Refuted: all methods well below threshold AND N is reasonably large
  if (
    triggers === 0 &&
    input.stats.n_cases >= 10 &&
    input.stats.prr.value < 0.5
  ) {
    return "refuted_signal";
  }

  if (triggers === 0) return "no_signal";
  if (
    triggers >= 2 &&
    input.stats.n_cases >= 3 &&
    input.stats.chi_squared >= 4
  ) {
    return "confirmed_signal";
  }
  return "strengthening_signal";
}
