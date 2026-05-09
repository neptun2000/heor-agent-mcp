/**
 * Curated medical-jargon dictionary for ICF readability checking.
 *
 * Built from common patterns flagged in NIH Plain Language ICF
 * guidance, FDA's "Communicating Risks and Benefits" guidance, and
 * the most-frequently-cited offenders in IRB consent-form audits.
 *
 * Each entry maps a clinical-trial term to a plain-language alternative
 * and (optionally) a one-line rationale. Matching is case-insensitive
 * with whole-word boundaries (so "co-administered" doesn't match
 * "co-author").
 *
 * v1 covers ~80 high-frequency terms. Future revs can grow this without
 * any code change.
 */

import type { JargonHit } from "./types.js";

export interface JargonEntry {
  term: string;
  plain_language: string;
  rationale?: string;
}

export const JARGON_DICTIONARY: ReadonlyArray<JargonEntry> = [
  // Trial-design terminology
  { term: "randomized", plain_language: "assigned by chance" },
  { term: "randomised", plain_language: "assigned by chance" },
  {
    term: "double-blind",
    plain_language:
      "neither you nor your study doctor will know which group you are in",
  },
  {
    term: "single-blind",
    plain_language: "you will not know which group you are in",
  },
  {
    term: "placebo",
    plain_language: "an inactive substance with no medicine in it",
  },
  {
    term: "open-label",
    plain_language:
      "you and the study doctor will both know which medicine you are taking",
  },
  {
    term: "crossover",
    plain_language:
      "you will switch from one treatment to the other partway through",
  },
  { term: "stratified", plain_language: "grouped by certain characteristics" },
  { term: "cohort", plain_language: "group of people in the study" },
  { term: "arm", plain_language: "treatment group" },
  { term: "intervention", plain_language: "the treatment being studied" },
  { term: "comparator", plain_language: "the treatment being compared" },

  // Adverse events / safety
  {
    term: "adverse event",
    plain_language: "side effect or unwanted health problem",
  },
  { term: "adverse reaction", plain_language: "side effect" },
  {
    term: "serious adverse event",
    plain_language:
      "serious side effect (one that is life-threatening, requires hospital care, or causes lasting harm)",
  },
  { term: "SAE", plain_language: "serious side effect" },
  {
    term: "SUSAR",
    plain_language:
      "an unexpected serious side effect that may be related to the study drug",
  },
  { term: "untoward", plain_language: "unwanted or unexpected" },

  // Pharmacology
  {
    term: "pharmacokinetics",
    plain_language: "how the medicine moves through your body",
  },
  {
    term: "pharmacodynamics",
    plain_language: "how the medicine works in your body",
  },
  {
    term: "bioavailability",
    plain_language: "how much of the medicine your body absorbs",
  },
  {
    term: "half-life",
    plain_language: "how long the medicine stays in your body",
  },
  {
    term: "metabolite",
    plain_language: "a substance your body makes from the medicine",
  },
  {
    term: "metabolism",
    plain_language: "how your body breaks down the medicine",
  },

  // Disease / clinical
  { term: "etiology", plain_language: "cause" },
  { term: "aetiology", plain_language: "cause" },
  { term: "prognosis", plain_language: "likely course of the disease" },
  {
    term: "comorbidity",
    plain_language: "another health condition you have",
  },
  { term: "comorbidities", plain_language: "other health conditions" },
  { term: "concomitant", plain_language: "at the same time" },
  { term: "exacerbation", plain_language: "flare-up or worsening" },
  { term: "remission", plain_language: "the disease is under control" },
  {
    term: "refractory",
    plain_language: "not responding to standard treatment",
  },
  { term: "neoplasm", plain_language: "tumor" },
  { term: "malignant", plain_language: "cancerous" },
  { term: "benign", plain_language: "not cancerous" },
  {
    term: "metastasis",
    plain_language: "the cancer has spread to another part of the body",
  },
  { term: "metastatic", plain_language: "cancer that has spread" },
  {
    term: "in situ",
    plain_language: "in its original place; has not spread",
  },

  // Statistical / measurement
  {
    term: "biomarker",
    plain_language: "a measurement we use to track disease or treatment",
  },
  { term: "endpoint", plain_language: "outcome we are measuring" },
  {
    term: "primary endpoint",
    plain_language: "the main outcome we are measuring",
  },
  {
    term: "secondary endpoint",
    plain_language: "additional outcome we are measuring",
  },
  {
    term: "efficacy",
    plain_language: "how well the treatment works under controlled conditions",
  },
  // v1.9.1 fix: removed an "effectiveness" entry here. NIH Plain Language
  // ICF guidance and FDA Communicating Risks and Benefits recommend
  // "effectiveness" AS the plain-language replacement for "efficacy" —
  // flagging it as jargon contradicts the cited authority and would tell
  // investigators who did the right thing to undo it.
  { term: "incidence", plain_language: "how often new cases occur" },
  {
    term: "prevalence",
    plain_language: "how many people have the condition right now",
  },
  {
    term: "statistical significance",
    plain_language: "the difference is unlikely to be due to chance",
  },
  {
    term: "confidence interval",
    plain_language: "the likely range of the true value",
  },

  // Procedures
  {
    term: "venipuncture",
    plain_language: "blood draw with a needle",
  },
  { term: "phlebotomy", plain_language: "drawing blood" },
  { term: "lumbar puncture", plain_language: "spinal tap" },
  { term: "biopsy", plain_language: "taking a small tissue sample" },
  { term: "intravenous", plain_language: "given through a vein" },
  { term: "subcutaneous", plain_language: "given under the skin" },
  { term: "intramuscular", plain_language: "given into a muscle" },
  { term: "oral", plain_language: "by mouth" },
  { term: "topical", plain_language: "applied to the skin" },
  { term: "ophthalmic", plain_language: "for the eye" },
  { term: "ocular", plain_language: "of the eye" },

  // Regulatory / consent-specific
  {
    term: "informed consent",
    plain_language: "your decision to take part after learning about the study",
  },
  { term: "withdrawal", plain_language: "leaving the study" },
  { term: "discontinuation", plain_language: "stopping" },
  { term: "compensation", plain_language: "payment" },
  { term: "reimbursement", plain_language: "money back for your costs" },
  { term: "remuneration", plain_language: "payment for your time" },
  { term: "ascertain", plain_language: "find out" },
  { term: "elucidate", plain_language: "explain" },
  { term: "facilitate", plain_language: "help" },
  { term: "utilize", plain_language: "use" },
  { term: "utilise", plain_language: "use" },
  { term: "demonstrate", plain_language: "show" },
  { term: "subsequent", plain_language: "later" },
  { term: "prior to", plain_language: "before" },
  { term: "in the event that", plain_language: "if" },
  { term: "in conjunction with", plain_language: "with" },
  { term: "due to the fact that", plain_language: "because" },
  { term: "at this point in time", plain_language: "now" },
];

/**
 * Escape regex metacharacters for safe inclusion in a constructed pattern.
 */
function escapeRegex(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

/**
 * Find all jargon hits in a body of text. Whole-word, case-insensitive.
 * Returns one JargonHit per dictionary entry that matches at least once,
 * with up to 5 occurrence offsets per term (capped to keep the output
 * compact for repeated terms).
 */
export function findJargon(text: string): JargonHit[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const hits: JargonHit[] = [];

  for (const entry of JARGON_DICTIONARY) {
    const term = entry.term.toLowerCase();
    // Optional trailing "s" handles English plurals: "adverse event"
    // matches "adverse events", "biomarker" matches "biomarkers", etc.
    // Harmless on terms with no plural form (e.g., "in situ"). Doesn't
    // cover irregular plurals like "metastasis → metastases" — those
    // get separate dictionary entries when frequent.
    const pattern = new RegExp(`\\b${escapeRegex(term)}s?\\b`, "gi");
    const matches = Array.from(lower.matchAll(pattern));
    if (matches.length === 0) continue;

    const occurrences: Array<{ index: number; matched_form: string }> = [];
    for (const m of matches.slice(0, 5)) {
      const idx = m.index ?? 0;
      occurrences.push({
        index: idx,
        matched_form: text.slice(idx, idx + m[0].length),
      });
    }
    hits.push({
      term: entry.term,
      occurrences,
      plain_language: entry.plain_language,
      rationale: entry.rationale,
    });
  }
  return hits;
}
