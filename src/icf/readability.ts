/**
 * Readability formulas: Flesch-Kincaid Grade Level, Flesch Reading
 * Ease, Gunning Fog Index, SMOG Grade.
 *
 * All four standard formulas in one place so the tool can report a
 * cross-validated readability picture (no single score is perfect;
 * disagreements between FKGL and SMOG often signal text with unusual
 * sentence-vs-word complexity tradeoffs).
 *
 * References:
 * - Kincaid, Fishburne, Rogers, Chissom (1975). FKGL.
 * - Flesch (1948). Reading Ease.
 * - Gunning (1952). Fog Index.
 * - McLaughlin (1969). SMOG.
 */
import { countSyllables, countComplexWord } from "./syllables.js";
import type { DocumentStats, ReadabilityScores } from "./types.js";

/**
 * Split into sentences using punctuation as terminators. Handles common
 * abbreviations (Dr., Mr., e.g., i.e.) by NOT splitting on them.
 */
const ABBREV = new Set([
  "dr",
  "mr",
  "mrs",
  "ms",
  "prof",
  "st",
  "co",
  "ltd",
  "inc",
  "corp",
  "vs",
  "etc",
  "e.g",
  "i.e",
  "fig",
  "vol",
  "pp",
  "no",
  "ed",
  "eds",
]);

export function splitSentences(text: string): string[] {
  if (!text || text.trim().length === 0) return [];
  // Normalise newlines and bullets to sentence terminators.
  const normalised = text.replace(/\s+/g, " ").trim();
  const candidates: string[] = [];
  let start = 0;
  for (let i = 0; i < normalised.length; i++) {
    const ch = normalised[i];
    if (ch === "." || ch === "!" || ch === "?") {
      // Look-back for known abbreviation immediately before the period.
      const prevWord = normalised
        .slice(Math.max(0, i - 8), i)
        .toLowerCase()
        .match(/[a-z.]+$/)?.[0];
      if (
        ch === "." &&
        prevWord &&
        ABBREV.has(prevWord.replace(/\.$/, ""))
      ) {
        continue; // skip — abbreviation, not a sentence end
      }
      // Look-ahead — must be followed by whitespace+capital or EOS.
      const next = normalised[i + 1];
      const next2 = normalised[i + 2];
      if (
        i === normalised.length - 1 ||
        (next === " " &&
          next2 &&
          (next2 === next2.toUpperCase() || /[0-9"(]/.test(next2)))
      ) {
        candidates.push(normalised.slice(start, i + 1).trim());
        start = i + 1;
      }
    }
  }
  if (start < normalised.length) {
    const tail = normalised.slice(start).trim();
    if (tail.length > 0) candidates.push(tail);
  }
  return candidates.filter((s) => s.length > 0);
}

export function tokenizeWords(sentence: string): string[] {
  return sentence
    .replace(/[^a-zA-Z\s'-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0 && /[a-zA-Z]/.test(w));
}

export function computeStats(text: string): {
  stats: DocumentStats;
  sentenceTokens: Array<{
    raw: string;
    words: string[];
    syllables: number;
    complex: number;
  }>;
} {
  const sentences = splitSentences(text);
  const sentenceTokens = sentences.map((raw) => {
    const words = tokenizeWords(raw);
    const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
    const complex = words.reduce(
      (sum, w) => sum + (countComplexWord(w) ? 1 : 0),
      0,
    );
    return { raw, words, syllables, complex };
  });

  const totalSentences = sentenceTokens.length;
  const totalWords = sentenceTokens.reduce((s, t) => s + t.words.length, 0);
  const totalSyllables = sentenceTokens.reduce(
    (s, t) => s + t.syllables,
    0,
  );
  const complexWords = sentenceTokens.reduce((s, t) => s + t.complex, 0);

  const avgSentenceLength = totalSentences > 0 ? totalWords / totalSentences : 0;
  const avgSyllablesPerWord = totalWords > 0 ? totalSyllables / totalWords : 0;

  return {
    stats: {
      total_sentences: totalSentences,
      total_words: totalWords,
      total_syllables: totalSyllables,
      complex_words: complexWords,
      avg_sentence_length: avgSentenceLength,
      avg_syllables_per_word: avgSyllablesPerWord,
    },
    sentenceTokens,
  };
}

export function fleschKincaidGrade(stats: DocumentStats): number {
  if (stats.total_sentences === 0 || stats.total_words === 0) return 0;
  return (
    0.39 * stats.avg_sentence_length +
    11.8 * stats.avg_syllables_per_word -
    15.59
  );
}

export function fleschReadingEase(stats: DocumentStats): number {
  if (stats.total_sentences === 0 || stats.total_words === 0) return 0;
  return (
    206.835 -
    1.015 * stats.avg_sentence_length -
    84.6 * stats.avg_syllables_per_word
  );
}

export function gunningFog(stats: DocumentStats): number {
  if (stats.total_sentences === 0 || stats.total_words === 0) return 0;
  return (
    0.4 *
    (stats.avg_sentence_length +
      100 * (stats.complex_words / stats.total_words))
  );
}

export function smog(stats: DocumentStats): number {
  // SMOG was designed for ≥30 sentences; for shorter text we still
  // apply the formula but note in the markdown that SMOG is unreliable
  // below 30 sentences.
  if (stats.total_sentences === 0) return 0;
  return (
    1.043 * Math.sqrt((stats.complex_words * 30) / stats.total_sentences) +
    3.1291
  );
}

export function computeReadabilityScores(
  stats: DocumentStats,
): ReadabilityScores {
  return {
    flesch_kincaid_grade: round1(fleschKincaidGrade(stats)),
    flesch_reading_ease: round1(fleschReadingEase(stats)),
    gunning_fog: round1(gunningFog(stats)),
    smog: round1(smog(stats)),
  };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
