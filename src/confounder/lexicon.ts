/**
 * Confounder lexicon — Design log #43.
 *
 * A curated, RRMS-aware + generic ontology of baseline-characteristic /
 * prognostic / treatment-decision variables. Drives THREE deterministic
 * behaviours of confounder_identification:
 *   1. mapToConsolidated() — normalise a granular variable to a consolidated
 *      confounder label (Pufulete Step 2 HINTS — never an auto-merge decision).
 *   2. heuristicScan()     — the no-LLM fallback extractor over abstract text.
 *   3. expertInterviewBlock() — confounders literature cannot supply (Step 3).
 *
 * This is intentionally NOT exhaustive. Recall depends on the agent supplying
 * rich candidate_extractions; the lexicon is a safety net + a consolidation map.
 */

export interface ConsolidatedHit {
  label: string;
  category: string;
}

/**
 * Ordered patterns. First match wins, so more-specific patterns precede
 * more-general ones (e.g. "number of prior DMTs" before "prior DMT").
 */
export const CONFOUNDER_PATTERNS: Array<{
  re: RegExp;
  label: string;
  category: string;
}> = [
  // demographics
  { re: /\bages?\b|aged?\b/i, label: "Age", category: "demographics" },
  { re: /\b(sex|gender)\b/i, label: "Sex", category: "demographics" },
  { re: /\b(body ?weight|bmi|body mass index)\b/i, label: "Body weight / BMI", category: "demographics" },
  { re: /\b(race|ethnic\w*)\b/i, label: "Race/ethnicity", category: "demographics" },
  { re: /\b(pregnan\w*|childbearing)\b/i, label: "Pregnancy / childbearing status", category: "demographics" },
  // disease history
  { re: /\btime since diagnosis|years? since diagnosis\b/i, label: "Time since diagnosis", category: "disease history" },
  { re: /\b(disease duration|duration of (the )?disease|time since onset)\b/i, label: "Disease duration", category: "disease history" },
  { re: /\b(disease course|phenotype|subtype|rrms|spms|relapsing[- ]remitting)\b/i, label: "MS disease course", category: "disease history" },
  // disease severity
  { re: /\b(edss|expanded disability status|baseline disability|disability (score|status))\b/i, label: "Baseline disability (EDSS)", category: "disease severity" },
  { re: /\b(functional system score|\bfss\b)\b/i, label: "Functional system scores", category: "disease severity" },
  { re: /\b(sdmt|cognit\w+|symbol digit)\b/i, label: "Cognitive function (SDMT)", category: "disease severity" },
  // disease activity
  { re: /\b(number of (prior |previous )?relapses|prior relapses|relapses in the (prior|previous|preceding))\b/i, label: "Prior relapse count", category: "disease activity" },
  { re: /\b(annuali[sz]ed relapse rate|\barr\b|relapse rate)\b/i, label: "Relapse rate (ARR)", category: "disease activity" },
  // MRI
  { re: /\b(gd[- ]enhancing|gadolinium[- ]enhancing|enhancing lesions?)\b/i, label: "Gd-enhancing lesions", category: "MRI" },
  { re: /\b(t2 (hyperintense )?lesions?|t2 lesion (volume|count|load|burden)|lesion (volume|load|burden))\b/i, label: "T2 lesion burden", category: "MRI" },
  { re: /\b(brain volume|brain atrophy|atrophy)\b/i, label: "Brain volume / atrophy", category: "MRI" },
  // treatment history
  { re: /\b(number of (prior|previous) (dmt|disease[- ]modifying|treatments?))\b/i, label: "Number of prior DMTs", category: "treatment history" },
  { re: /\b(washout|time since last (dmt|treatment))\b/i, label: "Washout / time since last DMT", category: "treatment history" },
  { re: /\b(prior (dmt|disease[- ]modifying|treatment)|treatment[- ]na(i|ï)ve|previously treated|treatment history|treatment[- ]experienced)\b/i, label: "Prior DMT exposure", category: "treatment history" },
  // comorbidity / lifestyle / biomarker
  { re: /\b(comorbid\w*|depression|cardiovascular)\b/i, label: "Comorbidities", category: "comorbidity" },
  { re: /\b(smoking|smoker|tobacco)\b/i, label: "Smoking status", category: "lifestyle" },
  { re: /\b(vitamin d|25[- ]oh)\b/i, label: "Vitamin D level", category: "biomarker" },
  { re: /\b(jc ?virus|\bjcv\b|serostatus)\b/i, label: "JC virus serostatus", category: "biomarker" },
  // study / context
  { re: /\b(geograph\w*|region|country|study site|\bsite\b)\b/i, label: "Geographic region / site", category: "study context" },
];

export function normalizeRaw(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Map a granular variable name to its consolidated confounder. Returns
 * undefined when the variable doesn't match a known confounder family (the
 * candidate is still kept — this only affects consolidation HINTS).
 */
export function mapToConsolidated(name: string): ConsolidatedHit | undefined {
  const n = normalizeRaw(name);
  for (const p of CONFOUNDER_PATTERNS) {
    if (p.re.test(n)) return { label: p.label, category: p.category };
  }
  return undefined;
}

export interface HeuristicCandidate {
  variable_name: string;
  category: string;
}

/**
 * Deterministic no-LLM fallback: scan free text (title + abstract) for known
 * confounder mentions. Low recall by design (abstracts rarely carry baseline
 * tables) — this is a safety net, not the primary extraction path.
 */
export function heuristicScan(text: string): HeuristicCandidate[] {
  const seen = new Set<string>();
  const out: HeuristicCandidate[] = [];
  for (const p of CONFOUNDER_PATTERNS) {
    if (p.re.test(text) && !seen.has(p.label)) {
      seen.add(p.label);
      out.push({ variable_name: p.label, category: p.category });
    }
  }
  return out;
}

/**
 * Confounders that literature cannot supply — must come from clinician/patient
 * elicitation (Pufulete Step 3). GA23-02 surfaced 2 such "unmeasurable"
 * confounders; this returns the indication-aware class list.
 */
export function expertInterviewBlock(
  indication: string,
): Array<{ variable: string; reason: string }> {
  const generic = [
    {
      variable: "Patient treatment preference",
      reason:
        "Driver of treatment assignment that is rarely recorded in trials or claims; obtainable only by clinician/patient elicitation.",
    },
    {
      variable: "Tolerability / side-effect expectation",
      reason:
        "Anticipated tolerability shapes prescribing and switching but is not a measured baseline variable.",
    },
    {
      variable: "Physician prescribing heuristic",
      reason:
        "Local/individual prescribing habits confound assignment and are not captured in the literature.",
    },
    {
      variable: "Adherence propensity",
      reason:
        "Expected adherence influences both treatment choice and outcome; not a measured baseline covariate.",
    },
  ];
  if (/multiple sclerosis|\bms\b|rrms|relapsing/i.test(indication)) {
    generic.splice(2, 0, {
      variable: "Route-of-administration / injection-fatigue preference",
      reason:
        "Oral vs injectable preference (e.g. DMF vs glatiramer acetate) drives assignment in MS but is an unmeasured patient attitude.",
    });
  }
  return generic;
}
