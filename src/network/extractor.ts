import type { LiteratureResult } from "../providers/types.js";
import type { ComparatorPair } from "./types.js";

// Pattern: captures a single drug name (4+ alpha chars, optionally followed by dose)
// Drug names: semaglutide, Liraglutide, sitagliptin, etc.
const DRUG_RE = "([A-Za-z]{4,25}(?:\\s+\\d+\\s*(?:mg|mcg|µg))?)";

// "Drug A vs/versus/compared with Drug B"
const VS_PATTERN = new RegExp(
  `\\b${DRUG_RE}\\s+(?:vs\\.?|versus|compared (?:with|to)|against)\\s+${DRUG_RE}\\b`,
  "gi",
);

// Pattern: "placebo-controlled"
const PLACEBO_PATTERN = /placebo[- ]controlled/i;

// Common noise words to filter out of extracted drug names
const NOISE_WORDS = new Set([
  "the",
  "a",
  "an",
  "in",
  "for",
  "with",
  "and",
  "or",
  "of",
  "to",
  "this",
  "that",
  "these",
  "those",
  "was",
  "were",
  "been",
  "being",
  "study",
  "trial",
  "analysis",
  "results",
  "patients",
  "treatment",
  "therapy",
  "efficacy",
  "safety",
  "outcomes",
  "data",
  "evidence",
  "systematic",
  "review",
  "meta",
  "randomized",
  "controlled",
  "double",
  "blind",
  "open",
  "label",
  "phase",
  "clinical",
  "daily",
  "weekly",
  "monthly",
  "oral",
  "injectable",
  "subcutaneous",
  "intravenous",
  "standard",
  "care",
  "active",
  "comparator",
  "baseline",
  "endpoint",
  "primary",
  "secondary",
  "superior",
  "inferior",
  "noninferior",
  "direct",
  "indirect",
  "comparison",
  "comparing",
]);

function cleanDrugName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(the|a|an|in|of)\s+/i, "")
    .replace(/\s+(group|arm|treatment|therapy|regimen)$/i, "")
    .trim();
}

function isValidDrugName(name: string): boolean {
  const cleaned = cleanDrugName(name).toLowerCase();
  if (cleaned.length < 3 || cleaned.length > 40) return false;
  const words = cleaned.split(/\s+/);
  if (words.every((w) => NOISE_WORDS.has(w))) return false;
  // Must start with a letter
  if (!/^[a-z]/i.test(cleaned)) return false;
  return true;
}

export function normalizeDrugName(name: string): string {
  return cleanDrugName(name)
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function extractFromText(
  text: string,
  patterns: RegExp[],
): Array<{ intervention: string; comparator: string }> {
  const found: Array<{ intervention: string; comparator: string }> = [];
  for (const pattern of patterns) {
    // Reset regex state
    pattern.lastIndex = 0;
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const intervention = cleanDrugName(match[1]);
      const comparator = cleanDrugName(match[2]);
      if (isValidDrugName(intervention) && isValidDrugName(comparator)) {
        found.push({ intervention, comparator });
      }
    }
  }
  return found;
}

function addPair(
  pairs: ComparatorPair[],
  intervention: string,
  comparator: string,
  trialId: string,
  studyType: string,
  confidence: "high" | "medium" | "low",
) {
  const exists = pairs.some(
    (p) =>
      p.trialId === trialId &&
      normalizeDrugName(p.intervention) === normalizeDrugName(intervention) &&
      normalizeDrugName(p.comparator) === normalizeDrugName(comparator),
  );
  if (!exists) {
    pairs.push({ intervention, comparator, trialId, studyType, confidence });
  }
}

export function extractComparatorPairs(
  results: LiteratureResult[],
): ComparatorPair[] {
  const pairs: ComparatorPair[] = [];

  for (const result of results) {
    const id = result.id;
    const studyType = result.study_type;

    // Title extraction (high confidence)
    const titlePairs = extractFromText(result.title, [VS_PATTERN]);
    for (const { intervention, comparator } of titlePairs) {
      addPair(pairs, intervention, comparator, id, studyType, "high");
    }

    // Placebo-controlled pattern
    if (PLACEBO_PATTERN.test(result.title)) {
      const drugMatch = result.title.match(
        /\b([A-Z][a-z]{3,20}(?:\s+\d+\s*mg)?)\b.*?placebo/i,
      );
      if (drugMatch && isValidDrugName(drugMatch[1])) {
        addPair(
          pairs,
          cleanDrugName(drugMatch[1]),
          "Placebo",
          id,
          studyType,
          "high",
        );
      }
    }

    // Abstract extraction (medium confidence)
    const abstractPairs = extractFromText(result.abstract, [VS_PATTERN]);
    for (const { intervention, comparator } of abstractPairs) {
      addPair(pairs, intervention, comparator, id, studyType, "medium");
    }
  }

  return pairs;
}
