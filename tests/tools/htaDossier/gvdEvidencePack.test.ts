/**
 * TDD — RED phase: gvdEvidencePack tests
 * Tests for buildGvdEvidencePack function.
 */
import {
  buildGvdEvidencePack,
  GvdEvidencePack,
} from "../../../src/tools/htaDossier/gvdEvidencePack.js";
import { GvdSectionParams } from "../../../src/tools/htaDossier/gvdSections.js";
import { generateMarketPathways } from "../../../src/tools/htaDossier/gvdMarketBranches.js";

const baseParams: GvdSectionParams = {
  drug: "examplivir",
  indication: "chronic hepatitis B",
};

const paramsWithEvidence: GvdSectionParams = {
  drug: "examplivir",
  indication: "chronic hepatitis B",
  evidence_summary: "Phase 3 RCT showed 85% viral suppression at week 48.",
  unmet_need_summary: "30% of patients fail first-line nucleoside analogues.",
  economic_icer: 22000,
  economic_currency: "GBP",
  economic_bim_year3: 4500000,
};

describe("buildGvdEvidencePack — schema version", () => {
  it("returns schema_version '1.0'", () => {
    const pathways = generateMarketPathways(baseParams.drug, baseParams.indication);
    const pack = buildGvdEvidencePack(baseParams, pathways);
    expect(pack.schema_version).toBe("1.0");
  });
});

describe("buildGvdEvidencePack — required fields", () => {
  it("has all required top-level fields", () => {
    const pathways = generateMarketPathways(baseParams.drug, baseParams.indication);
    const pack = buildGvdEvidencePack(baseParams, pathways);
    expect(pack).toHaveProperty("schema_version");
    expect(pack).toHaveProperty("drug");
    expect(pack).toHaveProperty("indication");
    expect(pack).toHaveProperty("clinical_evidence_summary");
    expect(pack).toHaveProperty("comparative_effectiveness_summary");
    expect(pack).toHaveProperty("economic_summary");
    expect(pack).toHaveProperty("market_pathways");
    expect(pack).toHaveProperty("references");
  });

  it("market_pathways has us/uk/eu5/jp keys", () => {
    const pathways = generateMarketPathways(baseParams.drug, baseParams.indication);
    const pack = buildGvdEvidencePack(baseParams, pathways);
    expect(pack.market_pathways).toHaveProperty("us");
    expect(pack.market_pathways).toHaveProperty("uk");
    expect(pack.market_pathways).toHaveProperty("eu5");
    expect(pack.market_pathways).toHaveProperty("jp");
  });
});

describe("buildGvdEvidencePack — unmet_need_summary", () => {
  it("accepts unmet_need_summary from evidence.unmet_need tool output", () => {
    const summary = "30% of patients fail first-line nucleoside analogues.";
    const pathways = generateMarketPathways(baseParams.drug, baseParams.indication);
    const pack = buildGvdEvidencePack(
      { ...baseParams, unmet_need_summary: summary },
      pathways,
    );
    expect(pack.unmet_need_summary).toBe(summary);
  });
});

describe("buildGvdEvidencePack — clinical_evidence_summary", () => {
  it("clinical_evidence_summary is a non-empty string", () => {
    const pathways = generateMarketPathways(
      paramsWithEvidence.drug,
      paramsWithEvidence.indication,
    );
    const pack = buildGvdEvidencePack(paramsWithEvidence, pathways);
    expect(typeof pack.clinical_evidence_summary).toBe("string");
    expect(pack.clinical_evidence_summary.length).toBeGreaterThan(0);
  });
});

describe("buildGvdEvidencePack — economic_summary defaults", () => {
  it("defaults to 0 values and USD when no CEM data provided", () => {
    const pathways = generateMarketPathways(baseParams.drug, baseParams.indication);
    const pack = buildGvdEvidencePack(baseParams, pathways);
    expect(pack.economic_summary.icer_per_qaly).toBe(0);
    expect(pack.economic_summary.bim_year_1_net).toBe(0);
    expect(pack.economic_summary.bim_year_3_net).toBe(0);
    expect(pack.economic_summary.currency).toBe("USD");
  });
});
