/**
 * Bucher consistency assumption check.
 *
 * Bucher's 1997 indirect comparison method requires that the bridge-comparator
 * effect is the same in trials of A-vs-B and C-vs-B. When direct head-to-head
 * (A-vs-C) evidence ALSO exists, we can test this assumption empirically by
 * comparing the direct and indirect estimates — if they disagree, the
 * consistency assumption is suspect and the indirect estimate may be biased.
 *
 * Test statistic: z = (direct - indirect) / sqrt(SE_direct² + SE_indirect²)
 *
 * Severity bands (Cochrane Handbook Ch. 11.4.3 / NICE DSU TSD 18):
 *   |z| < 1.5    → no conflict
 *   1.5–1.96     → moderate inconsistency (warrants discussion)
 *   ≥1.96        → substantial inconsistency (consistency assumption violated)
 *   any opposite-direction with both estimates significant → substantial
 *
 * Note: the working scale matters. For OR/HR/RR, both estimates must be on the
 * log scale before differencing. This function assumes the caller has already
 * converted to the working scale.
 */

export interface ConsistencyInput {
  /** Indirect (Bucher) estimate on the working scale (log for ratio measures). */
  indirect: { value: number; se: number };
  /** Direct (head-to-head) estimate on the working scale, or null if no h2h. */
  direct: { value: number; se: number } | null;
}

export type ConsistencySeverity =
  | "untestable"
  | "none"
  | "moderate"
  | "substantial";

export interface ConsistencyAssessment {
  has_conflict: boolean;
  severity: ConsistencySeverity;
  /** direct − indirect (positive when direct exceeds indirect). Same scale as input. */
  difference: number;
  /** Pooled SE: sqrt(SE_direct² + SE_indirect²). */
  se_difference: number;
  /**
   * Signed z = (direct − indirect) / SE_diff. Sign indicates which side
   * the disagreement falls on. Severity bands use |z|, but consumers
   * presenting the value should preserve the sign for direction.
   */
  z_difference: number;
  rationale: string;
}

export function assessConsistencyConflict(
  input: ConsistencyInput,
): ConsistencyAssessment {
  if (input.direct === null) {
    return {
      has_conflict: false,
      severity: "untestable",
      difference: 0,
      se_difference: 0,
      z_difference: 0,
      rationale:
        "No head-to-head trials — Bucher consistency assumption cannot be tested empirically. Assess based on transitivity of trial populations.",
    };
  }

  const difference = input.direct.value - input.indirect.value;
  const se_difference = Math.sqrt(
    input.direct.se * input.direct.se + input.indirect.se * input.indirect.se,
  );
  const z = se_difference > 0 ? difference / se_difference : 0;
  const absZ = Math.abs(z);

  // Opposite-direction check: both estimates significant in opposite directions
  const directSig = Math.abs(input.direct.value) / input.direct.se >= 1.96;
  const indirectSig =
    Math.abs(input.indirect.value) / input.indirect.se >= 1.96;
  const oppositeSign =
    Math.sign(input.direct.value) !== Math.sign(input.indirect.value) &&
    input.direct.value !== 0 &&
    input.indirect.value !== 0;
  const oppositeSignificant = directSig && indirectSig && oppositeSign;

  if (oppositeSignificant) {
    return {
      has_conflict: true,
      severity: "substantial",
      difference,
      se_difference,
      z_difference: z,
      rationale: `Direct and indirect estimates point in opposite directions and BOTH are statistically significant (z=${z.toFixed(2)}). This is a substantial violation of the Bucher consistency assumption — the indirect estimate is likely biased. Investigate trial population differences (effect modifiers).`,
    };
  }

  if (absZ >= 1.96) {
    return {
      has_conflict: true,
      severity: "substantial",
      difference,
      se_difference,
      z_difference: z,
      rationale: `Direct vs indirect z=${z.toFixed(2)} (|z| ≥ 1.96) — substantial inconsistency, Bucher consistency assumption appears violated. Prefer direct evidence; if presenting indirect, flag this conflict prominently.`,
    };
  }

  if (absZ >= 1.5) {
    return {
      has_conflict: true,
      severity: "moderate",
      difference,
      se_difference,
      z_difference: z,
      rationale: `Direct vs indirect z=${z.toFixed(2)} (|z| 1.5–1.96) — moderate inconsistency. Consider effect modifier imbalance across trial populations and discuss in submission narrative.`,
    };
  }

  return {
    has_conflict: false,
    severity: "none",
    difference,
    se_difference,
    z_difference: z,
    rationale: `Direct vs indirect agree (z=${z.toFixed(2)}, |z| < 1.5) — Bucher consistency assumption supported by available evidence.`,
  };
}
