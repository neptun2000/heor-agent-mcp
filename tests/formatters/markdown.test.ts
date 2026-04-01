import { resultsToMarkdown, auditToMarkdown } from "../../src/formatters/markdown.js";
import { createAuditRecord, addSource } from "../../src/audit/builder.js";
import type { LiteratureResult } from "../../src/providers/types.js";

const mockResults: LiteratureResult[] = [
  {
    id: "pubmed_123",
    source: "pubmed",
    title: "Semaglutide cost-effectiveness study",
    authors: ["Smith J", "Jones A"],
    date: "2024 Jan",
    study_type: "rct",
    abstract: "Background: We studied...",
    url: "https://pubmed.ncbi.nlm.nih.gov/123/",
  },
];

describe("resultsToMarkdown", () => {
  it("includes title and source in output", () => {
    const audit = createAuditRecord("literature_search", {}, "text");
    const md = resultsToMarkdown(mockResults, audit);
    expect(md).toContain("Semaglutide cost-effectiveness study");
    expect(md).toContain("pubmed");
  });

  it("includes audit summary section", () => {
    const audit = createAuditRecord("literature_search", { query: "semaglutide" }, "text");
    const md = resultsToMarkdown(mockResults, audit);
    expect(md).toContain("Audit");
  });
});

describe("auditToMarkdown", () => {
  it("renders sources queried", () => {
    let audit = createAuditRecord("literature_search", {}, "text");
    audit = addSource(audit, {
      source: "pubmed",
      query_sent: "semaglutide",
      results_returned: 47,
      results_included: 12,
      latency_ms: 320,
      status: "ok",
    });
    const md = auditToMarkdown(audit);
    expect(md).toContain("pubmed");
    expect(md).toContain("47");
    expect(md).toContain("12");
  });
});
