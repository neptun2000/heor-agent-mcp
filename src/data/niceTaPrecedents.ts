/**
 * NICE Technology Appraisal precedent lookup.
 *
 * Maps drug-indication pairs to the relevant NICE TA number(s).
 * Used by `hta_dossier` (NICE branch) to surface known precedents
 * upfront and to catch user prompt errors of the form
 * "cite TA902 for HFrEF" (TA902 is HFpEF/HFmrEF; TA679 is HFrEF).
 *
 * Verification policy:
 * - Each entry is the canonical TA at time of writing (2026-05).
 * - Indications use lowercase free-form keywords; matching is
 *   substring-based to tolerate user phrasing variation.
 * - When the user passes a different TA number in prose, the
 *   tool surfaces both the user's number and the canonical one
 *   without auto-overriding (we annotate the mismatch but
 *   defer to user judgement).
 *
 * To add an entry: append to PRECEDENTS, keep keywords lowercase,
 * keep `confidence: "high"` only for personally-verified entries.
 *
 * See design log #16.
 */
export interface NicePrecedent {
  ta_number: string; // e.g. "TA679"
  drug: string; // generic drug name, lowercase
  indication_keywords: string[]; // lowercase substring matchers
  title: string; // canonical NICE title
  date: string; // YYYY-MM (publication / latest update)
  url: string; // canonical NICE URL
  notes?: string; // disambiguation notes
  confidence: "high" | "medium";
}

/**
 * v1 list — top NICE TAs likely to be cited in HEOR submissions
 * for the indications HEORAgent is most often used for. Expand
 * over time. ~50 entries is enough to catch the common confusions
 * (HFrEF vs HFpEF, indication-specific TAs, biosimilar splits).
 */
export const PRECEDENTS: ReadonlyArray<NicePrecedent> = [
  // SGLT2 inhibitors in heart failure — the TA679 / TA902 confusion
  // that the management benchmark exposed.
  {
    ta_number: "TA679",
    drug: "dapagliflozin",
    indication_keywords: [
      "hfref",
      "heart failure with reduced ejection fraction",
      "reduced ejection fraction",
    ],
    title:
      "Dapagliflozin for treating chronic heart failure with reduced ejection fraction",
    date: "2021-02",
    url: "https://www.nice.org.uk/guidance/ta679",
    notes: "DO NOT confuse with TA902 — TA902 covers HFpEF/HFmrEF, not HFrEF.",
    confidence: "high",
  },
  {
    ta_number: "TA902",
    drug: "dapagliflozin",
    indication_keywords: [
      "hfpef",
      "hfmref",
      "preserved ejection fraction",
      "mildly reduced ejection fraction",
    ],
    title:
      "Dapagliflozin for treating chronic heart failure with preserved or mildly reduced ejection fraction",
    date: "2023-06",
    url: "https://www.nice.org.uk/guidance/ta902",
    notes: "DO NOT confuse with TA679 — TA679 covers HFrEF.",
    confidence: "high",
  },
  {
    ta_number: "TA773",
    drug: "empagliflozin",
    indication_keywords: [
      "hfref",
      "heart failure with reduced ejection fraction",
    ],
    title:
      "Empagliflozin for treating chronic heart failure with reduced ejection fraction",
    date: "2022-03",
    url: "https://www.nice.org.uk/guidance/ta773",
    confidence: "high",
  },
  {
    ta_number: "TA929",
    drug: "empagliflozin",
    indication_keywords: [
      "hfpef",
      "hfmref",
      "preserved ejection fraction",
      "mildly reduced ejection fraction",
    ],
    title:
      "Empagliflozin for treating chronic heart failure with preserved or mildly reduced ejection fraction",
    date: "2023-09",
    url: "https://www.nice.org.uk/guidance/ta929",
    confidence: "high",
  },
  // SGLT2i in CKD
  {
    ta_number: "TA775",
    drug: "dapagliflozin",
    indication_keywords: ["chronic kidney disease", "ckd"],
    title: "Dapagliflozin for treating chronic kidney disease",
    date: "2022-03",
    url: "https://www.nice.org.uk/guidance/ta775",
    confidence: "high",
  },
  // SGLT2i in T2D
  {
    ta_number: "TA288",
    drug: "dapagliflozin",
    indication_keywords: ["type 2 diabetes", "t2dm", "type-2 diabetes"],
    title: "Dapagliflozin in combination therapy for treating type 2 diabetes",
    date: "2013-06",
    url: "https://www.nice.org.uk/guidance/ta288",
    confidence: "high",
  },
  // ARNI in HF
  {
    ta_number: "TA388",
    drug: "sacubitril valsartan",
    indication_keywords: [
      "heart failure",
      "hfref",
      "reduced ejection fraction",
    ],
    title:
      "Sacubitril valsartan for treating symptomatic chronic heart failure with reduced ejection fraction",
    date: "2016-04",
    url: "https://www.nice.org.uk/guidance/ta388",
    confidence: "high",
  },
];

/**
 * Look up NICE TA precedents that match the given drug and indication
 * substrings. Returns 0..n matches, ranked by drug match first then
 * by number of indication keyword matches.
 *
 * Matching is intentionally loose: we want to catch "HFrEF",
 * "heart failure with reduced ejection fraction", and "hf with
 * reduced EF" all matching TA679. Both drug name and indication
 * are lowercased before substring comparison.
 */
export function findPrecedents(
  drug: string,
  indication: string,
): NicePrecedent[] {
  const drugLower = drug.toLowerCase().trim();
  const indicationLower = indication.toLowerCase().trim();
  if (!drugLower || !indicationLower) return [];

  // Token-set drug match: split both sides on whitespace AND hyphen
  // ("sacubitril-valsartan" ↔ "sacubitril valsartan"), then require the
  // two token sets to be EQUAL. Prevents false positives like single-word
  // "valsartan" (ARB) matching multi-word "sacubitril valsartan" (ARNI).
  // Bare "valsartan" → set {valsartan} ≠ {sacubitril, valsartan} → no match.
  // "sacubitril valsartan" → set {sacubitril, valsartan} = {sacubitril,
  // valsartan} → match.
  const tokenize = (s: string): Set<string> =>
    new Set(s.split(/[\s-]+/).filter(Boolean));
  const drugTokens = tokenize(drugLower);
  const scored = PRECEDENTS.map((p) => {
    const pTokens = tokenize(p.drug);
    const drugMatch =
      drugTokens.size === pTokens.size &&
      [...drugTokens].every((w) => pTokens.has(w));
    if (!drugMatch) return { p, score: 0 };
    const matchedKeywords = p.indication_keywords.filter((kw) =>
      indicationLower.includes(kw),
    );
    return { p, score: matchedKeywords.length };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.p);
}

/**
 * Detect when a user-supplied TA number is mismatched against the
 * canonical TA for the indication. Returns a structured warning
 * payload the caller can surface in the dossier output and audit.
 *
 * Example: user prompt "cite TA902 for dapagliflozin HFrEF"
 *   → detects TA902 in prose, looks up canonical TA for
 *     dapagliflozin+HFrEF (TA679), and returns a warning recommending
 *     correction.
 */
export interface PrecedentMismatch {
  user_supplied: string; // e.g. "TA902"
  canonical: string; // e.g. "TA679"
  user_supplied_url?: string;
  canonical_url: string;
  drug: string;
  indication: string;
  explanation: string;
}

export function detectMismatch(
  drug: string,
  indication: string,
  userSuppliedTaNumber: string | null | undefined,
): PrecedentMismatch | null {
  if (!userSuppliedTaNumber) return null;
  const userTa = userSuppliedTaNumber.trim().toUpperCase();
  const canonical = findPrecedents(drug, indication);
  if (canonical.length === 0) return null;
  const top = canonical[0];
  if (top.ta_number.toUpperCase() === userTa) return null;
  // Check whether the user-supplied TA exists in our table for any
  // OTHER indication of the same drug — if so, we can give a much
  // more informative explanation.
  const userTaEntry = PRECEDENTS.find(
    (p) => p.ta_number.toUpperCase() === userTa,
  );
  let explanation: string;
  if (userTaEntry) {
    explanation =
      `User cited ${userTa} (${userTaEntry.title}) but the canonical NICE TA for ` +
      `"${drug} ${indication}" is ${top.ta_number} (${top.title}). ` +
      `${userTaEntry.notes ?? ""} ${top.notes ?? ""}`.trim();
  } else {
    explanation =
      `User cited ${userTa} but the canonical NICE TA for ` +
      `"${drug} ${indication}" is ${top.ta_number} (${top.title}).`;
  }
  return {
    user_supplied: userTa,
    canonical: top.ta_number,
    user_supplied_url: userTaEntry?.url,
    canonical_url: top.url,
    drug,
    indication,
    explanation,
  };
}

/**
 * Extract a TA number (e.g. "TA902") from arbitrary prose. Returns
 * the first match or null. Used to scan e.g. evidence_summary for
 * a TA number the user may have referenced informally.
 *
 * Handles common prose variations: "TA679", "TA 679", "NICE TA 773",
 * "TA679." (with trailing punctuation). Output is normalised to
 * "TA<digits>" form (no internal whitespace).
 */
const TA_NUMBER_REGEX = /\bTA\s*(\d{2,4})\b/i;
export function extractTaNumber(text: string): string | null {
  const m = text.match(TA_NUMBER_REGEX);
  return m ? `TA${m[1]}` : null;
}

/**
 * Extract ALL TA numbers from arbitrary prose (not just the first).
 * Useful when an evidence summary references multiple appraisals
 * (e.g. "Per TA902 for HFpEF and TA679 for HFrEF").
 */
const TA_NUMBER_REGEX_GLOBAL = /\bTA\s*(\d{2,4})\b/gi;
export function extractAllTaNumbers(text: string): string[] {
  const matches = Array.from(text.matchAll(TA_NUMBER_REGEX_GLOBAL));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const norm = `TA${m[1]}`;
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}
