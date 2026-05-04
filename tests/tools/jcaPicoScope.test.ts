/**
 * Tests for jca_pico_scope — EU Joint Clinical Assessment PICO matrix
 * analyzer. See design log #13.
 *
 * Inputs: drug + indication + jurisdictions; outputs a structured
 * pico_matrix that pipes directly into hta_dossier({hta_body:"jca"}).
 *
 * Pure decision logic, hardcoded country profiles, <300ms.
 */
import { handleJcaPicoScope } from "../../src/tools/jcaPicoScope.js";
import { handleHtaDossierPrep } from "../../src/tools/htaDossierPrep.js";

interface PicoMatrix {
  drug: string;
  indication: string;
  jca_revision: "2026-05";
  picos: Array<{
    id: string;
    population: string;
    comparator: string;
    outcomes: string[];
  }>;
  country_specific: Array<{
    jurisdiction: string;
    hta_body: string;
    comparators: Array<{
      molecule: string;
      rationale: string;
      outcome_instrument_preferences: string[];
    }>;
    population_subgroups: string[];
    outcome_priorities: string[];
  }>;
  heterogeneity_warning: boolean;
  distinct_comparator_count: number;
  rationale: string;
}

interface JcaResult {
  content: string;
  pico_matrix: PicoMatrix;
}

async function scope(input: Record<string, unknown>): Promise<JcaResult> {
  return (await handleJcaPicoScope(input)) as unknown as JcaResult;
}

// ---- Schema validation ---------------------------------------------------

describe("jca_pico_scope — schema validation", () => {
  it("requires drug, indication, drug_class", async () => {
    await expect(handleJcaPicoScope({})).rejects.toThrow(
      /required|drug|indication|drug_class/i,
    );
  });

  it("accepts the minimal valid input", async () => {
    const r = await scope({
      drug: "osimertinib",
      indication: "non-small cell lung cancer",
      drug_class: "small_molecule",
    });
    expect(r.pico_matrix.jca_revision).toBe("2026-05");
    expect(r.pico_matrix.drug).toBe("osimertinib");
  });

  it("rejects unknown drug_class with did-you-mean", async () => {
    await expect(
      scope({
        drug: "x",
        indication: "y",
        drug_class: "small_molecules" as never,
      }),
    ).rejects.toThrow(/small_molecule/);
  });

  it("rejects unknown jurisdiction with did-you-mean", async () => {
    await expect(
      scope({
        drug: "x",
        indication: "y",
        drug_class: "small_molecule",
        jurisdictions: ["germany"] as never,
      }),
    ).rejects.toThrow(/de|jurisdictions/i);
  });

  it("defaults to DE/FR/IT/ES/NL when jurisdictions is omitted", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
    });
    const jx = r.pico_matrix.country_specific.map((c) => c.jurisdiction);
    expect(jx).toEqual(expect.arrayContaining(["de", "fr", "it", "es", "nl"]));
  });
});

// ---- Country coverage (all 5 v1 countries + UK) -------------------------

describe("jca_pico_scope — country coverage", () => {
  it("DE produces a non-empty comparator list for oncology", async () => {
    const r = await scope({
      drug: "osimertinib",
      indication: "non-small cell lung cancer",
      drug_class: "small_molecule",
      jurisdictions: ["de"],
    });
    const de = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "de",
    );
    expect(de?.hta_body).toMatch(/G-BA|IQWiG/);
    expect(de?.comparators.length).toBeGreaterThan(0);
  });

  it("FR produces a non-empty comparator list with HAS as the body", async () => {
    const r = await scope({
      drug: "osimertinib",
      indication: "non-small cell lung cancer",
      drug_class: "small_molecule",
      jurisdictions: ["fr"],
    });
    const fr = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "fr",
    );
    expect(fr?.hta_body).toBe("HAS");
    expect(fr?.comparators.length).toBeGreaterThan(0);
  });

  it("IT body is AIFA", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
      jurisdictions: ["it"],
    });
    expect(
      r.pico_matrix.country_specific.find((c) => c.jurisdiction === "it")
        ?.hta_body,
    ).toBe("AIFA");
  });

  it("ES body references AEMPS or RedETS", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
      jurisdictions: ["es"],
    });
    expect(
      r.pico_matrix.country_specific.find((c) => c.jurisdiction === "es")
        ?.hta_body,
    ).toMatch(/AEMPS|RedETS/);
  });

  it("NL body is Zorginstituut", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
      jurisdictions: ["nl"],
    });
    expect(
      r.pico_matrix.country_specific.find((c) => c.jurisdiction === "nl")
        ?.hta_body,
    ).toMatch(/Zorginstituut/);
  });

  it("UK is flagged as post-Brexit context only", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
      jurisdictions: ["uk"],
    });
    const uk = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "uk",
    );
    expect(uk?.hta_body).toMatch(/NICE/);
    expect(String(r.content)).toMatch(/post[- ]Brexit|context only/i);
  });

  it("eu_other returns a placeholder with consult-national-HTA note", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
      jurisdictions: ["eu_other"],
    });
    const other = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "eu_other",
    );
    expect(other).toBeDefined();
    expect(String(r.content)).toMatch(/consult.*national HTA/i);
  });
});

// ---- Heterogeneity warning ----------------------------------------------

describe("jca_pico_scope — heterogeneity warning", () => {
  it("fires when ≥3 distinct comparators across jurisdictions", async () => {
    // NSCLC 2L oncology — distinct SoC across DE/FR/IT/ES/NL
    const r = await scope({
      drug: "osimertinib",
      indication: "non-small cell lung cancer",
      drug_class: "small_molecule",
      line_of_therapy: "second_line",
      biomarker_status: "EGFR T790M positive",
      jurisdictions: ["de", "fr", "it", "es", "nl"],
    });
    expect(r.pico_matrix.distinct_comparator_count).toBeGreaterThanOrEqual(3);
    expect(r.pico_matrix.heterogeneity_warning).toBe(true);
  });

  it("does not fire with a single jurisdiction", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
      jurisdictions: ["de"],
    });
    expect(r.pico_matrix.heterogeneity_warning).toBe(false);
  });
});

// ---- Pre-authorisation handling ------------------------------------------

describe("jca_pico_scope — pre-authorisation context", () => {
  it("produces an anticipatory scope with a visible warning", async () => {
    const r = await scope({
      drug: "experimental_drug_x",
      indication: "obesity",
      drug_class: "small_molecule",
      regulatory_context: "pre_authorisation",
      jurisdictions: ["de", "fr"],
    });
    expect(r.pico_matrix.picos.length).toBeGreaterThan(0);
    expect(String(r.content)).toMatch(
      /anticipatory|protocol[- ]design|pre[- ]authorisation/i,
    );
  });
});

// ---- Outcome priorities --------------------------------------------------

describe("jca_pico_scope — outcome priorities", () => {
  it("oncology indications list OS as outcome #1", async () => {
    const r = await scope({
      drug: "osimertinib",
      indication: "non-small cell lung cancer",
      drug_class: "small_molecule",
      jurisdictions: ["de"],
    });
    const de = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "de",
    );
    expect(de?.outcome_priorities[0]).toBe("OS");
  });

  it("flags surrogate endpoints (PFS in oncology) as secondary", async () => {
    const r = await scope({
      drug: "osimertinib",
      indication: "non-small cell lung cancer",
      drug_class: "small_molecule",
      jurisdictions: ["de"],
    });
    expect(String(r.content)).toMatch(
      /surrogate.*secondary|PFS.*surrogate|JCA scrutiny/i,
    );
  });

  it("non-oncology indication lists patient-relevant outcomes (no OS-first rule)", async () => {
    const r = await scope({
      drug: "guselkumab",
      indication: "ulcerative colitis",
      drug_class: "monoclonal_antibody",
      jurisdictions: ["de"],
    });
    const de = r.pico_matrix.country_specific.find(
      (c) => c.jurisdiction === "de",
    );
    // For UC, OS is NOT the primary endpoint; remission / HRQoL is.
    expect(de?.outcome_priorities[0]).not.toBe("OS");
  });
});

// ---- Round-trip integration with hta_dossier ----------------------------

describe("jca_pico_scope — pico_matrix.picos pipes into hta_dossier", () => {
  it("output picos[] is accepted by hta_dossier({hta_body:'jca'}) without validation error", async () => {
    const scopeRes = await scope({
      drug: "osimertinib",
      indication: "non-small cell lung cancer",
      drug_class: "small_molecule",
      jurisdictions: ["de", "fr"],
    });
    const dossier = await handleHtaDossierPrep({
      hta_body: "jca",
      submission_type: "initial",
      drug_name: "osimertinib",
      indication: "non-small cell lung cancer",
      picos: scopeRes.pico_matrix.picos,
    });
    expect(typeof dossier.content).toBe("string");
    // Each PICO should appear in the JCA dossier output as a section header
    for (const pico of scopeRes.pico_matrix.picos) {
      expect(String(dossier.content)).toContain(pico.id);
    }
  });
});

// ---- Output content -----------------------------------------------------

describe("jca_pico_scope — output content", () => {
  it("markdown output names jca_revision for auditability", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
    });
    expect(r.content).toMatch(/2026-05|JCA_REVISION/);
  });

  it("markdown output includes a per-country comparator section", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
      jurisdictions: ["de", "fr"],
    });
    const t = String(r.content);
    expect(t).toMatch(/##.*Germany|G-BA/i);
    expect(t).toMatch(/##.*France|HAS/i);
  });

  it("references EU HTA Regulation 2021/2282", async () => {
    const r = await scope({
      drug: "x",
      indication: "y",
      drug_class: "small_molecule",
    });
    expect(String(r.content)).toMatch(/2021\/2282|HTA Regulation/i);
  });
});

// ---- Performance --------------------------------------------------------

describe("jca_pico_scope — performance", () => {
  it("returns in under 300ms", async () => {
    const start = Date.now();
    await scope({
      drug: "osimertinib",
      indication: "non-small cell lung cancer",
      drug_class: "small_molecule",
      jurisdictions: ["de", "fr", "it", "es", "nl"],
    });
    expect(Date.now() - start).toBeLessThan(300);
  });
});
