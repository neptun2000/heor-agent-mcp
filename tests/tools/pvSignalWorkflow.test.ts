/**
 * Tests for pv_signal_workflow — EMA GVP Module IX rev 2 signal management.
 *
 * Compute PRR / ROR / IC / MGPS disproportionality statistics from
 * user-supplied case counts, decide signal verdict, and emit canonical
 * RMP signal-section text. Pure logic, no I/O.
 *
 * See design log #14.
 */
import { handlePvSignalWorkflow } from "../../src/tools/pvSignalWorkflow.js";

interface SignalAssessment {
  drug: string;
  period_months: number;
  statistics: {
    prr: {
      value: number;
      ci_low: number;
      ci_high: number;
      threshold_met: boolean;
    };
    ror: {
      value: number;
      ci_low: number;
      ci_high: number;
      threshold_met: boolean;
    };
    ic: { value: number; ic025: number; threshold_met: boolean };
    mgps: { ebgm: number; eb05: number; eb95: number; threshold_met: boolean };
    chi_squared: number;
    n_cases: number;
  };
  verdict:
    | "no_signal"
    | "strengthening_signal"
    | "confirmed_signal"
    | "previously_known_signal"
    | "refuted_signal";
  workflow_recommendation: string[];
  rmp_signal_section_text: string;
  pregnancy_followup?: {
    timepoints: string[];
    followup_protocol_ref: string;
    structured_data_required: string[];
  };
  gvp_revision: "rev_4";
}

interface SignalResult {
  content: string;
  signal_assessment: SignalAssessment;
}

async function run(input: Record<string, unknown>): Promise<SignalResult> {
  return (await handlePvSignalWorkflow(input)) as unknown as SignalResult;
}

// ---- Schema validation -------------------------------------------------

describe("pv_signal_workflow — schema validation", () => {
  it("requires drug, indication, case_counts", async () => {
    await expect(handlePvSignalWorkflow({})).rejects.toThrow(
      /required|drug|indication|case_counts/i,
    );
  });

  it("rejects negative case counts", async () => {
    await expect(
      run({
        drug: "x",
        indication: "y",
        case_counts: {
          drug_event: -1,
          drug_total: 100,
          event_total: 50,
          grand_total: 1000,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects unknown data_source with did-you-mean", async () => {
    await expect(
      run({
        drug: "x",
        indication: "y",
        case_counts: {
          drug_event: 5,
          drug_total: 100,
          event_total: 50,
          grand_total: 1000,
        },
        data_source: "vigibase" as never,
      }),
    ).rejects.toThrow(/eudravigilance|faers|vigibase_who/);
  });
});

// ---- Statistics math (against published vectors) -----------------------

describe("pv_signal_workflow — PRR/ROR/IC/MGPS math", () => {
  // Evans 2001 worked example: a=10, b=90, c=200, d=9700
  //   2x2:        event   not-event
  //     drug:       a=10    b=90       (drug_total = a+b = 100)
  //     not-drug:   c=200   d=9700     (not-drug-total = c+d = 9900)
  //   event_total = a+c = 210; grand_total = 10000; drug_total = 100
  // PRR = (a/(a+b)) / (c/(c+d)) = (10/100) / (200/9900) = 0.10 / 0.0202 ≈ 4.95
  // ROR = (a/b) / (c/d) = (10/90) / (200/9700) ≈ 5.39
  it("PRR matches Evans 2001 worked example (~4.95)", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      case_counts: {
        drug_event: 10,
        drug_total: 100,
        event_total: 210,
        grand_total: 10000,
      },
    });
    expect(r.signal_assessment.statistics.prr.value).toBeGreaterThan(4.5);
    expect(r.signal_assessment.statistics.prr.value).toBeLessThan(5.4);
  });

  it("ROR matches Evans 2001 worked example (~5.39)", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      case_counts: {
        drug_event: 10,
        drug_total: 100,
        event_total: 210,
        grand_total: 10000,
      },
    });
    expect(r.signal_assessment.statistics.ror.value).toBeGreaterThan(4.9);
    expect(r.signal_assessment.statistics.ror.value).toBeLessThan(5.9);
  });

  it("IC (Bate 1998 BCPNN) is positive for over-reported pair", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      case_counts: {
        drug_event: 10,
        drug_total: 100,
        event_total: 210,
        grand_total: 10000,
      },
    });
    expect(r.signal_assessment.statistics.ic.value).toBeGreaterThan(1);
    expect(r.signal_assessment.statistics.ic.ic025).toBeGreaterThan(0);
  });

  it("MGPS EBGM is approximately equal to PRR for over-reported pair (Sentinel-style)", async () => {
    // EBGM should be in the same ballpark as PRR for a strong signal
    // (gamma-Poisson shrinkage shrinks toward 1 only when N is small).
    const r = await run({
      drug: "x",
      indication: "y",
      case_counts: {
        drug_event: 10,
        drug_total: 100,
        event_total: 210,
        grand_total: 10000,
      },
    });
    expect(r.signal_assessment.statistics.mgps.ebgm).toBeGreaterThan(2);
    expect(r.signal_assessment.statistics.mgps.eb05).toBeGreaterThan(1);
  });

  it("chi-squared is reported and large for strong signal", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      case_counts: {
        drug_event: 10,
        drug_total: 100,
        event_total: 210,
        grand_total: 10000,
      },
    });
    expect(r.signal_assessment.statistics.chi_squared).toBeGreaterThan(4);
  });

  it("PRR confidence interval is reported", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      case_counts: {
        drug_event: 10,
        drug_total: 100,
        event_total: 210,
        grand_total: 10000,
      },
    });
    const prr = r.signal_assessment.statistics.prr;
    expect(prr.ci_low).toBeGreaterThan(0);
    expect(prr.ci_high).toBeGreaterThan(prr.value);
  });

  it("statistical methods agree on direction for strong signal", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      case_counts: {
        drug_event: 25,
        drug_total: 1000,
        event_total: 500,
        grand_total: 100000,
      },
    });
    expect(r.signal_assessment.statistics.prr.threshold_met).toBe(true);
    expect(r.signal_assessment.statistics.ror.threshold_met).toBe(true);
    expect(r.signal_assessment.statistics.ic.threshold_met).toBe(true);
    expect(r.signal_assessment.statistics.mgps.threshold_met).toBe(true);
  });

  it("statistics agree on no-signal for non-disproportionate pair", async () => {
    // Drug-event proportion equal to overall event proportion
    const r = await run({
      drug: "x",
      indication: "y",
      case_counts: {
        drug_event: 5,
        drug_total: 1000,
        event_total: 500,
        grand_total: 100000,
      },
    });
    expect(r.signal_assessment.statistics.prr.threshold_met).toBe(false);
    expect(r.signal_assessment.statistics.ic.threshold_met).toBe(false);
  });
});

// ---- Decision tree: each verdict reachable ------------------------------

describe("pv_signal_workflow — verdicts", () => {
  it("confirmed_signal: ≥2 methods trigger + N≥3 + χ²≥4 + not previously known", async () => {
    const r = await run({
      drug: "drugX",
      indication: "metastatic NSCLC",
      case_counts: {
        drug_event: 25,
        drug_total: 1000,
        event_total: 500,
        grand_total: 100000,
      },
      outcome_serious: true,
    });
    expect(r.signal_assessment.verdict).toBe("confirmed_signal");
  });

  it("no_signal: zero methods trigger", async () => {
    const r = await run({
      drug: "drugX",
      indication: "y",
      case_counts: {
        drug_event: 5,
        drug_total: 1000,
        event_total: 500,
        grand_total: 100000,
      },
    });
    expect(r.signal_assessment.verdict).toBe("no_signal");
  });

  it("previously_known_signal: same disproportionality, prior signal listed AND reported_event matches", async () => {
    // Per code-review HIGH #1 fix (2026-05-05): previously_known_signal
    // requires a SPECIFIC event match, not just a non-empty prior list.
    const r = await run({
      drug: "metformin",
      indication: "T2D",
      case_counts: {
        drug_event: 50,
        drug_total: 100000,
        event_total: 1000,
        grand_total: 5000000,
      },
      prior_known_signals: ["lactic acidosis"],
      reported_event: "lactic acidosis",
    });
    expect(r.signal_assessment.verdict).toBe("previously_known_signal");
  });
});

// ---- Outcome severity lowers threshold ----------------------------------

describe("pv_signal_workflow — outcome_serious lowers PRR threshold", () => {
  it("outcome_serious=true lowers PRR threshold to 1.5 (vs 2.0 default)", async () => {
    // Borderline counts producing PRR ≈ 1.98, χ² ≈ 9.6, N=20.
    // Standard threshold (PRR≥2 + χ²≥4 + N≥3): NOT met (PRR < 2).
    // Serious threshold (PRR≥1.5 + χ²≥4 + N≥3): met.
    const borderline = {
      drug: "x",
      indication: "y",
      case_counts: {
        drug_event: 20,
        drug_total: 1000,
        event_total: 1020,
        grand_total: 100000,
      },
    };
    const standard = await run({ ...borderline, outcome_serious: false });
    const serious = await run({ ...borderline, outcome_serious: true });

    // PRR value itself is the same — only the threshold check differs
    expect(standard.signal_assessment.statistics.prr.value).toBeCloseTo(
      serious.signal_assessment.statistics.prr.value,
      3,
    );
    // Sanity: PRR is in the 1.5–2.0 band where this test is meaningful
    expect(standard.signal_assessment.statistics.prr.value).toBeGreaterThan(
      1.5,
    );
    expect(standard.signal_assessment.statistics.prr.value).toBeLessThan(2.0);
    // Behaviour we're verifying:
    expect(standard.signal_assessment.statistics.prr.threshold_met).toBe(false);
    expect(serious.signal_assessment.statistics.prr.threshold_met).toBe(true);
  });
});

// ---- Pregnancy P.III gating --------------------------------------------

describe("pv_signal_workflow — GVP P.III pregnancy follow-up gating", () => {
  it("pregnancy_followup is populated when BOTH pregnancy_exposure AND rmp_has_pregnancy_concern are true", async () => {
    const r = await run({
      drug: "ozanimod",
      indication: "ulcerative colitis",
      case_counts: {
        drug_event: 4,
        drug_total: 200,
        event_total: 800,
        grand_total: 50000,
      },
      pregnancy_exposure: true,
      rmp_has_pregnancy_concern: true,
    });
    expect(r.signal_assessment.pregnancy_followup).toBeDefined();
    expect(r.signal_assessment.pregnancy_followup?.timepoints).toEqual([
      "birth",
      "3_months",
      "12_months",
    ]);
    expect(
      r.signal_assessment.pregnancy_followup?.followup_protocol_ref,
    ).toMatch(/GVP.*P[._]III/);
  });

  it("pregnancy_followup is NOT populated when pregnancy_exposure=true but rmp_has_pregnancy_concern=false", async () => {
    // Per actual GVP P.III text: follow-up "in principle only when the
    // medicinal product is associated with pregnancy-related safety
    // concerns identified in the RMP". Don't over-trigger.
    const r = await run({
      drug: "ozanimod",
      indication: "ulcerative colitis",
      case_counts: {
        drug_event: 4,
        drug_total: 200,
        event_total: 800,
        grand_total: 50000,
      },
      pregnancy_exposure: true,
      rmp_has_pregnancy_concern: false,
    });
    expect(r.signal_assessment.pregnancy_followup).toBeUndefined();
  });

  it("pregnancy_followup is NOT populated when pregnancy_exposure=false even if rmp_has_pregnancy_concern=true", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      case_counts: {
        drug_event: 5,
        drug_total: 1000,
        event_total: 500,
        grand_total: 100000,
      },
      pregnancy_exposure: false,
      rmp_has_pregnancy_concern: true,
    });
    expect(r.signal_assessment.pregnancy_followup).toBeUndefined();
  });
});

// ---- Output content ----------------------------------------------------

describe("pv_signal_workflow — output content", () => {
  it("RMP signal-section text includes actual statistics, not placeholders", async () => {
    const r = await run({
      drug: "drugX",
      indication: "metastatic NSCLC",
      case_counts: {
        drug_event: 25,
        drug_total: 1000,
        event_total: 500,
        grand_total: 100000,
      },
      outcome_serious: true,
    });
    const txt = r.signal_assessment.rmp_signal_section_text;
    expect(txt).toMatch(/PRR/);
    // Should contain a number, not a placeholder
    expect(txt).toMatch(/\d/);
    expect(txt).not.toMatch(/\{[A-Z_]+\}|<placeholder>/);
  });

  it("markdown output names all 4 statistical methods (PRR, ROR, IC, MGPS)", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      case_counts: {
        drug_event: 10,
        drug_total: 100,
        event_total: 210,
        grand_total: 10000,
      },
    });
    const t = r.content;
    expect(t).toMatch(/PRR/);
    expect(t).toMatch(/ROR/);
    expect(t).toMatch(/\bIC\b|Information Component/);
    expect(t).toMatch(/MGPS|EBGM/);
  });

  it("markdown notes Reg 2025/1466 / GVP Module IX rev 2", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      case_counts: {
        drug_event: 5,
        drug_total: 1000,
        event_total: 500,
        grand_total: 100000,
      },
    });
    expect(r.content).toMatch(/2025\/1466|Module IX|EVDAS/);
  });

  it("output stamps gvp_revision='rev_4' for auditability", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      case_counts: {
        drug_event: 5,
        drug_total: 1000,
        event_total: 500,
        grand_total: 100000,
      },
    });
    expect(r.signal_assessment.gvp_revision).toBe("rev_4");
  });
});

// ---- Code-review fixes (CRITICAL / HIGH from 2026-05-05 review) ---------

describe("pv_signal_workflow — cross-field validation (CRITICAL)", () => {
  it("rejects drug_event > event_total (would produce negative cell c)", async () => {
    await expect(
      run({
        drug: "x",
        indication: "y",
        case_counts: {
          drug_event: 10,
          drug_total: 100,
          event_total: 5, // smaller than drug_event — invalid
          grand_total: 1000,
        },
      }),
    ).rejects.toThrow(/event_total|drug_event|cell c/i);
  });

  it("rejects drug_event > drug_total (would produce negative cell b)", async () => {
    await expect(
      run({
        drug: "x",
        indication: "y",
        case_counts: {
          drug_event: 100,
          drug_total: 50, // smaller than drug_event — invalid
          event_total: 200,
          grand_total: 10000,
        },
      }),
    ).rejects.toThrow(/drug_total|drug_event|cell b/i);
  });

  it("rejects grand_total too small to accommodate the four cells (negative d)", async () => {
    await expect(
      run({
        drug: "x",
        indication: "y",
        case_counts: {
          drug_event: 10,
          drug_total: 50,
          event_total: 30,
          grand_total: 60, // d = 60 - 50 - (30-10) = -10
        },
      }),
    ).rejects.toThrow(/grand_total|cell d/i);
  });
});

describe("pv_signal_workflow — previously_known_signal event matching (HIGH)", () => {
  it("does NOT classify as previously_known when reported_event differs from prior signals", async () => {
    // Drug has known "lactic acidosis" signal; current report is for "myocardial
    // infarction" — must be classified as a NEW signal, not previously known.
    const r = await run({
      drug: "metformin",
      indication: "T2D",
      case_counts: {
        drug_event: 50,
        drug_total: 100000,
        event_total: 1000,
        grand_total: 5000000,
      },
      prior_known_signals: ["lactic acidosis"],
      reported_event: "myocardial infarction",
    });
    expect(r.signal_assessment.verdict).not.toBe("previously_known_signal");
  });

  it("DOES classify as previously_known when reported_event matches a prior signal (case-insensitive)", async () => {
    const r = await run({
      drug: "metformin",
      indication: "T2D",
      case_counts: {
        drug_event: 50,
        drug_total: 100000,
        event_total: 1000,
        grand_total: 5000000,
      },
      prior_known_signals: ["Lactic Acidosis"],
      reported_event: "lactic acidosis",
    });
    expect(r.signal_assessment.verdict).toBe("previously_known_signal");
  });

  it("substring match: reported_event 'severe lactic acidosis' matches prior 'lactic acidosis'", async () => {
    const r = await run({
      drug: "metformin",
      indication: "T2D",
      case_counts: {
        drug_event: 50,
        drug_total: 100000,
        event_total: 1000,
        grand_total: 5000000,
      },
      prior_known_signals: ["lactic acidosis"],
      reported_event: "severe lactic acidosis",
    });
    expect(r.signal_assessment.verdict).toBe("previously_known_signal");
  });

  it("when reported_event is missing AND prior_known_signals is non-empty, audit warns and verdict is NOT previously_known", async () => {
    // Cannot suppress a signal as previously-known without knowing what
    // event we're scoring. Audit must reflect the ambiguity.
    const r = await run({
      drug: "metformin",
      indication: "T2D",
      case_counts: {
        drug_event: 50,
        drug_total: 100000,
        event_total: 1000,
        grand_total: 5000000,
      },
      prior_known_signals: ["lactic acidosis"],
      // reported_event omitted
    });
    expect(r.signal_assessment.verdict).not.toBe("previously_known_signal");
  });
});

describe("pv_signal_workflow — IC variance per Norén 2006 (HIGH)", () => {
  // Evans 2001 vector with full Norén posterior variance:
  //   IC = log2((10+0.5)/(2.1+0.5)) ≈ 2.014
  //   var(IC) = (1/10.5 + 1/100.5 + 1/210.5 + 1/10000.5) / ln(2)² ≈ 0.229
  //   SE ≈ 0.479; IC025 = 2.014 - 1.96 * 0.479 ≈ 1.076
  // The previous variance formula (only 2 of 4 terms) gave IC025 ≈ 0.055,
  // a systematic under-trigger that flipped IC threshold_met for borderline
  // signals.
  it("IC025 matches Norén 2006 simplified posterior variance (~1.07 for Evans)", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      case_counts: {
        drug_event: 10,
        drug_total: 100,
        event_total: 210,
        grand_total: 10000,
      },
    });
    expect(r.signal_assessment.statistics.ic.ic025).toBeGreaterThan(0.9);
    expect(r.signal_assessment.statistics.ic.ic025).toBeLessThan(1.3);
  });
});

describe("pv_signal_workflow — chi-squared with Yates correction applied (HIGH)", () => {
  // Evans 2001 vector:
  //   Pearson uncorrected ≈ 30.66
  //   Yates-corrected ≈ 26.90
  // The markdown labels the value "χ² (Yates)", so the math must match.
  it("chi-squared matches Yates-corrected Evans 2001 vector (~26.9)", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      case_counts: {
        drug_event: 10,
        drug_total: 100,
        event_total: 210,
        grand_total: 10000,
      },
    });
    expect(r.signal_assessment.statistics.chi_squared).toBeGreaterThan(25);
    expect(r.signal_assessment.statistics.chi_squared).toBeLessThan(28);
  });
});

// ---- Performance --------------------------------------------------------

describe("pv_signal_workflow — performance", () => {
  it("returns in under 300ms", async () => {
    const start = Date.now();
    await run({
      drug: "x",
      indication: "y",
      case_counts: {
        drug_event: 25,
        drug_total: 1000,
        event_total: 500,
        grand_total: 100000,
      },
      outcome_serious: true,
      pregnancy_exposure: true,
      rmp_has_pregnancy_concern: true,
    });
    expect(Date.now() - start).toBeLessThan(300);
  });
});
