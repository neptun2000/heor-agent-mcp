// heor-agent-mcp/tests/tools/governanceSelfCheck.test.ts
import {
  governanceSelfCheckHandler,
  governanceSelfCheckSchema,
} from "../../src/tools/governanceSelfCheck.js";
import { createAuditRecord, addToolCall, addSource } from "../../src/audit/builder.js";

describe("governance.self_check handler — describe mode", () => {
  it("blank probe scores insufficient, never green", async () => {
    const r = await governanceSelfCheckHandler({
      mode: "describe",
      workflow_description: "We use ChatGPT to summarise abstracts.",
      context: { use_case: "regulatory_submission" },
      probes: { transparency: { answer: "no" } }, // others omitted
    });
    const phi = r.dimensions.find((d) => d.key === "phi_data_handling")!;
    expect(phi.rag).toBe("insufficient");
    const transparency = r.dimensions.find((d) => d.key === "transparency")!;
    expect(transparency.rag).toBe("red");
    expect(r.verdict).toMatch(/Not submission-ready/);
  });

  it("emits an ELEVATE disclosure block and scope disclaimer in markdown_section", async () => {
    const r = await governanceSelfCheckHandler({
      mode: "describe",
      workflow_description: "x",
      probes: { transparency: { answer: "yes" } },
    });
    expect(r.markdown_section).toContain("AI Assistance Disclosure");
    expect(r.markdown_section).toMatch(/Insufficient|insufficient/);
  });
});

describe("governance.self_check handler — audit_record mode", () => {
  it("auto-derives 1/2/6 green; 3/4/5 insufficient", async () => {
    let audit = createAuditRecord("literature.search", {}, "markdown", "PRISMA");
    audit = addToolCall(audit, { name: "utils.validate_links", ms: 1, outcome: "ok" });
    audit = addSource(audit, {
      source: "pubmed", query_sent: "x", results_returned: 5, results_included: 5, latency_ms: 1, status: "ok",
    });
    const r = await governanceSelfCheckHandler({ mode: "audit_record", audit_record: audit });
    const byKey = Object.fromEntries(r.dimensions.map((d) => [d.key, d.rag]));
    expect(byKey.transparency).toBe("green");
    expect(byKey.citation_validation).toBe("green");
    expect(byKey.auditability).toBe("green");
    expect(byKey.human_oversight).toBe("insufficient");
    expect(byKey.phi_data_handling).toBe("insufficient");
    expect(byKey.bias_equity).toBe("insufficient");
  });
});

describe("schema", () => {
  it("defaults mode to describe", () => {
    const p = governanceSelfCheckSchema.parse({ workflow_description: "x" });
    expect(p.mode).toBe("describe");
  });
});
