import { closestMatch, suggestForEnum } from "../../src/util/didYouMean.js";

describe("closestMatch — single-best Levenshtein suggestion", () => {
  it("returns the single closest enum value within the threshold (typo)", () => {
    // "embese" → "embase" is a 1-char typo; should match
    const r = closestMatch("embese", ["pubmed", "nice_ta", "embase"]);
    expect(r).toBe("embase");
  });

  it("does NOT match radically different strings (e.g., 'heta' vs 'nice_ta')", () => {
    // "heta" → "nice_ta" is too far; better handled by alias/macro
    const r = closestMatch("heta", ["pubmed", "nice_ta", "embase"]);
    expect(r).toBeNull();
  });

  it("returns the closest of multiple plausible candidates", () => {
    const r = closestMatch("clincaltrials", [
      "pubmed",
      "clinicaltrials",
      "embase",
    ]);
    expect(r).toBe("clinicaltrials");
  });

  it("returns null when nothing is close enough (max edit distance)", () => {
    expect(closestMatch("xyz", ["pubmed", "nice_ta"])).toBeNull();
  });

  it("returns null on empty candidate list", () => {
    expect(closestMatch("anything", [])).toBeNull();
  });

  it("is case-insensitive on input but returns canonical (original) candidate", () => {
    expect(closestMatch("PUBMD", ["pubmed", "embase"])).toBe("pubmed");
  });
});

describe("suggestForEnum — multiple suggestions with explanation", () => {
  it("returns top-3 nearest matches for a realistic typo", () => {
    // "pumed" → close to "pubmed"; should return at least one suggestion
    const r = suggestForEnum("pumed", [
      "pubmed",
      "embase",
      "cochrane",
      "biorxiv",
    ]);
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(3);
    expect(r[0]).toBe("pubmed");
  });

  it("returns empty array when no matches close enough", () => {
    expect(suggestForEnum("xyz", ["pubmed", "embase"])).toEqual([]);
  });
});
