/**
 * Pinning tests for the MFN basket constant + ceiling math.
 *
 * The basket comes from CMS GUARD/GLOBE rulemaking. If CMS changes the
 * country list, these tests fail and the next agent must bump
 * MFN_BASKET_REVISION + the test fixtures together. That's intentional —
 * the basket is not a guess.
 */
import {
  MFN_BASKET_2026,
  MFN_BASKET_REVISION,
  MFN_COUNTRY_NAMES,
  computeMfnCeiling,
  getMfnReferenceCountries,
  type CountryIso2,
} from "../../src/data/mfnBasket.js";

describe("MFN_BASKET_2026 — 19-country GUARD/GLOBE reference set", () => {
  it("contains exactly 19 countries", () => {
    expect(MFN_BASKET_2026.length).toBe(19);
  });

  it("contains every country listed verbatim on the CMS basket (deck slide 18 reproduction)", () => {
    // Deck-reproduced order: Europe → Asia-Pacific → North America → Other.
    // Test asserts membership, not order, so reordering for clarity is safe.
    const expected = new Set<CountryIso2>([
      "AT",
      "BE",
      "CZ",
      "DK",
      "FR",
      "DE",
      "IE",
      "IT",
      "NL",
      "NO",
      "ES",
      "SE",
      "CH",
      "GB",
      "AU",
      "JP",
      "KR",
      "CA",
      "IL",
    ]);
    expect(new Set(MFN_BASKET_2026)).toEqual(expected);
  });

  it("does NOT include US (the US is the priced market, not a reference)", () => {
    expect(MFN_BASKET_2026).not.toContain("US" as CountryIso2);
  });

  it("does NOT include large OECD countries that fail the GDP-per-capita criterion", () => {
    // Mexico, Turkey, Poland, Chile have either GDP-per-capita below
    // the 60%-of-US threshold or total GDP below $400B. Including any
    // would be a CMS rule violation.
    const violators: string[] = ["MX", "TR", "PL", "CL", "GR", "PT"];
    for (const v of violators) {
      expect(MFN_BASKET_2026).not.toContain(v as CountryIso2);
    }
  });

  it("has a display name for every basket country", () => {
    for (const code of MFN_BASKET_2026) {
      expect(MFN_COUNTRY_NAMES[code]).toBeDefined();
      expect(MFN_COUNTRY_NAMES[code].length).toBeGreaterThan(0);
    }
  });

  it("revision stamp is set and looks like YYYY-MM", () => {
    expect(MFN_BASKET_REVISION).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("getMfnReferenceCountries", () => {
  it("returns the full basket when no exclusions supplied", () => {
    expect(getMfnReferenceCountries()).toEqual(MFN_BASKET_2026);
  });

  it("removes excluded countries", () => {
    const out = getMfnReferenceCountries({ excluded_countries: ["JP", "KR"] });
    expect(out).not.toContain("JP");
    expect(out).not.toContain("KR");
    expect(out.length).toBe(MFN_BASKET_2026.length - 2);
  });

  it("ignores exclusions that aren't in the basket (no error)", () => {
    // Caller might pass random codes; we silently filter rather than throw,
    // because the basket is the source of truth and unknown codes are
    // a no-op.
    const out = getMfnReferenceCountries({
      excluded_countries: ["US" as CountryIso2, "BR" as CountryIso2],
    });
    expect(out).toEqual(MFN_BASKET_2026);
  });
});

describe("computeMfnCeiling", () => {
  it("returns ceiling = min(basket excluding US) and lists contributors", () => {
    const result = computeMfnCeiling({ DE: 100, FR: 95, GB: 110, IT: 105 });
    expect(result.ceiling).toBe(95);
    expect(result.contributing_countries.sort()).toEqual([
      "DE",
      "FR",
      "GB",
      "IT",
    ]);
    expect(result.missing_countries.length).toBe(15); // 19 - 4
  });

  it("returns null ceiling when no basket prices supplied", () => {
    const result = computeMfnCeiling({});
    expect(result.ceiling).toBeNull();
    expect(result.contributing_countries).toEqual([]);
    expect(result.missing_countries.length).toBe(19);
  });

  it("excludes US from the contributing set even if caller passes a US price by mistake", () => {
    // US is not in CountryIso2 so this is a defensive test against
    // callers using a wider type. The basket itself never includes US,
    // so any US price simply doesn't contribute.
    const result = computeMfnCeiling({
      DE: 100,
      US: 200,
    } as Partial<Record<CountryIso2, number>>);
    expect(result.ceiling).toBe(100); // not 100 because US is ignored
    expect(result.contributing_countries).toEqual(["DE"]);
  });

  it("respects exclusions in the ceiling math", () => {
    // If FR is excluded (e.g. drug not marketed there yet), the next
    // cheapest country contributes.
    const result = computeMfnCeiling(
      { DE: 100, FR: 90, GB: 110 },
      { excluded_countries: ["FR"] },
    );
    expect(result.ceiling).toBe(100);
    expect(result.contributing_countries.sort()).toEqual(["DE", "GB"]);
    expect(result.missing_countries).not.toContain("FR");
  });

  it("rejects negative prices with a typed error", () => {
    expect(() => computeMfnCeiling({ DE: 100, FR: -5 })).toThrow(TypeError);
  });

  it("rejects NaN / Infinity prices with a typed error", () => {
    expect(() => computeMfnCeiling({ DE: NaN })).toThrow(TypeError);
    expect(() => computeMfnCeiling({ DE: Infinity })).toThrow(TypeError);
  });

  it("accepts a price of 0 (free in that market) as a valid floor", () => {
    // Edge case: a country might publish a zero net price (full rebate
    // back). That correctly drives the ceiling to 0; we don't silently
    // drop it.
    const result = computeMfnCeiling({ DE: 100, FR: 0 });
    expect(result.ceiling).toBe(0);
    expect(result.contributing_countries.sort()).toEqual(["DE", "FR"]);
  });
});
