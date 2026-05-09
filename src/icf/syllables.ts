/**
 * Syllable counting heuristic.
 *
 * No dependency on a phonetic dictionary (CMU Pronouncing Dict etc.) —
 * a deterministic rule-based counter that gets within ±1 of the truth
 * for ~95% of English words. Sufficient for readability scoring where
 * aggregate stats matter more than per-word precision.
 *
 * Algorithm (lowercase the word first):
 *   1. Remove leading/trailing non-alpha, drop possessive.
 *   2. Count vowel groups (one or more contiguous a/e/i/o/u/y).
 *   3. Subtract one for a silent terminal "e" (but not "le" — table = 2).
 *   4. Floor at 1 syllable per non-empty word.
 *
 * Special cases handled: words ending in "-le" preceded by a consonant
 * count an extra syllable ("table"=2, "simple"=2). Words ending in "-ed"
 * after a non-d/t consonant are silent ("walked"=1, but "added"=2).
 */

const VOWELS = /[aeiouy]/;

export function countSyllables(rawWord: string): number {
  if (!rawWord) return 0;
  let word = rawWord.toLowerCase().replace(/[^a-z]/g, "");
  if (word.length === 0) return 0;
  if (word.length <= 3) return 1;

  // Drop trailing silent "e" (but preserve "-le" words).
  if (
    word.endsWith("e") &&
    !word.endsWith("le") &&
    !word.endsWith("ee") &&
    !word.endsWith("ie")
  ) {
    word = word.slice(0, -1);
  }
  // "-ed" after non-d/t is silent: walked = walk, jumped = jump.
  if (word.endsWith("ed") && word.length > 3) {
    const beforeEd = word.charAt(word.length - 3);
    if (beforeEd !== "d" && beforeEd !== "t" && !VOWELS.test(beforeEd)) {
      word = word.slice(0, -2);
    }
  }

  // Count vowel groups. The earlier silent-e branch deliberately
  // preserves trailing "e" in "-le" words (e.g., "table"), so the
  // final "e" is correctly counted as its own vowel group here —
  // no extra adjustment needed for "-le" once the silent-e branch
  // has skipped them.
  let count = 0;
  let inVowel = false;
  for (const ch of word) {
    if (VOWELS.test(ch)) {
      if (!inVowel) count++;
      inVowel = true;
    } else {
      inVowel = false;
    }
  }

  return Math.max(1, count);
}

export function countComplexWord(word: string): boolean {
  // Gunning's "complex" = 3+ syllables, excluding proper nouns,
  // compound words, and common suffix-only inflections (-es, -ed,
  // -ing). Approximated here by stripping common inflectional
  // suffixes that DON'T contribute a syllable; we leave alone the
  // ones that do.
  //
  // v1.9.1 fix: pre-fix unconditionally stripped "-es", which made
  // `processes` (3 syllables: pro-ces-ses) look like 2-syllable
  // `process`, leading Gunning Fog and SMOG to UNDER-count complex
  // words and report falsely low grade levels — the unsafe direction
  // for an ICF readability tool. Now we strip only when the suffix
  // is non-syllabic: compare the syllable count before and after, and
  // strip only if it's unchanged.
  if (!word) return false;
  let base = word.toLowerCase().replace(/[^a-z]/g, "");
  if (base.length === 0) return false;

  const tryStrip = (suffix: string, minLen: number): string | null => {
    if (!base.endsWith(suffix)) return null;
    if (base.length <= minLen) return null;
    const stripped = base.slice(0, -suffix.length);
    if (stripped.length === 0) return null;
    if (countSyllables(stripped) === countSyllables(base)) {
      return stripped;
    }
    return null;
  };

  const after = tryStrip("ing", 4) ?? tryStrip("es", 3) ?? tryStrip("ed", 3);
  if (after !== null) base = after;
  // "ied" (carried, married) keeps the syllable from the consonant+ied;
  // covered above by the syllable-count check for "ed".
  return countSyllables(base) >= 3;
}
