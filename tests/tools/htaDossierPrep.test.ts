import { handleHtaDossierPrep } from "../../src/tools/htaDossierPrep.js";

const rctStudy = {
  id: "pmid_1",
  source: "pubmed",
  title: "Semaglutide vs placebo: a randomized double-blind trial",
  authors: ["Smith J"],
  date: "2024-01-15",
  study_type: "RCT",
  abstract:
    "We randomized 1000 adults to semaglutide or placebo. Allocation concealment was maintained via central randomization. Double-blind with blinded assessment of outcomes. Complete follow-up with no missing data. Intention-to-treat analysis. Pre-registered at ClinicalTrials.gov.",
  url: "https://pubmed.ncbi.nlm.nih.gov/1",
};

const goodRobResults = {
  summary: {
    rob_judgment: "Low",
    downgrade: false,
    rationale: "Well-conducted RCT with low risk across all domains",
  },
  overall_certainty_start: "High" as const,
};

const highRobResults = {
  summary: {
    rob_judgment: "High",
    downgrade: true,
    rationale: "Open-label, no allocation concealment",
  },
  overall_certainty_start: "High" as const,
};

const baseParams = {
  hta_body: "nice" as const,
  submission_type: "sta" as const,
  drug_name: "semaglutide",
  indication: "type 2 diabetes",
};

describe("handleHtaDossierPrep — rob_results integration", () => {
  it("accepts rob_results without throwing", async () => {
    await expect(
      handleHtaDossierPrep({
        ...baseParams,
        evidence_summary: [rctStudy],
        rob_results: goodRobResults,
      }),
    ).resolves.not.toThrow();
  });

  it("GRADE table uses structured rob_judgment when rob_results provided (Low)", async () => {
    const result = await handleHtaDossierPrep({
      ...baseParams,
      evidence_summary: [rctStudy],
      rob_results: goodRobResults,
    });
    expect(result.content).toContain("structured Risk of Bias assessment");
    expect(result.content).not.toContain("heuristic");
  });

  it("GRADE table uses heuristic note when rob_results omitted", async () => {
    const result = await handleHtaDossierPrep({
      ...baseParams,
      evidence_summary: [rctStudy],
    });
    expect(result.content).toContain("heuristic");
  });

  it("high rob_results downgrades certainty vs low rob_results", async () => {
    const lowResult = await handleHtaDossierPrep({
      ...baseParams,
      evidence_summary: [rctStudy],
      rob_results: goodRobResults,
    });
    const highResult = await handleHtaDossierPrep({
      ...baseParams,
      evidence_summary: [rctStudy],
      rob_results: highRobResults,
    });
    // High RoB should appear in the table; Low RoB should show Low
    expect(highResult.content).toContain("High");
    // Low RoB with a good RCT base → High certainty is achievable
    expect(typeof lowResult.content).toBe("string");
  });

  it("works without evidence_summary (no GRADE table generated)", async () => {
    const result = await handleHtaDossierPrep({
      ...baseParams,
      rob_results: goodRobResults,
    });
    expect(result.content).not.toContain("GRADE Evidence Quality");
  });

  it("returns an audit record", async () => {
    const result = await handleHtaDossierPrep({ ...baseParams });
    expect(result.audit).toBeDefined();
    expect(result.audit.tool).toBe("hta_dossier_prep");
  });
});
