export interface EvidenceNode {
  id: string;
  label: string;
  type: "intervention" | "comparator";
}

export interface EvidenceEdge {
  source: string;
  target: string;
  trials: string[];
  studyTypes: string[];
  direct: boolean;
  confidence: "high" | "medium" | "low";
}

export interface NetworkGap {
  from: string;
  to: string;
  description: string;
}

export interface NMAFeasibility {
  feasible: boolean;
  reasons: string[];
  nodeCount: number;
  edgeCount: number;
  connected: boolean;
  componentCount: number;
  components: string[][];
  minTrialsPerEdge: number;
  gaps: NetworkGap[];
}

export interface EvidenceNetwork {
  nodes: EvidenceNode[];
  edges: EvidenceEdge[];
  feasibility: NMAFeasibility;
}

export interface ComparatorPair {
  intervention: string;
  comparator: string;
  trialId: string;
  studyType: string;
  confidence: "high" | "medium" | "low";
}

// --- Level 2: Indirect Comparisons ---

export type EffectMeasure = "MD" | "OR" | "RR" | "HR";

export interface DirectComparison {
  intervention: string;
  comparator: string;
  outcome: string;
  measure: EffectMeasure;
  estimate: number;
  ci_lower: number;
  ci_upper: number;
  source: string;
}

export interface PooledEstimate {
  value: number;
  se: number;
  n_studies: number;
}

export interface IndirectEstimate {
  intervention: string;
  comparator: string;
  commonComparator: string;
  outcome: string;
  measure: EffectMeasure;
  method: "bucher" | "frequentist_nma";
  estimate: number;
  se: number;
  ci_lower: number;
  ci_upper: number;
  z: number;
  p_value: number;
  pooled_ab: PooledEstimate;
  pooled_bc: PooledEstimate;
}

export interface HeterogeneitySummary {
  comparison_label: string;
  n_studies: number;
  cochran_q: number;
  df: number;
  p_value: number;
  i_squared_pct: number;
  tau_squared: number;
  interpretation:
    | "might_not_be_important"
    | "moderate"
    | "substantial"
    | "considerable";
  interpretation_band: string;
}

export interface IndirectComparisonResult {
  estimates: IndirectEstimate[];
  method: "bucher" | "frequentist_nma" | "mixed";
  warnings: string[];
  limitations: string[];
  heterogeneity?: HeterogeneitySummary[];
}

export interface IndirectPath {
  a: string;
  c: string;
  bridge: string;
  abComparisons: DirectComparison[];
  bcComparisons: DirectComparison[];
}
