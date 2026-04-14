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
