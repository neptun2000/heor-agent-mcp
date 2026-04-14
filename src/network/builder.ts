import type {
  EvidenceNode,
  EvidenceEdge,
  EvidenceNetwork,
  NMAFeasibility,
  NetworkGap,
  ComparatorPair,
} from "./types.js";
import { normalizeDrugName } from "./extractor.js";

// Union-Find for connected components
class UnionFind {
  private parent: Map<string, string> = new Map();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    const p = this.parent.get(x)!;
    if (p !== x) {
      const root = this.find(p);
      this.parent.set(x, root);
      return root;
    }
    return x;
  }

  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  components(): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(key);
    }
    return groups;
  }
}

export function buildEvidenceNetwork(pairs: ComparatorPair[]): EvidenceNetwork {
  // Build nodes
  const nodeMap = new Map<string, EvidenceNode>();
  const edgeMap = new Map<string, EvidenceEdge>();

  for (const pair of pairs) {
    const intId = normalizeDrugName(pair.intervention);
    const compId = normalizeDrugName(pair.comparator);

    if (!nodeMap.has(intId)) {
      nodeMap.set(intId, {
        id: intId,
        label: pair.intervention,
        type: "intervention",
      });
    }

    if (!nodeMap.has(compId)) {
      nodeMap.set(compId, {
        id: compId,
        label: pair.comparator,
        type: "comparator",
      });
    }

    // Edge key is sorted to avoid duplicates (A→B = B→A)
    const edgeKey = [intId, compId].sort().join("↔");
    if (!edgeMap.has(edgeKey)) {
      edgeMap.set(edgeKey, {
        source: intId,
        target: compId,
        trials: [],
        studyTypes: [],
        direct: true,
        confidence: pair.confidence,
      });
    }

    const edge = edgeMap.get(edgeKey)!;
    if (!edge.trials.includes(pair.trialId)) {
      edge.trials.push(pair.trialId);
      edge.studyTypes.push(pair.studyType);
    }
    // Upgrade confidence if higher
    if (
      pair.confidence === "high" ||
      (pair.confidence === "medium" && edge.confidence === "low")
    ) {
      edge.confidence = pair.confidence;
    }
  }

  const nodes = Array.from(nodeMap.values());
  const edges = Array.from(edgeMap.values());

  // Connectivity analysis
  const uf = new UnionFind();
  for (const node of nodes) {
    uf.find(node.id); // register
  }
  for (const edge of edges) {
    uf.union(edge.source, edge.target);
  }

  const componentMap = uf.components();
  const components = Array.from(componentMap.values()).filter(
    (c) => c.length > 0,
  );
  const connected = components.length === 1;

  // Find gaps: pairs of nodes in different components
  const gaps: NetworkGap[] = [];
  if (!connected && components.length >= 2) {
    for (let i = 0; i < components.length - 1; i++) {
      for (let j = i + 1; j < components.length; j++) {
        const nodeA = nodeMap.get(components[i][0]);
        const nodeB = nodeMap.get(components[j][0]);
        if (nodeA && nodeB) {
          gaps.push({
            from: nodeA.label,
            to: nodeB.label,
            description: `No direct or indirect evidence path between "${nodeA.label}" network and "${nodeB.label}" network`,
          });
        }
      }
    }
  }

  const minTrialsPerEdge =
    edges.length > 0 ? Math.min(...edges.map((e) => e.trials.length)) : 0;

  // Feasibility assessment
  const reasons: string[] = [];
  let feasible = true;

  if (nodes.length < 3) {
    reasons.push(
      `Only ${nodes.length} treatments identified — NMA requires at least 3`,
    );
    feasible = false;
  } else {
    reasons.push(`${nodes.length} treatments identified`);
  }

  if (!connected) {
    reasons.push(
      `Network is disconnected (${components.length} components) — NMA requires a connected network`,
    );
    feasible = false;
  } else {
    reasons.push("Network is fully connected");
  }

  if (minTrialsPerEdge < 1) {
    reasons.push("Some comparisons have no supporting trials");
    feasible = false;
  } else if (minTrialsPerEdge < 2) {
    reasons.push(
      "Some comparisons have only 1 trial — consider heterogeneity carefully",
    );
  } else {
    reasons.push(`All comparisons supported by ≥${minTrialsPerEdge} trials`);
  }

  if (edges.length < 2) {
    reasons.push(
      `Only ${edges.length} comparison(s) found — NMA adds value with ≥3 comparisons`,
    );
    feasible = false;
  } else {
    reasons.push(`${edges.length} direct comparisons found`);
  }

  const feasibility: NMAFeasibility = {
    feasible,
    reasons,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    connected,
    componentCount: components.length,
    components: components.map((c) =>
      c.map((id) => nodeMap.get(id)?.label ?? id),
    ),
    minTrialsPerEdge,
    gaps,
  };

  return { nodes, edges, feasibility };
}
