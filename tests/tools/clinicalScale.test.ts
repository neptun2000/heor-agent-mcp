/**
 * Tests for evidence.clinical_scale — neurology & cognitive outcome scale scoring.
 *
 * Design log #19. Covers:
 *   - UMSARS, UPDRS, MDS-UPDRS, ADAS-Cog, MoCA, MMSE scoring
 *   - MCID-based responder classification
 *   - Trajectory comparison vs reference cohorts
 *   - HTA/regulatory notes
 *   - Partial/complete item handling
 */

import {
  evidenceClinicalScaleHandler,
  type EvidenceClinicalScaleParams,
} from "../../src/tools/evidenceClinicalScale.js";

// Helper: build n items all at a given score for a part
function items(
  part: string,
  count: number,
  scorePerItem: number,
): Array<{ part: string; item_id: string; score: number }> {
  return Array.from({ length: count }, (_, i) => ({
    part,
    item_id: String(i + 1),
    score: scorePerItem,
  }));
}

// ── 1. UMSARS Part I+II scoring ────────────────────────────────────────────
test("UMSARS Part I (12 items × 4) + Part II (14 items × 4) sum correctly", async () => {
  // All items at score 2 → Part I: 12×2=24, Part II: 14×2=28, total = 52
  const params: EvidenceClinicalScaleParams = {
    scale: "umsars",
    items: [...items("I", 12, 2), ...items("II", 14, 2)],
    compare_cohort: "none",
  };
  const result = await evidenceClinicalScaleHandler(params);
  expect(result).toContain("**52** / 104");
});

// ── 2. UMSARS Part IV is NOT summed into total ─────────────────────────────
test("UMSARS Part IV global disability score is shown separately, not in total", async () => {
  const params: EvidenceClinicalScaleParams = {
    scale: "umsars",
    items: [
      ...items("I", 12, 1),
      ...items("II", 14, 1),
      { part: "IV", item_id: "1", score: 3 },
    ],
    compare_cohort: "none",
  };
  const result = await evidenceClinicalScaleHandler(params);
  // Total should be 12 + 14 = 26, not 29
  expect(result).toContain("**26** / 104");
  // Part IV row should appear in breakdown
  expect(result).toContain("IV");
});

// ── 3. UPDRS total across 4 parts ─────────────────────────────────────────
test("UPDRS total across all 4 parts: I(4×4) + II(13×4) + III(14×4) + IV(11×4) = 168", async () => {
  const params: EvidenceClinicalScaleParams = {
    scale: "updrs",
    items: [
      ...items("I", 4, 4),
      ...items("II", 13, 4),
      ...items("III", 14, 4),
      ...items("IV", 11, 4),
    ],
    compare_cohort: "none",
  };
  const result = await evidenceClinicalScaleHandler(params);
  expect(result).toContain("**168** / 168");
});

// ── 4. MDS-UPDRS Part III extracted correctly ──────────────────────────────
test("MDS-UPDRS Part III score (18 items × 3 = 54) appears in breakdown", async () => {
  const params: EvidenceClinicalScaleParams = {
    scale: "mds_updrs",
    items: items("III", 18, 3),
    compare_cohort: "none",
  };
  const result = await evidenceClinicalScaleHandler(params);
  // Part III max is 18×4=72; score is 54
  expect(result).toMatch(/III.*54.*72/);
});

// ── 5. ADAS-Cog total (higher = worse) ────────────────────────────────────
test("ADAS-Cog 11 cognitive items at score 5 = total 55 / 70", async () => {
  const params: EvidenceClinicalScaleParams = {
    scale: "adas_cog",
    // Note: ADAS-Cog part is named "cognitive" internally
    items: items("cognitive", 11, 5),
    compare_cohort: "none",
  };
  const result = await evidenceClinicalScaleHandler(params);
  expect(result).toContain("**55** / 70");
});

// ── 6. MoCA cutoffs ────────────────────────────────────────────────────────
test("MoCA score 28 is classified as Normal cognition", async () => {
  const params: EvidenceClinicalScaleParams = {
    scale: "moca",
    // 28 points: distribute across 12 items using part "total"
    items: [
      ...items("total", 9, 3), // 9×3=27
      { part: "total", item_id: "10", score: 1 }, // +1 = 28
      { part: "total", item_id: "11", score: 0 },
      { part: "total", item_id: "12", score: 0 },
    ],
    compare_cohort: "none",
  };
  const result = await evidenceClinicalScaleHandler(params);
  expect(result).toContain("Normal cognition");
});

test("MoCA score 22 is classified as Mild cognitive impairment (not Normal)", async () => {
  const params: EvidenceClinicalScaleParams = {
    scale: "moca",
    items: [
      ...items("total", 11, 2), // 11×2=22
      { part: "total", item_id: "12", score: 0 },
    ],
    compare_cohort: "none",
  };
  const result = await evidenceClinicalScaleHandler(params);
  expect(result).toContain("Mild cognitive impairment");
  expect(result).not.toContain("Normal cognition");
});

// ── 7. MMSE cutoffs ────────────────────────────────────────────────────────
test("MMSE score 26 is classified as Normal cognition", async () => {
  const params: EvidenceClinicalScaleParams = {
    scale: "mmse",
    // MMSE max = 30; use part "total", 19 items, maxPerItem varies
    // Simplest: put 26 points across items using score ≤5
    items: [
      ...items("total", 5, 5), // 25
      { part: "total", item_id: "6", score: 1 }, // 26
      ...Array.from({ length: 13 }, (_, i) => ({
        part: "total",
        item_id: String(i + 7),
        score: 0,
      })),
    ],
    compare_cohort: "none",
  };
  const result = await evidenceClinicalScaleHandler(params);
  expect(result).toContain("Normal cognition");
});

test("MMSE score 16 is classified as Moderate impairment", async () => {
  const params: EvidenceClinicalScaleParams = {
    scale: "mmse",
    items: [
      ...items("total", 3, 5), // 15
      { part: "total", item_id: "4", score: 1 }, // 16
      ...Array.from({ length: 15 }, (_, i) => ({
        part: "total",
        item_id: String(i + 5),
        score: 0,
      })),
    ],
    compare_cohort: "none",
  };
  const result = await evidenceClinicalScaleHandler(params);
  expect(result).toContain("Moderate impairment");
});

// ── 8. Responder classification: UMSARS change -5 → "responder" (MCID=4) ──
test("UMSARS change of -5 points from baseline is classified as RESPONDER", async () => {
  const baselineItems = [...items("I", 12, 2), ...items("II", 14, 2)]; // total=52
  const followupItems = [...items("I", 12, 1), ...items("II", 14, 1)]; // total=26, change=-26 — well below MCID
  // Use just Part I for simplicity: baseline 12×2=24, followup 12×1=12, change=-12
  const baseline = items("I", 12, 2); // 24
  const followup = items("I", 12, 1); // 12, change = -12, > MCID=4
  const params: EvidenceClinicalScaleParams = {
    scale: "umsars",
    items: followup,
    baseline_items: baseline,
    compare_cohort: "none",
  };
  const result = await evidenceClinicalScaleHandler(params);
  expect(result).toContain("RESPONDER");
});

// ── 9. Stable classification: UMSARS change -1 → "stable" ─────────────────
test("UMSARS change of -1 point is classified as STABLE", async () => {
  // baseline: Part I all at 2 = 24; followup: first item at 1, rest at 2 = 23, change=-1
  const baseline = items("I", 12, 2); // 24
  const followup = [
    { part: "I", item_id: "1", score: 1 },
    ...items("I", 11, 2).map((it) => ({
      ...it,
      item_id: String(Number(it.item_id) + 1),
    })),
  ]; // 23
  const params: EvidenceClinicalScaleParams = {
    scale: "umsars",
    items: followup,
    baseline_items: baseline,
    compare_cohort: "none",
  };
  const result = await evidenceClinicalScaleHandler(params);
  expect(result).toContain("STABLE");
});

// ── 10. Progressor classification: MMSE change -4 → "progressor" (MCID=3) ─
test("MMSE decrease of 4 points from baseline is classified as PROGRESSOR", async () => {
  // baseline: 20 pts; followup: 16 pts; change = -4, MCID=3 → progressor
  const mkMmse = (score: number) => {
    // Distribute `score` points across 19 items, capped at 5 each
    const result: Array<{ part: string; item_id: string; score: number }> = [];
    let remaining = score;
    for (let i = 1; i <= 19; i++) {
      const s = Math.min(remaining, 5);
      result.push({ part: "total", item_id: String(i), score: s });
      remaining = Math.max(0, remaining - 5);
    }
    return result;
  };
  const params: EvidenceClinicalScaleParams = {
    scale: "mmse",
    items: mkMmse(16),
    baseline_items: mkMmse(20),
    compare_cohort: "none",
  };
  const result = await evidenceClinicalScaleHandler(params);
  expect(result).toContain("PROGRESSOR");
});

// ── 11. NNIPPS trajectory comparison includes "NNIPPS" ────────────────────
test("NNIPPS trajectory comparison output includes NNIPPS reference", async () => {
  const baseline = [...items("I", 12, 1), ...items("II", 14, 1)]; // 26
  const followup = [...items("I", 12, 3), ...items("II", 14, 3)]; // 78, change=+52 over 12 months
  const params: EvidenceClinicalScaleParams = {
    scale: "umsars",
    items: followup,
    baseline_items: baseline,
    compare_cohort: "nnipps",
    time_point_months: 12,
  };
  const result = await evidenceClinicalScaleHandler(params);
  expect(result).toContain("NNIPPS");
});

// ── 12. MSA HTA note mentions "2028" ──────────────────────────────────────
test("UMSARS output HTA notes mention JCA Phase 2 scope date 2028", async () => {
  const params: EvidenceClinicalScaleParams = {
    scale: "umsars",
    items: items("I", 12, 1),
    compare_cohort: "none",
  };
  const result = await evidenceClinicalScaleHandler(params);
  expect(result).toContain("2028");
});

// ── 13. Handler returns a string containing the scale name ────────────────
test("Handler returns a string containing the scale full name", async () => {
  const params: EvidenceClinicalScaleParams = {
    scale: "mds_updrs",
    items: items("III", 5, 2),
    compare_cohort: "none",
  };
  const result = await evidenceClinicalScaleHandler(params);
  expect(typeof result).toBe("string");
  expect(result).toContain("Movement Disorder Society");
});

// ── 14. Partial items produce isComplete=false and list missing items ──────
test("Partial items (only 2 of 12 UMSARS-I items) produces partial note and missing items", async () => {
  const params: EvidenceClinicalScaleParams = {
    scale: "umsars",
    items: [
      { part: "I", item_id: "1", score: 2 },
      { part: "I", item_id: "2", score: 2 },
    ],
    compare_cohort: "none",
  };
  const result = await evidenceClinicalScaleHandler(params);
  expect(result).toContain("Partial");
  // Missing items I-3 through I-12 should be mentioned
  expect(result).toContain("I-3");
});

// ── 15. MoCA MCID uncertainty note fires when responder analysis is run ───
test("MoCA responder analysis includes MCID uncertainty note", async () => {
  const params: EvidenceClinicalScaleParams = {
    scale: "moca",
    items: items("total", 12, 2), // 24
    baseline_items: items("total", 12, 1), // 12, change = +12 → responder
    compare_cohort: "none",
  };
  const result = await evidenceClinicalScaleHandler(params);
  expect(result).toContain("No formal MCID established for MoCA");
});
