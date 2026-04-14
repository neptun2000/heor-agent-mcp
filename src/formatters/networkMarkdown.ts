import type { EvidenceNetwork } from "../network/types.js";

export function networkToMarkdown(network: EvidenceNetwork): string {
  const lines: string[] = [];

  lines.push("## Evidence Network Analysis");
  lines.push("");

  // Summary
  const { feasibility } = network;
  const verdict = feasibility.feasible ? "**Feasible**" : "**Not feasible**";
  lines.push(`**NMA Feasibility:** ${verdict}`);
  lines.push(
    `**Treatments:** ${feasibility.nodeCount} | **Comparisons:** ${feasibility.edgeCount} | **Connected:** ${feasibility.connected ? "Yes" : "No"}`,
  );
  lines.push("");

  // Reasons
  lines.push("### Assessment");
  for (const reason of feasibility.reasons) {
    const icon = reason.includes("not") || reason.includes("Only") || reason.includes("disconnected")
      ? "⚠️"
      : "✓";
    lines.push(`- ${icon} ${reason}`);
  }
  lines.push("");

  // Network graph (text)
  if (network.edges.length > 0) {
    lines.push("### Evidence Network");
    lines.push(
      "| Comparison | Trials | Study Types | Confidence |",
    );
    lines.push(
      "|------------|--------|-------------|------------|",
    );
    for (const edge of network.edges) {
      const sourceNode = network.nodes.find((n) => n.id === edge.source);
      const targetNode = network.nodes.find((n) => n.id === edge.target);
      const source = sourceNode?.label ?? edge.source;
      const target = targetNode?.label ?? edge.target;
      const types = [...new Set(edge.studyTypes)].join(", ");
      lines.push(
        `| ${source} ↔ ${target} | ${edge.trials.length} | ${types} | ${edge.confidence} |`,
      );
    }
    lines.push("");
  }

  // Nodes
  if (network.nodes.length > 0) {
    lines.push("### Treatments Identified");
    lines.push("| Treatment | Role |");
    lines.push("|-----------|------|");
    for (const node of network.nodes) {
      lines.push(`| ${node.label} | ${node.type} |`);
    }
    lines.push("");
  }

  // Components (if disconnected)
  if (feasibility.componentCount > 1) {
    lines.push("### Disconnected Components");
    for (let i = 0; i < feasibility.components.length; i++) {
      lines.push(
        `- **Component ${i + 1}:** ${feasibility.components[i].join(", ")}`,
      );
    }
    lines.push("");
  }

  // Gaps
  if (feasibility.gaps.length > 0) {
    lines.push("### Evidence Gaps");
    for (const gap of feasibility.gaps) {
      lines.push(`- ⚠️ ${gap.description}`);
    }
    lines.push("");
  }

  // Recommendation
  lines.push("### Recommendation");
  if (feasibility.feasible) {
    lines.push(
      "The evidence network is connected with sufficient comparisons to support a network meta-analysis. " +
        "Consider Bayesian NMA (R/Stan or WinBUGS) with assessment of heterogeneity and inconsistency.",
    );
  } else {
    lines.push(
      "The evidence network does not currently support a valid NMA. " +
        "Consider: expanding the literature search, including indirect comparators, " +
        "or using pairwise meta-analysis for available direct comparisons.",
    );
  }

  return lines.join("\n");
}
