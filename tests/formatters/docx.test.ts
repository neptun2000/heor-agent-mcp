import { resultsToDocx, contentToDocx } from "../../src/formatters/docx.js";
import type { LiteratureResult } from "../../src/providers/types.js";
import type { AuditRecord } from "../../src/audit/types.js";

const mockAudit: AuditRecord = {
  tool: "literature_search",
  timestamp: "2026-04-04T12:00:00Z",
  query: { query: "test" },
  sources_queried: [{ source: "pubmed", query_sent: "test", results_returned: 2, results_included: 2, latency_ms: 100, status: "ok" }],
  methodology: "PRISMA-style",
  inclusions: 2,
  exclusions: [],
  assumptions: ["Test assumption"],
  warnings: [],
  output_format: "docx",
};

const mockResults: LiteratureResult[] = [
  { id: "1", source: "pubmed", title: "Test Study", authors: ["Author A"], date: "2024", study_type: "rct", abstract: "Test abstract", url: "https://example.com" },
];

describe("resultsToDocx", () => {
  it("returns a base64-encoded string", async () => {
    const result = await resultsToDocx(mockResults, mockAudit);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    // Verify it's valid base64
    const decoded = Buffer.from(result, "base64");
    expect(decoded.length).toBeGreaterThan(0);
    // DOCX files start with PK (ZIP signature)
    expect(decoded[0]).toBe(0x50); // 'P'
    expect(decoded[1]).toBe(0x4B); // 'K'
  });

  it("handles empty results", async () => {
    const result = await resultsToDocx([], mockAudit);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("contentToDocx", () => {
  it("converts markdown content to base64 DOCX", async () => {
    const result = await contentToDocx("Test Report", "## Section\nSome content", mockAudit);
    expect(typeof result).toBe("string");
    const decoded = Buffer.from(result, "base64");
    expect(decoded[0]).toBe(0x50);
    expect(decoded[1]).toBe(0x4B);
  });
});
