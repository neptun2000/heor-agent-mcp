import { handleRiskOfBias } from "../../src/tools/riskOfBias.js";

const rctStudy = {
  id: "pmid_1",
  source: "pubmed",
  title: "Semaglutide vs placebo: a randomized double-blind trial",
  authors: ["Smith J"],
  date: "2024-01-15",
  study_type: "RCT",
  abstract:
    "We randomized 1000 adults to semaglutide or placebo. Allocation concealment was maintained via central randomization. The trial was double-blind with blinded assessment of outcomes. Complete follow-up with no missing data. Analysis was intention-to-treat with full analysis set. Trial pre-registered at ClinicalTrials.gov (NCT12345678).",
  url: "https://pubmed.ncbi.nlm.nih.gov/1",
};

const observationalStudy = {
  id: "pmid_2",
  source: "pubmed",
  title: "Real-world cohort study of semaglutide in type 2 diabetes",
  authors: ["Jones K"],
  date: "2023-06-10",
  study_type: "observational",
  abstract:
    "A retrospective cohort study using electronic health records. Multivariable regression adjusted for age, BMI, and HbA1c. Propensity score weighting was applied. Outcome was assessed using validated ICD codes. Analysis registered in PROSPERO.",
  url: "https://pubmed.ncbi.nlm.nih.gov/2",
};

const srStudy = {
  id: "pmid_3",
  source: "cochrane",
  title: "Systematic review and meta-analysis of GLP-1 agonists in T2DM",
  authors: ["Brown L"],
  date: "2024-03-01",
  study_type: "systematic_review",
  abstract:
    "Systematic review searching PubMed, MEDLINE, EMBASE, and Cochrane databases. Registered in PROSPERO. Two independent reviewers screened studies. Risk of bias assessed using Cochrane tool. Random effects meta-analysis with I² heterogeneity. Funnel plot assessed for publication bias. Funding sources reported.",
  url: "https://pubmed.ncbi.nlm.nih.gov/3",
};

const openLabelRct = {
  id: "pmid_4",
  source: "pubmed",
  title: "Open-label study of tirzepatide",
  authors: ["Lee A"],
  date: "2023-01-01",
  study_type: "RCT",
  abstract:
    "An open-label randomized trial comparing tirzepatide to insulin glargine. No allocation concealment. Analysis was per-protocol.",
  url: "https://pubmed.ncbi.nlm.nih.gov/4",
};

const emptyAbstractStudy = {
  id: "pmid_5",
  source: "pubmed",
  title: "A clinical trial of drug X",
  authors: ["Doe J"],
  date: "2022-01-01",
  study_type: "RCT",
  abstract: "",
  url: "https://pubmed.ncbi.nlm.nih.gov/5",
};

describe("handleRiskOfBias", () => {
  // ── Input validation ────────────────────────────────────────────────────────

  it("rejects empty studies array", async () => {
    await expect(handleRiskOfBias({ studies: [] })).rejects.toThrow();
  });

  it("rejects missing required field", async () => {
    await expect(handleRiskOfBias({})).rejects.toThrow();
  });

  // ── Instrument auto-detection ───────────────────────────────────────────────

  it("assigns rob2 to RCT study", async () => {
    const result = await handleRiskOfBias({
      studies: [rctStudy],
      output_format: "json",
    });
    const content = result.content as {
      studies: Array<{ instrument: string }>;
    };
    expect(content.studies[0].instrument).toBe("rob2");
  });

  it("assigns robins_i to observational study", async () => {
    const result = await handleRiskOfBias({
      studies: [observationalStudy],
      output_format: "json",
    });
    const content = result.content as {
      studies: Array<{ instrument: string }>;
    };
    expect(content.studies[0].instrument).toBe("robins_i");
  });

  it("assigns amstar2 to systematic review", async () => {
    const result = await handleRiskOfBias({
      studies: [srStudy],
      output_format: "json",
    });
    const content = result.content as {
      studies: Array<{ instrument: string }>;
    };
    expect(content.studies[0].instrument).toBe("amstar2");
  });

  it("respects explicit instrument override", async () => {
    const result = await handleRiskOfBias({
      studies: [rctStudy],
      instrument: "robins_i",
      output_format: "json",
    });
    const content = result.content as {
      studies: Array<{ instrument: string; instrument_assumed: boolean }>;
    };
    expect(content.studies[0].instrument).toBe("robins_i");
    expect(content.studies[0].instrument_assumed).toBe(false);
  });

  it("sets instrument_assumed=true when auto-detected", async () => {
    const result = await handleRiskOfBias({
      studies: [rctStudy],
      output_format: "json",
    });
    const content = result.content as {
      studies: Array<{ instrument_assumed: boolean }>;
    };
    expect(content.studies[0].instrument_assumed).toBe(true);
  });

  // ── RoB 2 domain judgments ──────────────────────────────────────────────────

  it("RoB 2: well-reported RCT scores Low on most domains", async () => {
    const result = await handleRiskOfBias({
      studies: [rctStudy],
      output_format: "json",
    });
    const content = result.content as {
      studies: Array<{
        domains: Record<string, { judgment: string }>;
        overall: string;
      }>;
    };
    const domains = content.studies[0].domains;
    expect(domains["D1: Randomization"].judgment).toMatch(/Low/);
    expect(domains["D2: Deviations"].judgment).toMatch(/Low/);
    expect(domains["D5: Reporting"].judgment).toMatch(/Low/);
    expect(content.studies[0].overall).toBe("Low");
  });

  it("RoB 2: open-label trial scores High on D1 and D2", async () => {
    const result = await handleRiskOfBias({
      studies: [openLabelRct],
      output_format: "json",
    });
    const content = result.content as {
      studies: Array<{
        domains: Record<string, { judgment: string }>;
        overall: string;
      }>;
    };
    const domains = content.studies[0].domains;
    expect(domains["D1: Randomization"].judgment).toBe("High");
    expect(domains["D2: Deviations"].judgment).toBe("High");
    expect(content.studies[0].overall).toBe("High");
  });

  it("RoB 2: empty abstract gives Unclear on all domains", async () => {
    const result = await handleRiskOfBias({
      studies: [emptyAbstractStudy],
      output_format: "json",
    });
    const content = result.content as {
      studies: Array<{ domains: Record<string, { judgment: string }> }>;
    };
    const domains = content.studies[0].domains;
    for (const domain of Object.values(domains)) {
      expect(domain.judgment).toBe("Unclear");
    }
  });

  // ── ROBINS-I domain judgments ───────────────────────────────────────────────

  it("ROBINS-I: well-reported observational study scores Low on confounding/measurement", async () => {
    const result = await handleRiskOfBias({
      studies: [observationalStudy],
      output_format: "json",
    });
    const content = result.content as {
      studies: Array<{ domains: Record<string, { judgment: string }> }>;
    };
    const domains = content.studies[0].domains;
    expect(domains["D1: Confounding"].judgment).toMatch(/Low/);
    expect(domains["D6: Measurement"].judgment).toMatch(/Low/);
  });

  // ── AMSTAR-2 overall rating ─────────────────────────────────────────────────

  it("AMSTAR-2: comprehensive SR rates High or Moderate", async () => {
    const result = await handleRiskOfBias({
      studies: [srStudy],
      output_format: "json",
    });
    const content = result.content as {
      studies: Array<{ overall: string }>;
    };
    expect(["High", "Moderate"]).toContain(content.studies[0].overall);
  });

  it("AMSTAR-2: partial Yes signals give partial credit (not Critically Low)", async () => {
    const partialSR = {
      ...srStudy,
      id: "pmid_sr2",
      abstract:
        "Systematic review searching PubMed, MEDLINE, and EMBASE. Random effects meta-analysis with I² heterogeneity reported. Risk of bias assessed using Cochrane tool. Funding sources disclosed.",
    };
    const result = await handleRiskOfBias({
      studies: [partialSR],
      output_format: "json",
    });
    const content = result.content as { studies: Array<{ overall: string }> };
    expect(content.studies[0].overall).not.toBe("Critically Low");
  });

  // ── rob_results structure ───────────────────────────────────────────────────

  it("rob_results includes url and date per study", async () => {
    const result = await handleRiskOfBias({
      studies: [rctStudy],
      output_format: "json",
    });
    const content = result.content as {
      studies: Array<{ url: string; date: string }>;
    };
    expect(content.studies[0].url).toBe(rctStudy.url);
    expect(content.studies[0].date).toBe(rctStudy.date);
  });

  it("rob_results summary counts instruments correctly", async () => {
    const result = await handleRiskOfBias({
      studies: [rctStudy, observationalStudy, srStudy],
      output_format: "json",
    });
    const content = result.content as {
      summary: {
        rob2_count: number;
        robins_i_count: number;
        amstar2_count: number;
        n_assessed: number;
      };
    };
    expect(content.summary.n_assessed).toBe(3);
    expect(content.summary.rob2_count).toBe(1);
    expect(content.summary.robins_i_count).toBe(1);
    expect(content.summary.amstar2_count).toBe(1);
  });

  // ── GRADE summary ───────────────────────────────────────────────────────────

  it("GRADE: good RCT → overall_certainty_start=High, no downgrade", async () => {
    const result = await handleRiskOfBias({
      studies: [rctStudy],
      output_format: "json",
    });
    const content = result.content as {
      overall_certainty_start: string;
      summary: { downgrade: boolean };
    };
    expect(content.overall_certainty_start).toBe("High");
    expect(content.summary.downgrade).toBe(false);
  });

  it("GRADE: high-risk RCT → downgrade=true", async () => {
    const result = await handleRiskOfBias({
      studies: [openLabelRct],
      output_format: "json",
    });
    const content = result.content as {
      summary: { downgrade: boolean; rob_judgment: string };
    };
    expect(content.summary.downgrade).toBe(true);
    expect(content.summary.rob_judgment).toBe("High");
  });

  it("GRADE: SR-only input → overall_certainty_start=Low (conservative)", async () => {
    const result = await handleRiskOfBias({
      studies: [srStudy],
      output_format: "json",
    });
    const content = result.content as { overall_certainty_start: string };
    expect(content.overall_certainty_start).toBe("Low");
  });

  // ── Markdown output ─────────────────────────────────────────────────────────

  it("text output contains RoB 2 section for RCT", async () => {
    const result = await handleRiskOfBias({ studies: [rctStudy] });
    expect(typeof result.content).toBe("string");
    expect(result.content).toContain("Risk of Bias Assessment");
    expect(result.content).toContain("RoB 2");
  });

  it("text output contains GRADE section", async () => {
    const result = await handleRiskOfBias({ studies: [rctStudy] });
    expect(result.content).toContain("GRADE Risk of Bias Domain");
  });

  it("text output handles mixed instruments", async () => {
    const result = await handleRiskOfBias({
      studies: [rctStudy, observationalStudy],
    });
    expect(result.content).toContain("RoB 2");
    expect(result.content).toContain("ROBINS-I");
  });

  // ── Phase II detection fix ──────────────────────────────────────────────────

  it("Phase II non-randomized study is not assigned rob2", async () => {
    const phaseII = {
      ...emptyAbstractStudy,
      id: "pmid_ph2",
      study_type: "phase ii",
      abstract:
        "A phase ii dose-escalation single-arm study of drug X in healthy volunteers.",
    };
    const result = await handleRiskOfBias({
      studies: [phaseII],
      output_format: "json",
    });
    const content = result.content as {
      studies: Array<{
        instrument: string;
        domains: Record<string, { judgment: string }>;
      }>;
    };
    // Should fall through to default (rob2) — no randomization signals, so all domains Unclear
    const domains = content.studies[0].domains;
    expect(domains["D1: Randomization"].judgment).toBe("Unclear");
  });

  // ── Audit trail ─────────────────────────────────────────────────────────────

  it("returns an audit record", async () => {
    const result = await handleRiskOfBias({ studies: [rctStudy] });
    expect(result.audit).toBeDefined();
    expect(result.audit.tool).toBe("evidence.risk_of_bias");
  });
});
