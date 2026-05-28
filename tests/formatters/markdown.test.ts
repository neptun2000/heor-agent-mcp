import {
  resultsToMarkdown,
  auditToMarkdown,
} from "../../src/formatters/markdown.js";
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
    const audit = createAuditRecord("literature.search", {}, "text");
    const md = resultsToMarkdown(mockResults, audit);
    expect(md).toContain("Semaglutide cost-effectiveness study");
    expect(md).toContain("pubmed");
  });

  it("includes audit summary section", () => {
    const audit = createAuditRecord(
      "literature.search",
      { query: "semaglutide" },
      "text",
    );
    const md = resultsToMarkdown(mockResults, audit);
    expect(md).toContain("Audit");
  });
});

describe("auditToMarkdown", () => {
  it("renders sources queried", () => {
    let audit = createAuditRecord("literature.search", {}, "text");
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

  it("without disclosure opts produces no disclosure block", () => {
    const audit = createAuditRecord("hta.workflow", {}, "text");
    const md = auditToMarkdown(audit);
    expect(md).not.toContain("AI Assistance Disclosure");
  });

  it("with disclosure level standard prepends disclosure block", () => {
    const audit = createAuditRecord("hta.workflow", {}, "text");
    const md = auditToMarkdown(audit, {
      disclosure: { level: "standard", dateISO: "2026-05-28" },
    });
    expect(md).toContain("AI Assistance Disclosure");
    expect(md).toContain("Audit Report");
    // disclosure appears before audit trail
    expect(md.indexOf("AI Assistance Disclosure")).toBeLessThan(
      md.indexOf("Audit Report"),
    );
  });

  it("with disclosure level off produces no disclosure block", () => {
    const audit = createAuditRecord("hta.workflow", {}, "text");
    const md = auditToMarkdown(audit, { disclosure: { level: "off" } });
    expect(md).not.toContain("AI Assistance Disclosure");
  });

  it("with disclosure level submission includes ISPOR citation", () => {
    const audit = createAuditRecord("hta.workflow", {}, "text");
    const md = auditToMarkdown(audit, {
      disclosure: { level: "submission", dateISO: "2026-05-28" },
    });
    expect(md).toContain("ELEVATE-GenAI");
    expect(md).toContain("10.1016/j.jval.2025.06.018");
  });
});
