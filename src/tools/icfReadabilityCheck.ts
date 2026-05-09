/**
 * icf_readability_check — Informed Consent Form readability analyzer.
 *
 * Paired with irb_review per design log #21 (v2 deferral, now shipped).
 * Takes ICF text, returns Flesch-Kincaid + Flesch Reading Ease + Gunning
 * Fog + SMOG readability scores, per-sentence breakdown identifying the
 * worst offenders, medical-jargon detection with plain-language
 * alternatives, and a pass/borderline/fail verdict against a target
 * grade level (default 8th grade per FDA / NIH guidance).
 *
 * Pure logic, <300ms, no I/O.
 */
import { z } from "zod";
import {
  addAssumption,
  addWarning,
  createAuditRecord,
  setMethodology,
} from "../audit/builder.js";
import { auditToMarkdown } from "../formatters/markdown.js";
import {
  computeReadabilityScores,
  computeStats,
  fleschKincaidGrade,
} from "../icf/readability.js";
import { findJargon } from "../icf/jargon.js";
import {
  ICF_RULESET,
  type IcfReadabilityAssessment,
  type SentenceScore,
  type Verdict,
} from "../icf/types.js";
import type { ToolResult } from "../providers/types.js";

export type { IcfReadabilityAssessment } from "../icf/types.js";

const IcfReadabilityCheckSchema = z
  .object({
    icf_text: z.string().min(1, "icf_text is required (paste the ICF body)"),
    target_grade_level: z.number().int().min(4).max(12).default(8),
    jargon_check: z.boolean().default(true),
  })
  .strict();

function computeVerdict(
  fkGrade: number,
  exceedingFraction: number,
  target: number,
): Verdict {
  // FKGL within target → pass requires also <20% sentences exceeding target.
  if (fkGrade <= target && exceedingFraction < 0.2) return "pass";
  if (fkGrade <= target + 1.5 && exceedingFraction < 0.4) return "borderline";
  return "fail";
}

export async function handleIcfReadabilityCheck(
  rawInput: unknown,
): Promise<ToolResult> {
  const parsed = IcfReadabilityCheckSchema.safeParse(rawInput);
  if (!parsed.success) {
    const messages = parsed.error.issues.map(
      (i) => `${i.path.join(".") || "input"}: ${i.message}`,
    );
    throw new Error(messages.join("\n"));
  }
  const input = parsed.data;

  const { stats, sentenceTokens } = computeStats(input.icf_text);
  const scores = computeReadabilityScores(stats);

  const sentences: SentenceScore[] = sentenceTokens.map((t, idx) => {
    const words = t.words.length;
    const fkPerSentence =
      words > 0 && stats.total_sentences > 0
        ? fleschKincaidGrade({
            ...stats,
            total_sentences: 1,
            total_words: words,
            total_syllables: t.syllables,
            avg_sentence_length: words,
            avg_syllables_per_word: t.syllables / words,
            complex_words: t.complex,
          })
        : 0;
    return {
      index: idx,
      text: t.raw,
      word_count: words,
      syllable_count: t.syllables,
      flesch_kincaid_grade: Math.round(fkPerSentence * 10) / 10,
      exceeds_target: fkPerSentence > input.target_grade_level,
    };
  });

  const exceedingCount = sentences.filter((s) => s.exceeds_target).length;
  const exceedingFraction =
    sentences.length > 0 ? exceedingCount / sentences.length : 0;

  // v1.9.1 fix: pre-fix `worstSentences` was top-5 by FKGL regardless
  // of whether they exceeded target — programmatic consumers reading
  // this field could see "worst" sentences that were actually within
  // target. Now: only sentences that exceed target. Markdown rendering
  // already conditionally hid the section; this aligns the JSON output
  // semantics with the markdown.
  const worstSentences = [...sentences]
    .filter((s) => s.exceeds_target)
    .sort((a, b) => b.flesch_kincaid_grade - a.flesch_kincaid_grade)
    .slice(0, 5);

  const jargon = input.jargon_check ? findJargon(input.icf_text) : [];

  const verdict = computeVerdict(
    scores.flesch_kincaid_grade,
    exceedingFraction,
    input.target_grade_level,
  );

  const recommendations: string[] = [];
  if (verdict !== "pass") {
    if (worstSentences.length > 0) {
      recommendations.push(
        `Rewrite the ${worstSentences.length} highest-grade sentences (FKGL ${worstSentences[0].flesch_kincaid_grade.toFixed(1)} down to ${worstSentences[worstSentences.length - 1].flesch_kincaid_grade.toFixed(1)}). Targeting these alone usually pulls the document into the target band.`,
      );
    }
    if (stats.avg_sentence_length > 20) {
      recommendations.push(
        `Sentences average ${stats.avg_sentence_length.toFixed(1)} words — break compound sentences (target ≤15 words/sentence for 8th-grade reading).`,
      );
    }
    if (stats.avg_syllables_per_word > 1.7) {
      recommendations.push(
        `Words average ${stats.avg_syllables_per_word.toFixed(2)} syllables — favor short Anglo-Saxon roots over Latinate technical terms (e.g., "use" not "utilise", "show" not "demonstrate").`,
      );
    }
  }
  // v1.9.1 fix: jargon rec previously only fired at jargon.length≥3
  // AND verdict≠pass. Both gates removed: 1-2 jargon hits are exactly
  // the high-frequency, high-impact terms patients struggle with most;
  // a passing FKGL with 5 jargon terms still needs those rewrites.
  if (jargon.length >= 1) {
    recommendations.push(
      `Replace medical jargon: ${jargon
        .slice(0, 5)
        .map((j) => `"${j.term}" → "${j.plain_language}"`)
        .join(
          "; ",
        )}${jargon.length > 5 ? ` (+${jargon.length - 5} more)` : ""}.`,
    );
  }

  const assessment: IcfReadabilityAssessment = {
    scores,
    stats,
    sentences,
    jargon,
    worst_sentences: worstSentences,
    target_grade_level: input.target_grade_level,
    verdict,
    recommendations,
    icf_ruleset: ICF_RULESET,
  };

  let audit = createAuditRecord(
    "icf.readability_check",
    input as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "Flesch-Kincaid Grade Level (Kincaid et al. 1975); Flesch Reading Ease (Flesch 1948); Gunning Fog Index (Gunning 1952); SMOG Grade (McLaughlin 1969). Syllable counter is heuristic vowel-group ±1 of CMU dict. Jargon dictionary curated from NIH Plain Language ICF guidance + FDA Communicating Risks and Benefits + IRB consent-form audits.",
  );
  audit = addAssumption(
    audit,
    `target_grade_level=${input.target_grade_level}; ${stats.total_sentences} sentence${stats.total_sentences === 1 ? "" : "s"}, ${stats.total_words} words, ${stats.total_syllables} syllables.`,
  );
  if (stats.total_sentences < 30) {
    audit = addWarning(
      audit,
      `Document has only ${stats.total_sentences} sentences. SMOG was designed for ≥30 sentences and is unreliable below that; FKGL/FRE/Fog are more reliable on short text.`,
    );
  }

  // Markdown report
  const lines: string[] = [];
  lines.push(`# ICF Readability Check`);
  lines.push("");
  lines.push(
    `**Verdict:** \`${verdict}\` against target grade ${input.target_grade_level}`,
  );
  lines.push("");
  lines.push("## Readability Scores");
  lines.push("");
  lines.push("| Metric | Value | Reference |");
  lines.push("|---|---|---|");
  lines.push(
    `| Flesch-Kincaid Grade | **${scores.flesch_kincaid_grade.toFixed(1)}** | target ≤ ${input.target_grade_level} |`,
  );
  lines.push(
    `| Flesch Reading Ease | ${scores.flesch_reading_ease.toFixed(1)} | 60-70 = plain English (≥60 target) |`,
  );
  lines.push(
    `| Gunning Fog | ${scores.gunning_fog.toFixed(1)} | <12 = readable |`,
  );
  lines.push(
    `| SMOG Grade | ${scores.smog.toFixed(1)} | most reliable for ≥30 sentences |`,
  );
  lines.push("");

  lines.push("## Document Stats");
  lines.push(
    `- ${stats.total_sentences} sentences, ${stats.total_words} words (avg ${stats.avg_sentence_length.toFixed(1)} words/sentence)`,
  );
  lines.push(
    `- ${stats.total_syllables} syllables (avg ${stats.avg_syllables_per_word.toFixed(2)} syllables/word)`,
  );
  lines.push(
    `- ${stats.complex_words} complex words (${((stats.complex_words / Math.max(1, stats.total_words)) * 100).toFixed(1)}% of words)`,
  );
  lines.push(
    `- ${exceedingCount} sentences exceed target grade ${input.target_grade_level} (${(exceedingFraction * 100).toFixed(0)}%)`,
  );
  lines.push("");

  if (worstSentences.length > 0 && worstSentences[0].exceeds_target) {
    lines.push("## Worst Sentences (FKGL desc)");
    for (const s of worstSentences) {
      if (!s.exceeds_target) break;
      const truncated =
        s.text.length > 220 ? s.text.slice(0, 217) + "..." : s.text;
      lines.push(
        `- **FKGL ${s.flesch_kincaid_grade.toFixed(1)}** — ${truncated}`,
      );
    }
    lines.push("");
  }

  if (jargon.length > 0) {
    lines.push(`## Medical Jargon Detected (${jargon.length} terms)`);
    lines.push("");
    lines.push("| Term | Plain language | Hits |");
    lines.push("|---|---|---|");
    for (const j of jargon.slice(0, 20)) {
      lines.push(
        `| \`${j.term}\` | ${j.plain_language} | ${j.occurrences.length}${j.occurrences.length >= 5 ? "+" : ""} |`,
      );
    }
    if (jargon.length > 20) {
      lines.push(`| ... | ${jargon.length - 20} more terms | |`);
    }
    lines.push("");
  }

  if (recommendations.length > 0) {
    lines.push("## Recommendations");
    for (const r of recommendations) lines.push(`- ${r}`);
    lines.push("");
  } else if (verdict === "pass") {
    lines.push("✅ Readability is within target. No rewrite recommendations.");
    lines.push("");
  }

  lines.push("## References");
  lines.push("- Kincaid JP et al. (1975). Research Branch Report 8-75.");
  lines.push("- Flesch R. (1948). J Appl Psychol 32(3):221-233.");
  lines.push("- Gunning R. (1952). The Technique of Clear Writing.");
  lines.push("- McLaughlin GH. (1969). J Reading 12(8):639-646.");
  lines.push("- NIH Plain Language Guidelines (clinical-trial consent).");
  lines.push("- FDA Communicating Risks and Benefits (2011).");
  lines.push("");
  lines.push(auditToMarkdown(audit));

  return {
    content: lines.join("\n"),
    audit,
    icf_assessment: assessment,
  } as ToolResult & { icf_assessment: IcfReadabilityAssessment };
}

export const icfReadabilityCheckToolSchema = {
  name: "icf.readability_check",
  description:
    "Score the readability of an Informed Consent Form (ICF) text. Returns Flesch-Kincaid Grade Level, Flesch Reading Ease, Gunning Fog Index, SMOG Grade, plus per-sentence breakdown identifying the worst offenders, medical-jargon detection with plain-language alternatives, and a pass/borderline/fail verdict vs a target grade level (default 8 per FDA / NIH guidance). Pairs with irb_review when planning a study — investigators paste the ICF draft, get back a concrete rewrite list. Pure logic, no external API.",
  annotations: {
    title: "ICF Readability Check",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      icf_text: {
        type: "string",
        description: "The ICF body text. Plain text or markdown both work.",
      },
      target_grade_level: {
        type: "integer",
        minimum: 4,
        maximum: 12,
        default: 8,
        description:
          "Target US grade level for FKGL pass verdict. FDA/NIH typically 8; some IRBs use 6 (stricter).",
      },
      jargon_check: {
        type: "boolean",
        default: true,
        description:
          "Whether to run the medical-jargon dictionary lookup. Default true.",
      },
    },
    required: ["icf_text"],
  },
};
