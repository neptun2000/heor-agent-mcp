/**
 * Tests for drugNameNormaliser — INN / brand / biosimilar-suffix → canonical INN.
 *
 * Rules verified:
 * - INN → INN (identity)
 * - Brand "Ajovy" → INN "fremanezumab"
 * - INN+biosimilar-suffix "fremanezumab-vfrm" → INN "fremanezumab"
 * - Case-insensitive ("AJOVY", "ajovy" → same result)
 * - Unknown drug → returns null + did_you_mean[] (top 3 Levenshtein)
 * - Common HEOR molecules covered (fremanezumab, erenumab, galcanezumab,
 *   dapagliflozin, semaglutide, lecanemab, donanemab, etc.)
 */

import { normaliseDrugName } from "../../../src/providers/regulatory/drugNameNormaliser.js";

describe("drugNameNormaliser — INN passthrough", () => {
  it("fremanezumab → fremanezumab", () => {
    const result = normaliseDrugName("fremanezumab");
    expect(result.inn).toBe("fremanezumab");
    expect(result.did_you_mean).toBeUndefined();
  });

  it("erenumab → erenumab", () => {
    const result = normaliseDrugName("erenumab");
    expect(result.inn).toBe("erenumab");
  });

  it("galcanezumab → galcanezumab", () => {
    const result = normaliseDrugName("galcanezumab");
    expect(result.inn).toBe("galcanezumab");
  });

  it("dapagliflozin → dapagliflozin", () => {
    const result = normaliseDrugName("dapagliflozin");
    expect(result.inn).toBe("dapagliflozin");
  });

  it("semaglutide → semaglutide", () => {
    const result = normaliseDrugName("semaglutide");
    expect(result.inn).toBe("semaglutide");
  });

  it("lecanemab → lecanemab", () => {
    const result = normaliseDrugName("lecanemab");
    expect(result.inn).toBe("lecanemab");
  });

  it("donanemab → donanemab", () => {
    const result = normaliseDrugName("donanemab");
    expect(result.inn).toBe("donanemab");
  });
});

describe("drugNameNormaliser — brand name resolution", () => {
  it("Ajovy → fremanezumab", () => {
    const result = normaliseDrugName("Ajovy");
    expect(result.inn).toBe("fremanezumab");
  });

  it("AJOVY (uppercase) → fremanezumab", () => {
    const result = normaliseDrugName("AJOVY");
    expect(result.inn).toBe("fremanezumab");
  });

  it("ajovy (lowercase) → fremanezumab", () => {
    const result = normaliseDrugName("ajovy");
    expect(result.inn).toBe("fremanezumab");
  });

  it("Aimovig → erenumab", () => {
    const result = normaliseDrugName("Aimovig");
    expect(result.inn).toBe("erenumab");
  });

  it("Emgality → galcanezumab", () => {
    const result = normaliseDrugName("Emgality");
    expect(result.inn).toBe("galcanezumab");
  });

  it("Leqembi → lecanemab", () => {
    const result = normaliseDrugName("Leqembi");
    expect(result.inn).toBe("lecanemab");
  });

  it("Ozempic → semaglutide", () => {
    const result = normaliseDrugName("Ozempic");
    expect(result.inn).toBe("semaglutide");
  });

  it("Farxiga → dapagliflozin", () => {
    const result = normaliseDrugName("Farxiga");
    expect(result.inn).toBe("dapagliflozin");
  });
});

describe("drugNameNormaliser — INN+biosimilar-suffix normalisation", () => {
  it("fremanezumab-vfrm → fremanezumab", () => {
    const result = normaliseDrugName("fremanezumab-vfrm");
    expect(result.inn).toBe("fremanezumab");
  });

  it("erenumab-aooe → erenumab", () => {
    const result = normaliseDrugName("erenumab-aooe");
    expect(result.inn).toBe("erenumab");
  });

  it("adalimumab-adaz → adalimumab", () => {
    const result = normaliseDrugName("adalimumab-adaz");
    expect(result.inn).toBe("adalimumab");
  });

  it("galcanezumab-gnlm → galcanezumab", () => {
    const result = normaliseDrugName("galcanezumab-gnlm");
    expect(result.inn).toBe("galcanezumab");
  });
});

describe("drugNameNormaliser — case insensitivity", () => {
  it("FREMANEZUMAB → fremanezumab", () => {
    const result = normaliseDrugName("FREMANEZUMAB");
    expect(result.inn).toBe("fremanezumab");
  });

  it("Semaglutide → semaglutide", () => {
    const result = normaliseDrugName("Semaglutide");
    expect(result.inn).toBe("semaglutide");
  });
});

describe("drugNameNormaliser — unknown drug fallback", () => {
  it("unknown drug returns null inn", () => {
    const result = normaliseDrugName("totally-fake-drug-xyz");
    expect(result.inn).toBeNull();
  });

  it("unknown drug populates did_you_mean[]", () => {
    const result = normaliseDrugName("fremanzumab"); // typo
    expect(result.inn).toBeNull();
    expect(Array.isArray(result.did_you_mean)).toBe(true);
    expect(result.did_you_mean!.length).toBeGreaterThan(0);
    // Top suggestion should be fremanezumab (closest by edit distance)
    expect(result.did_you_mean![0]).toBe("fremanezumab");
  });

  it("did_you_mean returns at most 3 suggestions", () => {
    const result = normaliseDrugName("erenmab"); // typo of erenumab
    expect(result.did_you_mean!.length).toBeLessThanOrEqual(3);
  });

  it("empty string returns null inn", () => {
    const result = normaliseDrugName("");
    expect(result.inn).toBeNull();
  });
});
