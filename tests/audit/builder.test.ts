import {
  createAuditRecord,
  addSource,
  addExclusion,
  addToolCall,
} from "../../src/audit/builder.js";

describe("createAuditRecord", () => {
  it("creates a record with required fields", () => {
    const record = createAuditRecord(
      "literature.search",
      { query: "semaglutide" },
      "text",
    );
    expect(record.tool).toBe("literature.search");
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
    let record = createAuditRecord("literature.search", {}, "text");
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
    let record = createAuditRecord("literature.search", {}, "text");
    record = addSource(record, {
      source: "pubmed",
      query_sent: "q",
      results_returned: 10,
      results_included: 5,
      latency_ms: 100,
      status: "ok",
    });
    record = addSource(record, {
      source: "biorxiv",
      query_sent: "q",
      results_returned: 8,
      results_included: 3,
      latency_ms: 80,
      status: "ok",
    });
    expect(record.inclusions).toBe(8);
  });
});

describe("addExclusion", () => {
  it("appends an ExclusionRecord", () => {
    let record = createAuditRecord("literature.search", {}, "text");
    record = addExclusion(record, {
      id: "pmid_123",
      title: "Old study",
      reason: "date filter",
    });
    expect(record.exclusions).toHaveLength(1);
    expect(record.exclusions[0].reason).toBe("date filter");
  });
});

describe("addToolCall", () => {
  it("createAuditRecord initialises tools_called as empty array", () => {
    const record = createAuditRecord("hta.workflow", {}, "text");
    expect(record.tools_called).toEqual([]);
  });

  it("appends a ToolCallTrace", () => {
    let record = createAuditRecord("hta.workflow", {}, "text");
    record = addToolCall(record, {
      name: "literature.search",
      ms: 412,
      outcome: "ok",
    });
    expect(record.tools_called).toHaveLength(1);
    expect(record.tools_called![0].name).toBe("literature.search");
    expect(record.tools_called![0].ms).toBe(412);
    expect(record.tools_called![0].outcome).toBe("ok");
  });

  it("accumulates multiple tool calls in order", () => {
    let record = createAuditRecord("hta.workflow", {}, "text");
    record = addToolCall(record, {
      name: "literature.search",
      ms: 412,
      outcome: "ok",
    });
    record = addToolCall(record, {
      name: "evidence.risk_of_bias",
      ms: 180,
      outcome: "ok",
    });
    record = addToolCall(record, {
      name: "models.cost_effectiveness",
      ms: 2100,
      outcome: "degraded",
    });
    expect(record.tools_called).toHaveLength(3);
    expect(record.tools_called![2].name).toBe("models.cost_effectiveness");
    expect(record.tools_called![2].outcome).toBe("degraded");
  });

  it("stores optional output_size_bytes", () => {
    let record = createAuditRecord("hta.workflow", {}, "text");
    record = addToolCall(record, {
      name: "literature.search",
      ms: 500,
      outcome: "ok",
      output_size_bytes: 8192,
    });
    expect(record.tools_called![0].output_size_bytes).toBe(8192);
  });
});
