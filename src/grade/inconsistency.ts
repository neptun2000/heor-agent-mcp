/**
 * GRADE Inconsistency assessment.
 *
 * Per Cochrane Handbook Ch. 10.10 / GRADE Handbook 5.1, inconsistency reflects
 * heterogeneity of effect estimates across studies — NOT the number of studies.
 *
 * Single-study comparisons cannot be assessed for inconsistency; they are
 * downgraded for imprecision instead. This function returns "not_assessable"
 * for k=1, mapping I² bands to GRADE inconsistency levels otherwise.
 *
 * I² interpretation bands (Cochrane):
 *   0–40%   might not be important
 *   30–60%  moderate heterogeneity
 *   50–90%  substantial heterogeneity
 *   75–100% considerable heterogeneity
 *
 * GRADE downgrade mapping:
 *   <50%   Low (no downgrade)
 *   50–75% Moderate (consider 1-step downgrade — "Serious")
 *   >75%   Serious (1-step downgrade — "Very Serious" if ≥90%)
 */

export type GradeInconsistency =
  | "not_assessable"
  | "Low"
  | "Moderate"
  | "Serious"
  | "Very Serious";

export interface InconsistencyAssessment {
  level: GradeInconsistency;
  downgrade_steps: 0 | 1 | 2;
  rationale: string;
}

export function assessInconsistency(
  n_studies: number,
  i_squared_pct: number | null,
): InconsistencyAssessment {
  if (n_studies <= 0) {
    return {
      level: "not_assessable",
      downgrade_steps: 0,
      rationale: "No studies — domain not assessable",
    };
  }
  if (n_studies === 1) {
    return {
      level: "not_assessable",
      downgrade_steps: 0,
      rationale:
        "Single study — inconsistency not assessable (consider imprecision instead)",
    };
  }
  if (i_squared_pct == null) {
    return {
      level: "Moderate",
      downgrade_steps: 0,
      rationale:
        "Multiple studies but I² not computed — manual heterogeneity review recommended",
    };
  }
  if (i_squared_pct >= 90) {
    return {
      level: "Very Serious",
      downgrade_steps: 2,
      rationale: `I²=${i_squared_pct.toFixed(0)}% (considerable heterogeneity, ≥90%)`,
    };
  }
  if (i_squared_pct >= 75) {
    return {
      level: "Serious",
      downgrade_steps: 1,
      rationale: `I²=${i_squared_pct.toFixed(0)}% (considerable heterogeneity, 75–89%)`,
    };
  }
  if (i_squared_pct >= 50) {
    return {
      level: "Moderate",
      downgrade_steps: 1,
      rationale: `I²=${i_squared_pct.toFixed(0)}% (substantial heterogeneity, 50–74%)`,
    };
  }
  return {
    level: "Low",
    downgrade_steps: 0,
    rationale: `I²=${i_squared_pct.toFixed(0)}% (low heterogeneity, <50%)`,
  };
}
