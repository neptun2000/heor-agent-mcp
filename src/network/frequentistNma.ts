import type {
  DirectComparison,
  EffectMeasure,
  IndirectEstimate,
  PooledEstimate,
} from "./types.js";
import { seFromCI, pValueFromZ, poolFixedEffect } from "./bucher.js";

interface ContrastData {
  a: string;
  b: string;
  value: number;
  se: number;
  n_studies: number;
}

function isLogScale(measure: EffectMeasure): boolean {
  return measure === "OR" || measure === "RR" || measure === "HR";
}

function toWorkingScale(
  d: DirectComparison,
): { value: number; se: number } {
  const log = isLogScale(d.measure);
  const se = log
    ? (Math.log(d.ci_upper) - Math.log(d.ci_lower)) / 3.92
    : seFromCI(d.ci_lower, d.ci_upper);
  const value = log ? Math.log(d.estimate) : d.estimate;
  return { value, se };
}

/**
 * Frequentist contrast-based NMA using weighted least squares.
 *
 * Given a set of direct comparisons (possibly multiple per edge),
 * estimates all pairwise treatment effects relative to a reference.
 *
 * For small networks this is equivalent to the graph-theoretical
 * approach (Rücker 2012).
 */
export function frequentistNMA(
  comparisons: DirectComparison[],
  outcome: string,
  measure: EffectMeasure,
): IndirectEstimate[] {
  // Filter to the specified outcome
  const relevant = comparisons.filter(
    (c) => c.outcome === outcome && c.measure === measure,
  );

  if (relevant.length === 0) return [];

  // Pool direct comparisons by edge (intervention-comparator pair)
  const edgeKey = (a: string, b: string) => [a, b].sort().join("↔");
  const edgeMap = new Map<string, { a: string; b: string; studies: Array<{ value: number; se: number }> }>();

  for (const d of relevant) {
    const ws = toWorkingScale(d);
    const key = edgeKey(d.intervention, d.comparator);

    if (!edgeMap.has(key)) {
      edgeMap.set(key, { a: d.intervention, b: d.comparator, studies: [] });
    }
    const edge = edgeMap.get(key)!;

    // Ensure consistent direction: if stored as B-A but input is A-B
    if (edge.a === d.comparator && edge.b === d.intervention) {
      ws.value = -ws.value; // flip direction
    }
    edge.studies.push(ws);
  }

  // Pool each edge
  const contrasts: ContrastData[] = [];
  for (const edge of edgeMap.values()) {
    const pooled = poolFixedEffect(edge.studies);
    contrasts.push({
      a: edge.a,
      b: edge.b,
      value: pooled.value,
      se: pooled.se,
      n_studies: pooled.n_studies,
    });
  }

  // Collect all treatment names
  const treatments = new Set<string>();
  for (const c of contrasts) {
    treatments.add(c.a);
    treatments.add(c.b);
  }
  const treatmentList = Array.from(treatments).sort();
  const n = treatmentList.length;
  const idx = new Map(treatmentList.map((t, i) => [t, i]));

  if (n < 2) return [];

  // Reference treatment = first alphabetically
  const ref = treatmentList[0];

  // Build design matrix and weight matrix
  // Each contrast gives one equation: effect_a - effect_b = observed_value
  // Parameters: treatment effects relative to reference (n-1 params)
  const m = contrasts.length; // number of equations
  const p = n - 1; // number of parameters

  // X: m x p design matrix
  // W: m x m diagonal weight matrix (1/se^2)
  // y: m x 1 observation vector
  const X: number[][] = Array.from({ length: m }, () => Array(p).fill(0));
  const W: number[] = new Array(m);
  const y: number[] = new Array(m);

  for (let i = 0; i < m; i++) {
    const c = contrasts[i];
    const ia = idx.get(c.a)!;
    const ib = idx.get(c.b)!;

    // effect_a - effect_b (relative to reference, which has effect = 0)
    if (ia > 0) X[i][ia - 1] = 1; // a is not reference
    if (ib > 0) X[i][ib - 1] = -1; // b is not reference

    W[i] = 1 / (c.se * c.se);
    y[i] = c.value;
  }

  // Solve: beta = (X'WX)^-1 X'Wy
  // X'WX is p x p
  const XtWX: number[][] = Array.from({ length: p }, () => Array(p).fill(0));
  const XtWy: number[] = Array(p).fill(0);

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < p; j++) {
      XtWy[j] += X[i][j] * W[i] * y[i];
      for (let k = 0; k < p; k++) {
        XtWX[j][k] += X[i][j] * W[i] * X[i][k];
      }
    }
  }

  // Invert XtWX using Gaussian elimination
  const invXtWX = invertMatrix(XtWX);
  if (!invXtWX) {
    // Singular — network is disconnected or underdetermined
    return [];
  }

  // beta = invXtWX * XtWy
  const beta: number[] = Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    for (let k = 0; k < p; k++) {
      beta[j] += invXtWX[j][k] * XtWy[k];
    }
  }

  // SE of each beta: sqrt(diag(invXtWX))
  const seBeta: number[] = Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    seBeta[j] = Math.sqrt(invXtWX[j][j]);
  }

  // Generate all pairwise comparisons
  const estimates: IndirectEstimate[] = [];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const tA = treatmentList[i];
      const tB = treatmentList[j];

      // Effect A vs B = effect_A - effect_B (relative to ref)
      let value: number;
      let variance: number;

      if (i === 0) {
        // A is reference: effect = -beta_B
        value = -beta[j - 1];
        variance = invXtWX[j - 1][j - 1];
      } else if (j === 0) {
        // B is reference: effect = beta_A
        value = beta[i - 1];
        variance = invXtWX[i - 1][i - 1];
      } else {
        // Neither is reference: effect = beta_A - beta_B
        value = beta[i - 1] - beta[j - 1];
        variance =
          invXtWX[i - 1][i - 1] +
          invXtWX[j - 1][j - 1] -
          2 * invXtWX[i - 1][j - 1];
      }

      const se = Math.sqrt(Math.max(0, variance));
      const z = se > 0 ? value / se : 0;
      const p_value = pValueFromZ(z);

      let estimate: number;
      let ci_lower: number;
      let ci_upper: number;

      if (isLogScale(measure)) {
        estimate = Math.exp(value);
        ci_lower = Math.exp(value - 1.96 * se);
        ci_upper = Math.exp(value + 1.96 * se);
      } else {
        estimate = value;
        ci_lower = value - 1.96 * se;
        ci_upper = value + 1.96 * se;
      }

      // Check if this is a direct or indirect comparison
      const directKey = edgeKey(tA, tB);
      const isDirect = edgeMap.has(directKey);

      estimates.push({
        intervention: tA,
        comparator: tB,
        commonComparator: isDirect ? "(direct)" : ref,
        outcome,
        measure,
        method: "frequentist_nma",
        estimate,
        se,
        ci_lower,
        ci_upper,
        z,
        p_value,
        pooled_ab: { value: beta[Math.max(0, i - 1)] ?? 0, se: seBeta[Math.max(0, i - 1)] ?? 0, n_studies: 0 },
        pooled_bc: { value: beta[Math.max(0, j - 1)] ?? 0, se: seBeta[Math.max(0, j - 1)] ?? 0, n_studies: 0 },
      });
    }
  }

  return estimates;
}

/** Gaussian elimination matrix inversion for small matrices */
function invertMatrix(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  // Augmented matrix [A | I]
  const aug: number[][] = matrix.map((row, i) => {
    const augRow = [...row];
    for (let j = 0; j < n; j++) {
      augRow.push(i === j ? 1 : 0);
    }
    return augRow;
  });

  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }

    if (maxVal < 1e-12) return null; // Singular

    // Swap rows
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    // Scale pivot row
    const pivot = aug[col][col];
    for (let j = 0; j < 2 * n; j++) {
      aug[col][j] /= pivot;
    }

    // Eliminate column
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = 0; j < 2 * n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Extract inverse
  return aug.map((row) => row.slice(n));
}
