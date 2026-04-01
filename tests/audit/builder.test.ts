import { createAuditRecord, addSource, addExclusion } from "../../src/audit/builder.js";

describe("createAuditRecord", () => {
  it("creates a record with required fields", () => {
    const record = createAuditRecord("literature_search", { query: "semaglutide" }, "text");
    expect(record.tool).toBe("literature_search");
    expect(record.query).toEqual({ query: "semaglutide" });
    expect(record.output_format).toBe("text");
    expect(record.sources_queried).toEqual([]);
    expect(record.exclusions).toEqual([]);
    expect(record.assumptions).toEqual([]);
    expect(record.warnings).toEqual([]);
    expect(record.inclusions).toBe(0);
    expect(new Date(record.timestamp).getTime()).toBeGreaterThan(0);
  });
});

describe("addSource", () => {
  it("appends a SourceAudit and updates inclusions count", () => {
    let record = createAuditRecord("literature_search", {}, "text");
    record = addSource(record, {
      source: "pubmed",
      query_sent: "semaglutide diabetes",
      results_returned: 47,
      results_included: 12,
      latency_ms: 320,
      status: "ok",
    });
    expect(record.sources_queried).toHaveLength(1);
    expect(record.sources_queried[0].source).toBe("pubmed");
    expect(record.inclusions).toBe(12);
  });

  it("accumulates inclusions across multiple sources", () => {
    let record = createAuditRecord("literature_search", {}, "text");
    record = addSource(record, { source: "pubmed", query_sent: "q", results_returned: 10, results_included: 5, latency_ms: 100, status: "ok" });
    record = addSource(record, { source: "biorxiv", query_sent: "q", results_returned: 8, results_included: 3, latency_ms: 80, status: "ok" });
    expect(record.inclusions).toBe(8);
  });
});

describe("addExclusion", () => {
  it("appends an ExclusionRecord", () => {
    let record = createAuditRecord("literature_search", {}, "text");
    record = addExclusion(record, { id: "pmid_123", title: "Old study", reason: "date filter" });
    expect(record.exclusions).toHaveLength(1);
    expect(record.exclusions[0].reason).toBe("date filter");
  });
});
