/**
 * Tests for verify_citations (utils.verify_citations) — Design log #43.
 *
 * Verifies DOI/PMID citations against Crossref + NCBI E-utilities.
 * The differentiator: detect FABRICATED identifiers (plausible-but-fake DOIs
 * that resolve to nothing) — the failure mode general LLMs hit 36-40% of the
 * time per the PHAROS/Regulaido ISPOR 2026 study.
 *
 * All network calls are mocked via global.fetch. No live network in CI.
 *
 * Status taxonomy:
 *   verified      — identifier resolved against Crossref or PubMed
 *   fabricated    — identifier is FORMAT-VALID but resolves to nothing (404 / empty)
 *   unverifiable  — network failure, or malformed identifier (can't assert fabrication)
 *   url_only      — only a URL, no resolvable DOI/PMID
 */

import { handleVerifyCitations } from "../../src/tools/verifyCitations.js";

type Content = {
  results: Array<{
    input: { id?: string; doi?: string; pmid?: string; url?: string };
    status: "verified" | "fabricated" | "unverifiable" | "url_only";
    resolved_title?: string;
    resolved_year?: number;
    crossref_ok: boolean;
    pubmed_ok: boolean;
    source: "crossref" | "pubmed" | "both" | "none";
    message: string;
    checked_at: string;
  }>;
  summary: {
    total: number;
    verified: number;
    fabricated: number;
    unverifiable: number;
    url_only: number;
    fabrication_count: number;
    verified_rate: number;
  };
  text: string;
};

// Route a mocked fetch by hostname so concurrency reordering doesn't matter.
function mockFetchByUrl(
  router: (url: string) => {
    status: number;
    ok?: boolean;
    body?: unknown;
    throws?: boolean;
  },
) {
  return jest.fn(async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const r = router(url);
    if (r.throws) throw new Error("network down");
    return {
      status: r.status,
      ok: r.ok ?? (r.status >= 200 && r.status < 300),
      statusText: "",
      json: async () => r.body ?? {},
    } as unknown as Response;
  });
}

const CROSSREF_HIT = {
  status: 200,
  body: {
    status: "ok",
    message: {
      title: [
        "Placebo-controlled phase 3 study of oral BG-12 for relapsing MS",
      ],
      "published-print": { "date-parts": [[2012]] },
      author: [{ family: "Gold", given: "R" }],
    },
  },
};

function pubmedHit(pmid: string) {
  return {
    status: 200,
    body: {
      result: {
        uids: [pmid],
        [pmid]: {
          uid: pmid,
          title: "Glatiramer acetate in relapsing-remitting MS",
          pubdate: "2010 Mar",
          authors: [{ name: "Comi G" }],
        },
      },
    },
  };
}

describe("handleVerifyCitations", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rejects an empty citations array", async () => {
    await expect(handleVerifyCitations({ citations: [] })).rejects.toThrow();
  });

  it("rejects more than 100 citations", async () => {
    await expect(
      handleVerifyCitations({
        citations: Array.from({ length: 101 }, (_, i) => ({
          doi: `10.1000/x${i}`,
        })),
      }),
    ).rejects.toThrow();
  });

  it("includes an audit record tagged utils.verify_citations", async () => {
    global.fetch = mockFetchByUrl(() => CROSSREF_HIT);
    const result = await handleVerifyCitations({
      citations: [{ doi: "10.1056/NEJMoa1114287" }],
    });
    expect(result.audit).toBeDefined();
    expect(result.audit.tool).toBe("utils.verify_citations");
  });

  it("marks a resolvable DOI as verified with title/year", async () => {
    global.fetch = mockFetchByUrl((url) =>
      url.includes("crossref") ? CROSSREF_HIT : { status: 404 },
    );
    const result = await handleVerifyCitations({
      citations: [{ doi: "10.1056/NEJMoa1114287" }],
    });
    const c = result.content as Content;
    expect(c.results[0].status).toBe("verified");
    expect(c.results[0].crossref_ok).toBe(true);
    expect(c.results[0].resolved_title).toMatch(/BG-12/);
    expect(c.results[0].resolved_year).toBe(2012);
    expect(c.summary.fabrication_count).toBe(0);
  });

  // ── Acceptance criterion #8: fabricated DOIs marked correctly ──
  it("marks fabricated DOIs correctly", async () => {
    global.fetch = mockFetchByUrl((url) =>
      url.includes("crossref") ? { status: 404 } : { status: 404 },
    );
    const result = await handleVerifyCitations({
      citations: [{ doi: "10.9999/this.is.invented.12345" }],
    });
    const c = result.content as Content;
    expect(c.results[0].status).toBe("fabricated");
    expect(c.results[0].crossref_ok).toBe(false);
    expect(c.summary.fabrication_count).toBe(1);
    expect(c.summary.verified).toBe(0);
  });

  it("marks a resolvable PMID as verified", async () => {
    global.fetch = mockFetchByUrl((url) =>
      url.includes("eutils") ? pubmedHit("20520642") : { status: 404 },
    );
    const result = await handleVerifyCitations({
      citations: [{ pmid: "20520642" }],
    });
    const c = result.content as Content;
    expect(c.results[0].status).toBe("verified");
    expect(c.results[0].pubmed_ok).toBe(true);
    expect(c.results[0].source).toBe("pubmed");
  });

  it("marks a fabricated PMID (esummary returns error) as fabricated", async () => {
    global.fetch = mockFetchByUrl((url) =>
      url.includes("eutils")
        ? {
            status: 200,
            body: {
              result: {
                uids: [],
                "99999999": { error: "cannot get document summary" },
              },
            },
          }
        : { status: 404 },
    );
    const result = await handleVerifyCitations({
      citations: [{ pmid: "99999999" }],
    });
    const c = result.content as Content;
    expect(c.results[0].status).toBe("fabricated");
    expect(c.summary.fabrication_count).toBe(1);
  });

  it("marks a URL with no resolvable DOI/PMID as url_only (no API call)", async () => {
    const spy = mockFetchByUrl(() => CROSSREF_HIT);
    global.fetch = spy;
    const result = await handleVerifyCitations({
      citations: [{ url: "https://example.org/some/landing/page" }],
    });
    const c = result.content as Content;
    expect(c.results[0].status).toBe("url_only");
    expect(spy).not.toHaveBeenCalled();
  });

  it("extracts and verifies a DOI embedded in a doi.org URL", async () => {
    global.fetch = mockFetchByUrl((url) =>
      url.includes("crossref") ? CROSSREF_HIT : { status: 404 },
    );
    const result = await handleVerifyCitations({
      citations: [{ url: "https://doi.org/10.1056/NEJMoa1114287" }],
    });
    const c = result.content as Content;
    expect(c.results[0].status).toBe("verified");
    expect(c.results[0].crossref_ok).toBe(true);
  });

  it("marks a malformed DOI as unverifiable, not fabricated", async () => {
    const spy = mockFetchByUrl(() => ({ status: 404 }));
    global.fetch = spy;
    const result = await handleVerifyCitations({
      citations: [{ doi: "not-a-real-doi-format" }],
    });
    const c = result.content as Content;
    expect(c.results[0].status).toBe("unverifiable");
    expect(c.results[0].message.toLowerCase()).toContain("malformed");
    expect(c.summary.fabrication_count).toBe(0);
  });

  it("marks a network failure as unverifiable (never fabricated)", async () => {
    global.fetch = mockFetchByUrl(() => ({ status: 0, throws: true }));
    const result = await handleVerifyCitations({
      citations: [{ doi: "10.1056/NEJMoa1114287" }],
    });
    const c = result.content as Content;
    expect(c.results[0].status).toBe("unverifiable");
    expect(c.summary.fabrication_count).toBe(0);
  });
});
