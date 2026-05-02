import type {
  EffectMeasure,
  PooledEstimate,
  DirectComparison,
  IndirectEstimate,
} from "./types.js";
import { assessConsistencyConflict } from "./consistency.js";

/** Standard error from 95% CI */
export function seFromCI(lower: number, upper: number): number {
  return (upper - lower) / 3.92;
}

/** Normal CDF approximation (Abramowitz & Stegun 26.2.17) */
export function normalCDF(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1.0 / (1.0 + 0.2316419 * z);
  const d = 0.3989422804014327; // 1/sqrt(2*pi)
  const p =
    d *
    Math.exp((-z * z) / 2.0) *
    (t *
      (0.31938153 +
        t *
          (-0.356563782 +
            t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))));
  return sign === 1 ? 1.0 - p : p;
}

/** Two-tailed p-value from z-score */
export function pValueFromZ(z: number): number {
  return 2 * (1 - normalCDF(Math.abs(z)));
}

/** Whether the measure operates on a log scale */
function isLogScale(measure: EffectMeasure): boolean {
  return measure === "OR" || measure === "RR" || measure === "HR";
}

/** Convert to working scale (log for ratio measures) */
// Returns the working-scale point estimate. The SE parameter was
// previously included but acted as dead weight (passed through unchanged)
// — that was a correctness trap because for OR/HR/RR the original-scale
// SE is NOT the log-scale SE. Use seOnWorkingScale() for that.
function toWorkingScale(estimate: number, measure: EffectMeasure): number {
  return isLogScale(measure) ? Math.log(estimate) : estimate;
}

/** Convert SE from CI on the original scale to working scale */
function seOnWorkingScale(
  estimate: number,
  ci_lower: number,
  ci_upper: number,
  measure: EffectMeasure,
): number {
  if (isLogScale(measure)) {
    return (Math.log(ci_upper) - Math.log(ci_lower)) / 3.92;
  }
  return seFromCI(ci_lower, ci_upper);
}

/** Back-transform from working scale */
function fromWorkingScale(
  value: number,
  lower: number,
  upper: number,
  measure: EffectMeasure,
): { estimate: number; ci_lower: number; ci_upper: number } {
  if (isLogScale(measure)) {
    return {
      estimate: Math.exp(value),
      ci_lower: Math.exp(lower),
      ci_upper: Math.exp(upper),
    };
  }
  return { estimate: value, ci_lower: lower, ci_upper: upper };
}

/** Fixed-effect inverse-variance pooling */
export function poolFixedEffect(
  studies: Array<{ value: number; se: number }>,
): PooledEstimate {
  if (studies.length === 0) {
    throw new Error("No studies to pool");
  }
  if (studies.length === 1) {
    return { value: studies[0].value, se: studies[0].se, n_studies: 1 };
  }

  let sumW = 0;
  let sumWY = 0;
  for (const s of studies) {
    const w = 1 / (s.se * s.se);
    sumW += w;
    sumWY += w * s.value;
  }

  return {
    value: sumWY / sumW,
    se: Math.sqrt(1 / sumW),
    n_studies: studies.length,
  };
}

/** Bucher indirect comparison: A vs C = A vs B - C vs B */
export function bucherIndirect(
  ab: PooledEstimate,
  cb: PooledEstimate,
): { value: number; se: number; z: number; p_value: number } {
  const value = ab.value - cb.value;
  const se = Math.sqrt(ab.se * ab.se + cb.se * cb.se);
  const z = value / se;
  const p_value = pValueFromZ(z);
  return { value, se, z, p_value };
}

/**
 * Compute a single indirect comparison A vs C through common comparator B.
 *
 * directAB: studies comparing A (intervention) vs B (comparator)
 * directCB: studies comparing C (intervention) vs B (comparator)
 *
 * Returns the indirect estimate of A vs C.
 */
export function computeIndirectComparison(
  intervention: string,
  comparator: string,
  bridge: string,
  directAB: DirectComparison[],
  directCB: DirectComparison[],
  outcome: string,
  measure: EffectMeasure,
  directAC?: DirectComparison[],
): IndirectEstimate {
  // Convert to working scale and pool. The SE on the working scale (log
  // for ratio measures) comes from seOnWorkingScale, NOT from
  // toWorkingScale (which only transforms the point estimate).
  const abStudies = directAB.map((d) => ({
    value: toWorkingScale(d.estimate, measure),
    se: seOnWorkingScale(d.estimate, d.ci_lower, d.ci_upper, measure),
  }));

  const cbStudies = directCB.map((d) => ({
    value: toWorkingScale(d.estimate, measure),
    se: seOnWorkingScale(d.estimate, d.ci_lower, d.ci_upper, measure),
  }));

  const pooledAB = poolFixedEffect(abStudies);
  const pooledCB = poolFixedEffect(cbStudies);

  // Bucher indirect
  const indirect = bucherIndirect(pooledAB, pooledCB);

  // Back-transform
  const ciLowerWorking = indirect.value - 1.96 * indirect.se;
  const ciUpperWorking = indirect.value + 1.96 * indirect.se;
  const result = fromWorkingScale(
    indirect.value,
    ciLowerWorking,
    ciUpperWorking,
    measure,
  );

  // Optional Bucher consistency check vs direct h2h evidence
  let consistency_check: IndirectEstimate["consistency_check"] | undefined;
  if (directAC && directAC.length > 0) {
    const acStudies = directAC.map((d) => ({
      value: toWorkingScale(d.estimate, measure),
      se: seOnWorkingScale(d.estimate, d.ci_lower, d.ci_upper, measure),
    }));
    const pooledAC = poolFixedEffect(acStudies);
    const assessment = assessConsistencyConflict({
      indirect: { value: indirect.value, se: indirect.se },
      direct: { value: pooledAC.value, se: pooledAC.se },
    });
    consistency_check = {
      has_conflict: assessment.has_conflict,
      severity: assessment.severity,
      direct_estimate: pooledAC.value,
      direct_n_studies: pooledAC.n_studies,
      z_difference: assessment.z_difference,
      rationale: assessment.rationale,
    };
  }

  return {
    intervention,
    comparator,
    commonComparator: bridge,
    outcome,
    measure,
    method: "bucher",
    estimate: result.estimate,
    se: indirect.se,
    ci_lower: result.ci_lower,
    ci_upper: result.ci_upper,
    z: indirect.z,
    p_value: indirect.p_value,
    pooled_ab: pooledAB,
    pooled_bc: pooledCB,
    consistency_check,
  };
}
