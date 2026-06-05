import { fetchEmbase, cleanScopusQuery } from "../../../src/providers/direct/embase.js";

describe("cleanScopusQuery — Scopus/EMBASE query sanitisation", () => {
  it("strips parentheses + bare boolean operators that trigger Scopus 400 'Error translating query'", () => {
    const { cleaned } = cleanScopusQuery(
      "tirzepatide (obesity OR overweight) cost-effectiveness",
    );
    expect(cleaned).not.toMatch(/[()]/);
    expect(cleaned).not.toMatch(/\b(?:AND|OR|NOT)\b/i);
    expect(cleaned).toBe("tirzepatide obesity overweight cost-effectiveness");
  });

  it("strips appended database names", () => {
    const { cleaned, stripped } = cleanScopusQuery(
      "tirzepatide obesity EMBASE PubMed",
    );
    expect(cleaned).toBe("tirzepatide obesity");
    expect(stripped).toEqual(expect.arrayContaining(["embase", "pubmed"]));
  });

  it("leaves a plain query unchanged", () => {
    expect(cleanScopusQuery("tirzepatide obesity").cleaned).toBe(
      "tirzepatide obesity",
    );
  });

  it("preserves wildcards", () => {
    expect(cleanScopusQuery("tirzepatid* obes?").cleaned).toBe(
      "tirzepatid* obes?",
    );
  });

  it("removes stray quotes and field-prefix punctuation", () => {
    const { cleaned } = cleanScopusQuery('TITLE:"tirzepatide" AND {obesity}');
    expect(cleaned).not.toMatch(/["'(){}\[\]:]/);
    expect(cleaned).toBe("TITLE tirzepatide obesity");
  });

  it("collapses multiple spaces after stripping", () => {
    const { cleaned } = cleanScopusQuery("semaglutide  (diabetes OR obesity)");
    expect(cleaned).not.toMatch(/\s{2,}/);
  });
});

describe("fetchEmbase", () => {
  const originalKey = process.env.ELSEVIER_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ELSEVIER_API_KEY;
    } else {
      process.env.ELSEVIER_API_KEY = originalKey;
    }
  });

  it("returns empty array when ELSEVIER_API_KEY is not set", async () => {
    delete process.env.ELSEVIER_API_KEY;
    const results = await fetchEmbase("semaglutide", 5);
    expect(results).toEqual([]);
  });

  it("throws (does not silently return []) on Scopus API error when key is set", async () => {
    process.env.ELSEVIER_API_KEY = "invalid-test-key";
    // With no try/catch, a non-2xx response or network error must propagate
    // so the dispatcher records status:"failed" in the audit trail.
    await expect(fetchEmbase("semaglutide", 5)).rejects.toThrow();
  });
});
