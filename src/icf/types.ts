/**
 * Type definitions for icf_readability_check (paired with irb_review per
 * design log #21 v2 deferral).
 *
 * Pure types — no runtime logic.
 */

export interface ReadabilityScores {
  /**
   * Flesch-Kincaid Grade Level. The US grade level needed to understand
   * the text on a single reading. FDA / IRB guidance typically targets
   * ≤ 8th grade for ICFs (some institutions stricter at 5th-7th).
   */
  flesch_kincaid_grade: number;
  /**
   * Flesch Reading Ease (0-100, higher = easier). Reference scale:
   * 90-100 = 5th grade; 60-70 = 8th-9th grade (plain English target);
   * 30-50 = college; 0-30 = college graduate.
   */
  flesch_reading_ease: number;
  /**
   * Gunning Fog Index. Years of formal education needed. ≥ 12 means
   * "complex" by Gunning's original criteria.
   */
  gunning_fog: number;
  /**
   * SMOG Grade. Estimates years of education for full comprehension.
   * Designed for healthcare/consent reading (McLaughlin 1969); often
   * preferred in clinical-trial contexts.
   */
  smog: number;
}

export interface DocumentStats {
  total_sentences: number;
  total_words: number;
  total_syllables: number;
  /** Words with 3+ syllables (Gunning's "complex words"). */
  complex_words: number;
  /** Mean words per sentence. */
  avg_sentence_length: number;
  /** Mean syllables per word. */
  avg_syllables_per_word: number;
}

export interface SentenceScore {
  index: number;
  text: string;
  word_count: number;
  syllable_count: number;
  flesch_kincaid_grade: number;
  /** True when the sentence's grade level exceeds the target. */
  exceeds_target: boolean;
}

export interface JargonHit {
  term: string;
  /** 0-based offsets into the original text. */
  occurrences: Array<{ index: number; matched_form: string }>;
  /** Plain-language alternative(s). */
  plain_language: string;
  /** Optional brief explanation, shown in the markdown report. */
  rationale?: string;
}

export type Verdict = "pass" | "borderline" | "fail";

export interface IcfReadabilityAssessment {
  scores: ReadabilityScores;
  stats: DocumentStats;
  sentences: SentenceScore[];
  jargon: JargonHit[];
  /** Top N most-difficult sentences (by FKGL desc), capped at 5. */
  worst_sentences: SentenceScore[];
  /** User-supplied or default target grade level (e.g., 8). */
  target_grade_level: number;
  /**
   * Overall verdict:
   *   pass       — FKGL ≤ target AND <20% sentences exceed target
   *   borderline — FKGL within 1.5 grades of target OR 20-40% exceed
   *   fail       — FKGL > target+1.5 OR >40% sentences exceed
   */
  verdict: Verdict;
  /**
   * Concrete rewrite suggestions. Empty array when verdict is "pass".
   * Pre-baked + populated from worst_sentences and jargon hits.
   */
  recommendations: string[];
  /** Tool ruleset / dictionary version. Bump on jargon-list changes. */
  icf_ruleset: "2026-05";
}

export interface IcfReadabilityCheckInput {
  /** The ICF text. May be a single string or pre-split paragraphs. */
  icf_text: string;
  /** Default 8 (FDA / NIH guidance target). Range 4-12. */
  target_grade_level?: number;
  /** Default true. Set false for a pure-readability run without dictionary lookup. */
  jargon_check?: boolean;
}

export const ICF_RULESET = "2026-05" as const;
