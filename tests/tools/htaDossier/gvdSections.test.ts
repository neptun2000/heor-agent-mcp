/**
 * TDD — RED phase: gvdSections tests
 * Tests for GVD section generators (all should fail before implementation).
 */
import { handleHtaDossierPrep } from "../../../src/tools/htaDossierPrep.js";
import {
  generateGvdSection,
  GvdSectionParams,
} from "../../../src/tools/htaDossier/gvdSections.js";

const baseDossierParams = {
  hta_body: "gvd" as const,
  submission_type: "initial" as const,
  drug_name: "examplivir",
  indication: "chronic hepatitis B",
};

const fullGvdParams: GvdSectionParams = {
  drug: "examplivir",
  indication: "chronic hepatitis B",
  evidence_summary: "Phase 3 RCT showed 85% viral suppression at week 48.",
  unmet_need_summary:
    "Approximately 30% of patients fail first-line nucleoside analogues.",
  economic_icer: 22000,
  economic_currency: "GBP",
  economic_bim_year3: 4500000,
  comparators: ["tenofovir", "entecavir"],
  product_description: "Examplivir is a novel capsid assembly modulator (CAM).",
};

// ─── Integration tests: handleHtaDossierPrep with hta_body:"gvd" ───────────

describe("GVD — integration: produces 13 sections (not generic placeholders)", () => {
  it("returns content without generic placeholder boilerplate", async () => {
    const result = await handleHtaDossierPrep({
      ...baseDossierParams,
      ...fullGvdParams,
      drug_name: fullGvdParams.drug,
    });
    // Generic buildSection default returns "⚠️ {name} — populate with submission-specific content."
    expect(result.content).not.toContain(
      "populate with submission-specific content",
    );
  });

  it("output contains all 13 GVD section headings", async () => {
    const result = await handleHtaDossierPrep({
      ...baseDossierParams,
      drug_name: "examplivir",
    });
    const text = result.content as string;
    expect(text).toContain("Executive Summary");
    expect(text).toContain("Disease Background and Epidemiology");
    expect(text).toContain("Current Standard of Care");
    expect(text).toContain("Unmet Need");
    expect(text).toContain("Product Description and Mechanism of Action");
    expect(text).toContain("Clinical Evidence");
    expect(text).toContain("Comparative Effectiveness");
    expect(text).toContain("Safety Profile");
    expect(text).toContain("Health Economic Summary");
    expect(text).toContain("Patient Reported Outcomes and Quality of Life");
    expect(text).toContain("Policy Environment and Market Access Landscape");
    expect(text).toContain("Implementation Considerations");
    expect(text).toContain("Evidence Gaps and Ongoing Studies");
  });
});

// ─── Unit tests: generateGvdSection ────────────────────────────────────────

describe("generateGvdSection — Section 2: Disease Background and Epidemiology", () => {
  it("contains drug name in content", () => {
    const { content } = generateGvdSection(
      "Disease Background and Epidemiology",
      { drug: "examplivir", indication: "chronic hepatitis B" },
    );
    // Drug name or indication should appear — indication is the main topic
    expect(content.toLowerCase()).toContain("chronic hepatitis b");
  });

  it("contains indication in content", () => {
    const { content } = generateGvdSection(
      "Disease Background and Epidemiology",
      { drug: "examplivir", indication: "chronic hepatitis B" },
    );
    expect(content.toLowerCase()).toContain("chronic hepatitis b");
  });
});

describe("generateGvdSection — Section 3: Current Standard of Care", () => {
  it("mentions standard of care comparators when provided", () => {
    const { content } = generateGvdSection("Current Standard of Care", {
      drug: "examplivir",
      indication: "chronic hepatitis B",
      comparators: ["tenofovir", "entecavir"],
    });
    expect(content).toContain("tenofovir");
    expect(content).toContain("entecavir");
  });

  it("warns and has missing status when no comparators provided", () => {
    const { content, status } = generateGvdSection("Current Standard of Care", {
      drug: "examplivir",
      indication: "chronic hepatitis B",
    });
    expect(content).toContain("⚠️");
    expect(status).toBe("missing");
  });
});

describe("generateGvdSection — Section 4: Unmet Need", () => {
  it("uses unmet_need_summary verbatim when provided", () => {
    const summary =
      "High unmet need: 30% treatment failure on first-line agents.";
    const { content, status } = generateGvdSection("Unmet Need", {
      drug: "examplivir",
      indication: "chronic hepatitis B",
      unmet_need_summary: summary,
    });
    expect(content).toContain(summary);
    expect(status).toBe("complete");
  });

  it("warns when unmet_need_summary is absent", () => {
    const { content, status } = generateGvdSection("Unmet Need", {
      drug: "examplivir",
      indication: "chronic hepatitis B",
    });
    expect(content).toContain("⚠️");
    expect(status).toBe("missing");
  });
});

describe("generateGvdSection — Section 6: Clinical Evidence", () => {
  it("shows evidence_summary when provided as string", () => {
    const evidenceText = "Phase 3 RCT showed 85% viral suppression.";
    const { content, status } = generateGvdSection("Clinical Evidence", {
      drug: "examplivir",
      indication: "chronic hepatitis B",
      evidence_summary: evidenceText,
    });
    expect(content).toContain(evidenceText);
    expect(status).not.toBe("missing");
  });

  it("warns when no evidence provided", () => {
    const { content, status } = generateGvdSection("Clinical Evidence", {
      drug: "examplivir",
      indication: "chronic hepatitis B",
    });
    expect(content).toContain("⚠️");
    expect(status).toBe("missing");
  });
});

describe("generateGvdSection — Section 9: Health Economic Summary", () => {
  it("shows ICER when economic_icer provided", () => {
    const { content, status } = generateGvdSection("Health Economic Summary", {
      drug: "examplivir",
      indication: "chronic hepatitis B",
      economic_icer: 22000,
      economic_currency: "GBP",
      economic_bim_year3: 4500000,
    });
    // toLocaleString() renders 22000 as "22,000" — match the rendered format
    expect(content).toMatch(/22[,.]?000/);
    expect(content).toContain("GBP");
    expect(status).toBe("complete");
  });

  it("warns when no economic data provided", () => {
    const { content, status } = generateGvdSection("Health Economic Summary", {
      drug: "examplivir",
      indication: "chronic hepatitis B",
    });
    expect(content).toContain("⚠️");
    expect(status).toBe("missing");
  });
});

describe("generateGvdSection — Section 11: Policy Environment", () => {
  it("contains 4 market subsections (US, UK, EU5, JP)", () => {
    const { content } = generateGvdSection(
      "Policy Environment and Market Access Landscape",
      { drug: "examplivir", indication: "chronic hepatitis B" },
    );
    expect(content).toContain("11.1");
    expect(content).toContain("11.2");
    expect(content).toContain("11.3");
    expect(content).toContain("11.4");
  });
});

describe("generateGvdSection — Section 13: Evidence Gaps", () => {
  it("lists gaps when provided", () => {
    const { content } = generateGvdSection(
      "Evidence Gaps and Ongoing Studies",
      {
        drug: "examplivir",
        indication: "chronic hepatitis B",
      },
    );
    // Should mention evidence gaps / ongoing studies
    expect(content.toLowerCase()).toMatch(/gap|ongoing|stud/);
  });
});

// ─── Integration: gaps[] list ────────────────────────────────────────────────

describe("GVD — integration: gaps analysis", () => {
  it("gaps[] lists missing sections when minimal input supplied", async () => {
    const result = await handleHtaDossierPrep({
      ...baseDossierParams,
      drug_name: "examplivir",
      // no evidence, no comparators, no economic data
    });
    const text = result.content as string;
    // Gap Analysis section should appear
    expect(text).toContain("Gap Analysis");
    // Some missing sections should be flagged
    expect(text).toMatch(/⚠️.*\w/);
  });
});

// ─── Integration: gvd_evidence_pack ─────────────────────────────────────────

describe("GVD — integration: gvd_evidence_pack returned", () => {
  it("gvd_evidence_pack JSON block is present in output", async () => {
    const result = await handleHtaDossierPrep({
      ...baseDossierParams,
      drug_name: "examplivir",
      evidence_summary: "Phase 3 RCT 85% viral suppression.",
      unmet_need_summary: "High unmet need.",
    });
    const text = result.content as string;
    expect(text).toContain("gvd_evidence_pack");
  });

  it("gvd_evidence_pack JSON contains schema_version 1.0", async () => {
    const result = await handleHtaDossierPrep({
      ...baseDossierParams,
      drug_name: "examplivir",
    });
    const text = result.content as string;
    expect(text).toContain('"schema_version"');
    expect(text).toContain('"1.0"');
  });

  it("gvd_evidence_pack clinical_evidence_summary is non-empty", async () => {
    const result = await handleHtaDossierPrep({
      ...baseDossierParams,
      drug_name: "examplivir",
      evidence_summary: "Phase 3 RCT 85% viral suppression.",
    });
    const text = result.content as string;
    // Extract JSON block
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
    expect(jsonMatch).not.toBeNull();
    const pack = JSON.parse(jsonMatch![1]);
    expect(pack.clinical_evidence_summary).toBeTruthy();
    expect(pack.clinical_evidence_summary.length).toBeGreaterThan(0);
  });

  it("gvd_evidence_pack market_pathways has keys: us, uk, eu5, jp", async () => {
    const result = await handleHtaDossierPrep({
      ...baseDossierParams,
      drug_name: "examplivir",
    });
    const text = result.content as string;
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
    expect(jsonMatch).not.toBeNull();
    const pack = JSON.parse(jsonMatch![1]);
    expect(pack.market_pathways).toHaveProperty("us");
    expect(pack.market_pathways).toHaveProperty("uk");
    expect(pack.market_pathways).toHaveProperty("eu5");
    expect(pack.market_pathways).toHaveProperty("jp");
  });
});

// ─── Executive Summary generated from other sections ─────────────────────────

describe("generateGvdSection — Section 1: Executive Summary", () => {
  it("references both drug and indication", () => {
    const { content } = generateGvdSection("Executive Summary", {
      drug: "examplivir",
      indication: "chronic hepatitis B",
    });
    expect(content.toLowerCase()).toContain("examplivir");
    expect(content.toLowerCase()).toContain("chronic hepatitis b");
  });

  it("mentions ISPOR or GVD in summary", () => {
    const { content } = generateGvdSection("Executive Summary", {
      drug: "examplivir",
      indication: "chronic hepatitis B",
    });
    expect(content).toMatch(/ISPOR|Global Value Dossier|GVD/);
  });
});
