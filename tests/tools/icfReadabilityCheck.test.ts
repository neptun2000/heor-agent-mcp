/**
 * Tests for icf_readability_check.
 *
 * Covers: schema validation, FKGL/FRE/Fog/SMOG formula correctness on
 * known reference texts, per-sentence breakdown, jargon detection,
 * pass/borderline/fail verdict, output structure, performance.
 */
import {
  handleIcfReadabilityCheck,
  type IcfReadabilityAssessment,
} from "../../src/tools/icfReadabilityCheck.js";
import { countSyllables } from "../../src/icf/syllables.js";
import {
  splitSentences,
  tokenizeWords,
  computeStats,
  fleschKincaidGrade,
  fleschReadingEase,
} from "../../src/icf/readability.js";
import { findJargon } from "../../src/icf/jargon.js";

interface IcfResult {
  content: string;
  icf_assessment: IcfReadabilityAssessment;
}

async function check(
  input: Record<string, unknown>,
): Promise<IcfResult> {
  return (await handleIcfReadabilityCheck(input)) as unknown as IcfResult;
}

// ---- Schema validation -------------------------------------------------

describe("icf_readability_check — schema validation", () => {
  it("requires icf_text", async () => {
    await expect(handleIcfReadabilityCheck({})).rejects.toThrow(/icf_text/i);
  });

  it("rejects target_grade_level outside [4, 12]", async () => {
    await expect(
      check({ icf_text: "Hi.", target_grade_level: 2 }),
    ).rejects.toThrow();
    await expect(
      check({ icf_text: "Hi.", target_grade_level: 20 }),
    ).rejects.toThrow();
  });

  it("accepts the minimal valid input", async () => {
    const r = await check({ icf_text: "This is a short text." });
    expect(r.icf_assessment.scores).toBeDefined();
    expect(r.icf_assessment.icf_ruleset).toBe("2026-05");
  });
});

// ---- Syllable counting -------------------------------------------------

describe("countSyllables — heuristic ±1 of CMU dict", () => {
  it("counts simple monosyllables", () => {
    expect(countSyllables("the")).toBe(1);
    expect(countSyllables("cat")).toBe(1);
    expect(countSyllables("dog")).toBe(1);
  });

  it("counts common multi-syllable words", () => {
    // "table" — silent e, "-le" rule applies → 2
    expect(countSyllables("table")).toBe(2);
    expect(countSyllables("simple")).toBe(2);
    // "doctor" → 2
    expect(countSyllables("doctor")).toBe(2);
    // "pharmacy" → 3 (phar-ma-cy)
    expect(countSyllables("pharmacy")).toBe(3);
  });

  it("counts -ed past tense as silent when appropriate", () => {
    expect(countSyllables("walked")).toBe(1);
    expect(countSyllables("jumped")).toBe(1);
    // "added" — d before e → keep -ed syllable
    expect(countSyllables("added")).toBe(2);
  });

  it("never returns less than 1 for non-empty word", () => {
    expect(countSyllables("a")).toBe(1);
    expect(countSyllables("I")).toBe(1);
  });

  it("handles empty / non-alpha gracefully", () => {
    expect(countSyllables("")).toBe(0);
    expect(countSyllables("123")).toBe(0);
    expect(countSyllables("...")).toBe(0);
  });
});

// ---- Sentence splitting ------------------------------------------------

describe("splitSentences — handles abbreviations", () => {
  it("splits simple sentences", () => {
    const out = splitSentences(
      "The doctor will see you. You may feel pain. Tell us if you do.",
    );
    expect(out.length).toBe(3);
  });

  it("does not split on common abbreviations", () => {
    const out = splitSentences("Dr. Smith will see you. Then go home.");
    expect(out.length).toBe(2);
  });

  it("handles question marks and exclamations", () => {
    const out = splitSentences("Are you ready? Yes! Then we begin.");
    expect(out.length).toBe(3);
  });

  it("returns empty array on empty / whitespace-only input", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   ")).toEqual([]);
  });
});

// ---- Word tokenization -------------------------------------------------

describe("tokenizeWords", () => {
  it("strips punctuation but keeps hyphens and apostrophes", () => {
    const words = tokenizeWords("Don't worry — it's well-known.");
    expect(words).toContain("Don't");
    expect(words).toContain("well-known");
  });
});

// ---- FKGL / FRE formulas — reference checks ----------------------------

describe("Flesch-Kincaid Grade Level — formula correctness", () => {
  it("produces low FKGL on simple text (≤ 6th grade)", async () => {
    const r = await check({
      icf_text:
        "The dog is brown. The cat is small. They like to play. We feed them every day. They are good pets.",
    });
    expect(r.icf_assessment.scores.flesch_kincaid_grade).toBeLessThanOrEqual(6);
  });

  it("produces high FKGL on complex medical text (≥ 12th grade)", async () => {
    const r = await check({
      icf_text:
        "Pharmacokinetic evaluation of the investigational compound demonstrated bioavailability characteristics consistent with previously characterized phenotypic subpopulations. Pharmacodynamic responses, including biomarker concentrations and downstream metabolite profiles, exhibited dose-dependent variability across the heterogeneous comorbidity-stratified cohort. Concomitant medication interactions were systematically evaluated through comprehensive bioequivalence assessment.",
    });
    expect(r.icf_assessment.scores.flesch_kincaid_grade).toBeGreaterThanOrEqual(
      12,
    );
  });

  it("FRE inversely correlates with FKGL (sanity check)", async () => {
    const easy = await check({
      icf_text: "We will help you. You can leave at any time.",
    });
    const hard = await check({
      icf_text:
        "Pharmacokinetic evaluation of the investigational compound demonstrated bioavailability characteristics consistent with previously characterized phenotypic subpopulations.",
    });
    expect(easy.icf_assessment.scores.flesch_reading_ease).toBeGreaterThan(
      hard.icf_assessment.scores.flesch_reading_ease,
    );
  });
});

// ---- Per-sentence breakdown --------------------------------------------

describe("per-sentence breakdown", () => {
  it("identifies the worst sentence in mixed text", async () => {
    const r = await check({
      icf_text:
        "We will help you. Pharmacokinetic evaluation of the investigational compound demonstrated bioavailability characteristics inconsistent with previously characterized phenotypic subpopulations across the heterogeneous comorbidity-stratified cohort. Tell us if you have problems.",
      target_grade_level: 8,
    });
    expect(r.icf_assessment.worst_sentences.length).toBeGreaterThan(0);
    expect(r.icf_assessment.worst_sentences[0].text).toMatch(
      /Pharmacokinetic/,
    );
    expect(r.icf_assessment.worst_sentences[0].exceeds_target).toBe(true);
  });

  it("produces sentence array sorted by FKGL desc in worst_sentences", async () => {
    const r = await check({
      icf_text:
        "We will help you. The pharmacokinetic profile is variable. Bioavailability characteristics demonstrate concomitant comorbidity-related heterogeneity.",
    });
    const grades = r.icf_assessment.worst_sentences.map(
      (s) => s.flesch_kincaid_grade,
    );
    for (let i = 0; i < grades.length - 1; i++) {
      expect(grades[i]).toBeGreaterThanOrEqual(grades[i + 1]);
    }
  });
});

// ---- Jargon detection --------------------------------------------------

describe("jargon detection — case-insensitive whole-word matching", () => {
  it("finds known jargon terms", async () => {
    const r = await check({
      icf_text:
        "You will be randomized to receive either the study drug or placebo. The doctor will monitor for adverse events.",
    });
    const terms = r.icf_assessment.jargon.map((j) => j.term);
    expect(terms).toContain("randomized");
    expect(terms).toContain("placebo");
    expect(terms).toContain("adverse event");
  });

  it("returns plain-language alternatives", async () => {
    const r = await check({ icf_text: "Subjects will undergo randomization." });
    const _ = r;
    // Direct test on findJargon for cleaner assertion:
    const hits = findJargon("You will be randomized to a placebo arm.");
    const randomized = hits.find((h) => h.term === "randomized");
    expect(randomized?.plain_language).toMatch(/assigned by chance/i);
  });

  it("matches case-insensitively", () => {
    const hits = findJargon(
      "PLACEBO administration. Adverse Event monitoring. Pharmacokinetics evaluation.",
    );
    expect(hits.find((h) => h.term === "placebo")).toBeDefined();
    expect(hits.find((h) => h.term === "adverse event")).toBeDefined();
    expect(hits.find((h) => h.term === "pharmacokinetics")).toBeDefined();
  });

  it("respects whole-word boundaries", () => {
    // "armchair" should not match "arm"
    const hits = findJargon("Please sit in the armchair.");
    expect(hits.find((h) => h.term === "arm")).toBeUndefined();
  });

  it("can be disabled via jargon_check=false", async () => {
    const r = await check({
      icf_text: "You will be randomized to placebo with adverse events.",
      jargon_check: false,
    });
    expect(r.icf_assessment.jargon).toEqual([]);
  });

  it("caps occurrences at 5 per term to keep output compact", () => {
    const text = ("placebo. ".repeat(20)).trim();
    const hits = findJargon(text);
    const placebo = hits.find((h) => h.term === "placebo");
    expect(placebo?.occurrences.length).toBeLessThanOrEqual(5);
  });
});

// ---- Verdict logic -----------------------------------------------------

describe("verdict — pass / borderline / fail", () => {
  it("returns 'pass' for short, simple text at default target", async () => {
    const r = await check({
      icf_text:
        "The dog is brown. The cat is small. They like to play. We feed them every day.",
    });
    expect(r.icf_assessment.verdict).toBe("pass");
  });

  it("returns 'fail' for highly technical text", async () => {
    const r = await check({
      icf_text:
        "Pharmacokinetic evaluation of the investigational compound demonstrated bioavailability characteristics consistent with previously characterized phenotypic subpopulations stratified by comorbid renal impairment. Pharmacodynamic biomarker analysis revealed concomitant interaction pathways.",
      target_grade_level: 8,
    });
    expect(r.icf_assessment.verdict).toBe("fail");
  });

  it("emits recommendations when verdict is not pass", async () => {
    const r = await check({
      icf_text:
        "Pharmacokinetic evaluation of the investigational compound demonstrated bioavailability characteristics inconsistent with previously characterized phenotypic subpopulations stratified by comorbid renal impairment.",
      target_grade_level: 8,
    });
    expect(r.icf_assessment.recommendations.length).toBeGreaterThan(0);
  });

  it("emits no rewrite recommendations on pass verdict", async () => {
    const r = await check({
      icf_text: "We will help you. You can leave at any time.",
    });
    if (r.icf_assessment.verdict === "pass") {
      expect(r.icf_assessment.recommendations.length).toBe(0);
    }
  });
});

// ---- Output structure --------------------------------------------------

describe("output structure", () => {
  it("markdown report includes all expected sections", async () => {
    const r = await check({
      icf_text:
        "We will randomize you to placebo or active treatment. Pharmacokinetic monitoring will be performed.",
    });
    expect(r.content).toMatch(/# ICF Readability Check/);
    expect(r.content).toMatch(/## Readability Scores/);
    expect(r.content).toMatch(/## Document Stats/);
    expect(r.content).toMatch(/Medical Jargon Detected/);
    expect(r.content).toMatch(/## References/);
  });

  it("Verdict line surfaces 'pass' / 'borderline' / 'fail'", async () => {
    const r = await check({
      icf_text:
        "Pharmacokinetic evaluation of the investigational compound demonstrated bioavailability characteristics inconsistent with previously characterized phenotypic subpopulations.",
    });
    expect(r.content).toMatch(/Verdict.*(pass|borderline|fail)/);
  });

  it("emits SMOG-unreliable warning for short documents (<30 sentences)", async () => {
    const r = await check({ icf_text: "Short. Text. Here." });
    expect(
      r.icf_assessment.scores.smog,
    ).toBeDefined();
    // The warning lives in the audit; assertion via markdown 'Warnings' section:
    expect(r.content).toMatch(/SMOG.*30 sentences|reliable/i);
  });
});

// ---- Performance --------------------------------------------------------

describe("performance", () => {
  it("runs <300ms on a 50-sentence representative ICF", async () => {
    const sentences: string[] = [];
    for (let i = 0; i < 50; i++) {
      sentences.push(
        `Sentence ${i} describes the study procedures and risks in plain language.`,
      );
    }
    const start = Date.now();
    await check({ icf_text: sentences.join(" ") });
    expect(Date.now() - start).toBeLessThan(300);
  });
});

// ---- Direct utility tests (computeStats / formulas) --------------------

describe("computeStats / formulas — direct tests", () => {
  it("computeStats returns coherent counts", () => {
    const { stats } = computeStats(
      "The cat sat. The dog ran. They were happy.",
    );
    expect(stats.total_sentences).toBe(3);
    expect(stats.total_words).toBeGreaterThan(0);
    expect(stats.avg_sentence_length).toBeCloseTo(
      stats.total_words / stats.total_sentences,
      5,
    );
  });

  it("FKGL is 0 when there are no words", () => {
    const empty = computeStats("");
    expect(fleschKincaidGrade(empty.stats)).toBe(0);
    expect(fleschReadingEase(empty.stats)).toBe(0);
  });
});
