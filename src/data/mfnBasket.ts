/**
 * GUARD / GLOBE Most-Favored-Nation (MFN) reference basket.
 *
 * Source: CMS proposed payment models (GUARD = Medicare Part D MFN,
 * GLOBE = Medicare Part B MFN). The basket is the set of OECD countries
 * that meet BOTH:
 *   - PPP-adjusted GDP per capita ≥ 60% of the US
 *   - Total GDP ≥ $400 billion
 *
 * Under CMS's proposed rules, the US net price for an MFN-eligible drug
 * is bounded by the minimum net price observed across this basket.
 *
 * The list below is reproduced from CMS Notice of Proposed Rulemaking
 * (effective dates per the v1.11.0 design log #27). The criteria are
 * public; if CMS changes the threshold, bump MFN_BASKET_REVISION below.
 *
 * 19 countries total — never assume "country X is in the basket" without
 * checking against this constant.
 */

/** ISO 3166-1 alpha-2 country codes used as basket keys throughout. */
export type CountryIso2 =
  | "AT" // Austria
  | "BE" // Belgium
  | "CZ" // Czechia
  | "DK" // Denmark
  | "FR" // France
  | "DE" // Germany
  | "IE" // Ireland
  | "IT" // Italy
  | "NL" // Netherlands
  | "NO" // Norway
  | "ES" // Spain
  | "SE" // Sweden
  | "CH" // Switzerland
  | "GB" // United Kingdom
  | "AU" // Australia
  | "JP" // Japan
  | "KR" // South Korea
  | "CA" // Canada
  | "IL"; // Israel

/**
 * Bump this string whenever CMS revises the basket criteria or country
 * list. Caller-facing tools should stamp this on every emitted dossier
 * section so a 2027 reader can tell which CMS rule version applied.
 */
export const MFN_BASKET_REVISION = "2026-03";

/**
 * Verbatim 19-country GUARD/GLOBE basket. Order matches the CMS
 * publication groupings (Europe → Asia-Pacific → North America → other).
 */
export const MFN_BASKET_2026: readonly CountryIso2[] = [
  // Europe (14)
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
  // Asia-Pacific (3)
  "AU",
  "JP",
  "KR",
  // North America (1)
  "CA",
  // Other OECD (1)
  "IL",
] as const;

/** Country display names — used in dossier-section rendering. */
export const MFN_COUNTRY_NAMES: Readonly<Record<CountryIso2, string>> = {
  AT: "Austria",
  BE: "Belgium",
  CZ: "Czechia",
  DK: "Denmark",
  FR: "France",
  DE: "Germany",
  IE: "Ireland",
  IT: "Italy",
  NL: "Netherlands",
  NO: "Norway",
  ES: "Spain",
  SE: "Sweden",
  CH: "Switzerland",
  GB: "United Kingdom",
  AU: "Australia",
  JP: "Japan",
  KR: "South Korea",
  CA: "Canada",
  IL: "Israel",
};

/**
 * Returns the reference set of countries for MFN ceiling computation,
 * with optional exclusions. Caller might exclude e.g. countries with no
 * marketed product, or override the basket for sensitivity analysis.
 *
 * Default = the full 19-country basket. Excluding any country shrinks
 * the basket; the function never adds countries beyond MFN_BASKET_2026.
 */
export function getMfnReferenceCountries(opts?: {
  excluded_countries?: readonly CountryIso2[];
}): readonly CountryIso2[] {
  const excluded = new Set(opts?.excluded_countries ?? []);
  return MFN_BASKET_2026.filter((c) => !excluded.has(c));
}

/**
 * Computes the projected MFN ceiling from a partial price map.
 *
 * Per CMS GUARD/GLOBE rules, the ceiling is the minimum net price in
 * the reference basket EXCLUDING the US (which is the market being
 * priced). If the caller supplies basket prices including a US entry,
 * we strip it before taking the min.
 *
 * Returns null when no basket prices were supplied — the caller can
 * then render "Insufficient basket data" rather than fabricating a
 * ceiling from zero datapoints.
 *
 * Negative or non-finite prices are rejected (TypeError) — pricing data
 * with bad sign would silently lower the ceiling and mislead a payer
 * discussion.
 */
export function computeMfnCeiling(
  basket_prices: Partial<Record<CountryIso2, number>>,
  opts?: { excluded_countries?: readonly CountryIso2[] },
): {
  ceiling: number | null;
  contributing_countries: CountryIso2[];
  missing_countries: CountryIso2[];
} {
  const reference = getMfnReferenceCountries(opts);
  const contributing: CountryIso2[] = [];
  const missing: CountryIso2[] = [];
  let min: number | null = null;

  for (const c of reference) {
    const price = basket_prices[c];
    if (price === undefined || price === null) {
      missing.push(c);
      continue;
    }
    if (!Number.isFinite(price) || price < 0) {
      throw new TypeError(
        `computeMfnCeiling: basket price for ${c} must be a non-negative finite number, got ${String(price)}`,
      );
    }
    contributing.push(c);
    if (min === null || price < min) {
      min = price;
    }
  }

  return {
    ceiling: contributing.length > 0 ? min : null,
    contributing_countries: contributing,
    missing_countries: missing,
  };
}
