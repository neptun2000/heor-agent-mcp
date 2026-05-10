/**
 * Drug name normaliser — INN / brand / biosimilar-suffix → canonical INN.
 *
 * Design log #25. Covers ~70 most-common HEOR-relevant molecules.
 * Returns did_you_mean[] (Levenshtein-based top-3) when no match.
 *
 * Biosimilar suffix stripping: FDA 4-letter suffixes (e.g., -vfrm, -aooe, -adaz)
 * are stripped to recover the INN stem.
 */

interface NormaliseResult {
  inn: string | null;
  did_you_mean?: string[];
}

// INN → [brand names] mapping (case-insensitive on lookup)
const INN_TO_BRANDS: Record<string, string[]> = {
  // CGRP antibodies
  fremanezumab: ["ajovy"],
  erenumab: ["aimovig"],
  galcanezumab: ["emgality"],
  eptinezumab: ["vyepti"],
  // Alzheimer's
  lecanemab: ["leqembi"],
  donanemab: ["kisunla"],
  aducanumab: ["aduhelm"],
  // Diabetes / obesity
  semaglutide: ["ozempic", "wegovy", "rybelsus"],
  tirzepatide: ["mounjaro", "zepbound"],
  dulaglutide: ["trulicity"],
  liraglutide: ["victoza", "saxenda"],
  dapagliflozin: ["farxiga", "forxiga"],
  empagliflozin: ["jardiance"],
  canagliflozin: ["invokana"],
  // Oncology
  pembrolizumab: ["keytruda"],
  nivolumab: ["opdivo"],
  atezolizumab: ["tecentriq"],
  durvalumab: ["imfinzi"],
  ipilimumab: ["yervoy"],
  trastuzumab: ["herceptin"],
  pertuzumab: ["perjeta"],
  bevacizumab: ["avastin"],
  rituximab: ["rituxan", "mabthera"],
  cetuximab: ["erbitux"],
  osimertinib: ["tagrisso"],
  palbociclib: ["ibrance"],
  ribociclib: ["kisqali"],
  abemaciclib: ["verzenio"],
  // Immunology / rheumatology
  adalimumab: ["humira"],
  etanercept: ["enbrel"],
  infliximab: ["remicade"],
  tocilizumab: ["actemra"],
  sarilumab: ["kevzara"],
  baricitinib: ["olumiant"],
  tofacitinib: ["xeljanz"],
  upadacitinib: ["rinvoq"],
  secukinumab: ["cosentyx"],
  ixekizumab: ["taltz"],
  bimekizumab: ["bimzelx"],
  risankizumab: ["skyrizi"],
  guselkumab: ["tremfya"],
  dupilumab: ["dupixent"],
  tralokinumab: ["adbry"],
  // Cardiology
  evolocumab: ["repatha"],
  alirocumab: ["praluent"],
  inclisiran: ["leqvio"],
  sacubitril: ["entresto"],
  // Rare diseases
  nusinersen: ["spinraza"],
  risdiplam: ["evrysdi"],
  onasemnogene: ["zolgensma"],
  migalastat: ["galafold"],
  ivacaftor: ["kalydeco"],
  elexacaftor: ["trikafta"],
  // Multiple sclerosis
  natalizumab: ["tysabri"],
  ocrelizumab: ["ocrevus"],
  ofatumumab: ["kesimpta"],
  ozanimod: ["zeposia"],
  siponimod: ["mayzent"],
  cladribine: ["mavenclad"],
  // PV / migraine
  lasmiditan: ["reyvow"],
  rimegepant: ["nurtec"],
  ubrogepant: ["ubrelvy"],
  atogepant: ["qulipta"],
  zavegepant: ["zavzpret"],
};

// Reverse map: brand → INN (built from INN_TO_BRANDS)
const BRAND_TO_INN: Map<string, string> = new Map();
for (const [inn, brands] of Object.entries(INN_TO_BRANDS)) {
  for (const brand of brands) {
    BRAND_TO_INN.set(brand.toLowerCase(), inn);
  }
}

// Full INN list for Levenshtein "did you mean"
const ALL_INNS: string[] = Object.keys(INN_TO_BRANDS);

/**
 * Strips FDA 4-letter biosimilar suffix (e.g., "fremanezumab-vfrm" → "fremanezumab").
 * Returns the stem if the suffix matches /^-[a-z]{4}$/i, else returns the original.
 */
function stripBiosimilarSuffix(name: string): string {
  const match = name.match(/^(.+?)-([a-z]{4})$/i);
  if (match) {
    return match[1].toLowerCase();
  }
  return name.toLowerCase();
}

/**
 * Levenshtein distance (simple DP implementation).
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Returns the top-3 closest INN names by Levenshtein distance.
 */
function findDidYouMean(query: string): string[] {
  const lower = query.toLowerCase();
  return ALL_INNS
    .map((inn) => ({ inn, dist: levenshtein(lower, inn) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3)
    .map((x) => x.inn);
}

/**
 * Normalises a drug name to canonical INN.
 *
 * Lookup priority:
 * 1. INN exact match (case-insensitive)
 * 2. Brand name exact match
 * 3. Strip biosimilar suffix → INN match
 * 4. Not found → null + did_you_mean
 */
export function normaliseDrugName(drug: string): NormaliseResult {
  if (!drug || typeof drug !== "string") {
    return { inn: null, did_you_mean: findDidYouMean("") };
  }

  const lower = drug.trim().toLowerCase();
  if (!lower) {
    return { inn: null, did_you_mean: findDidYouMean("") };
  }

  // 1. Direct INN match
  if (lower in INN_TO_BRANDS) {
    return { inn: lower };
  }

  // 2. Brand name match
  const fromBrand = BRAND_TO_INN.get(lower);
  if (fromBrand) {
    return { inn: fromBrand };
  }

  // 3. Strip biosimilar suffix and retry
  const stem = stripBiosimilarSuffix(drug);
  if (stem !== lower) {
    if (stem in INN_TO_BRANDS) {
      return { inn: stem };
    }
    // Also check if stem is a brand
    const stemFromBrand = BRAND_TO_INN.get(stem);
    if (stemFromBrand) {
      return { inn: stemFromBrand };
    }
  }

  // 4. Not found
  return { inn: null, did_you_mean: findDidYouMean(lower) };
}

/**
 * Returns all known brand names for a given INN.
 */
export function getBrandNames(inn: string): string[] {
  const lower = inn.toLowerCase();
  const brands = INN_TO_BRANDS[lower] ?? [];
  // Capitalise first letter for display
  return brands.map((b) => b.charAt(0).toUpperCase() + b.slice(1));
}
