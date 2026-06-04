// heor-agent-mcp/tests/governance/auditDerivation.test.ts
import { deriveFromAudit } from "../../src/governance/scoring.js";
import {
  createAuditRecord,
  addToolCall,
  addSource,
} from "../../src/audit/builder.js";

describe("deriveFromAudit", () => {
  it("a run with validate_links + sources + methodology scores green on 1/2/6", () => {
    let audit = createAuditRecord(
      "literature.search",
      {},
      "markdown",
      "PRISMA search",
    );
    audit = addToolCall(audit, {
      name: "utils.validate_links",
      ms: 100,
      outcome: "ok",
    });
    audit = addSource(audit, {
      source: "pubmed",
      query_sent: "x",
      results_returned: 10,
      results_included: 8,
      latency_ms: 50,
      status: "ok",
    });
    const d = deriveFromAudit(audit);
    expect(d.transparency).toBe("yes");
    expect(d.citation_validation).toBe("yes");
    expect(d.auditability).toBe("yes");
  });

  it("sources but no validate_links → citation partial", () => {
    let audit = createAuditRecord(
      "literature.search",
      {},
      "markdown",
      "search",
    );
    audit = addSource(audit, {
      source: "pubmed",
      query_sent: "x",
      results_returned: 1,
      results_included: 1,
      latency_ms: 10,
      status: "ok",
    });
    expect(deriveFromAudit(audit).citation_validation).toBe("partial");
  });

  it("no sources at all → citation probe 'no' (scores red downstream via scoreDimension)", () => {
    const audit = createAuditRecord(
      "models.cost_effectiveness",
      {},
      "markdown",
      "model",
    );
    expect(deriveFromAudit(audit).citation_validation).toBe("no");
  });
});
