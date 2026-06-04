// heor-agent-mcp/tests/formatters/governanceMarkdown.test.ts
import { renderGovernanceScorecard } from "../../src/formatters/governanceMarkdown.js";
import type { RenderedDimension } from "../../src/formatters/governanceMarkdown.js";

const dims: RenderedDimension[] = [
  { key: "transparency", label: "Transparency & disclosure", rag: "green", elevate_refs: ["Model Characteristics"], finding: "Safeguard in place.", recommended_mitigation: "" },
  { key: "phi_data_handling", label: "PHI & data handling", rag: "insufficient", elevate_refs: ["Security and Privacy"], finding: "No evidence supplied — cannot certify.", recommended_mitigation: "Keep PHI out of unregulated AI." },
];

describe("renderGovernanceScorecard", () => {
  it("renders a table with RAG icons and the verdict", () => {
    const md = renderGovernanceScorecard(dims, { green: 1, amber: 0, red: 0, insufficient: 1 }, "Cannot certify — missing governance evidence");
    expect(md).toContain("🟢");
    expect(md).toContain("⚪");
    expect(md).toContain("Security and Privacy");
    expect(md).toContain("Cannot certify");
  });
  it("includes the scope disclaimer about unscored domains", () => {
    const md = renderGovernanceScorecard(dims, { green: 1, amber: 0, red: 0, insufficient: 1 }, "x");
    expect(md).toMatch(/Robustness Checks|model-evaluation domains/i);
  });
});
