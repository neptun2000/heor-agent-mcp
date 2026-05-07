/**
 * Tests for evidence.unmet_need tool — design log #23
 *
 * TDD: tests written BEFORE implementation.
 * Run: npm test -- --testPathPattern=unmetNeed
 */

import {
  evidenceUnmetNeedHandler,
  evidenceUnmetNeedSchema,
  evidenceUnmetNeedToolSchema,
  type EvidenceUnmetNeedInput,
} from "../../src/tools/evidenceUnmetNeed.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const DRUG = "donanemab";
const INDICATION = "early symptomatic Alzheimer's disease";

const diseaseBurden = {
  incidence_per_100k: 600,
  prevalence_per_100k: 4500,
  annual_deaths: 120000,
  five_year_survival: 0.35,
  qualitative_summary: "AD is the leading cause of dementia globally.",
  citations: [
    {
      claim_anchor: "incidence",
      citation: "Alzheimer's Association 2024 Facts and Figures",
      url: "https://www.alz.org/facts",
    },
  ],
};

const treatmentLandscape = {
  current_soc: ["donepezil", "memantine"],
  response_rate_pct: 30,
  median_pfs_months: 18,
  treatment_failure_rate_pct: 55,
  discontinuation_rate_pct: 25,
  qualitative_summary: "Current SoC provides only symptomatic relief.",
  citations: [
    {
      claim_anchor: "response_rate",
      citation: "Schneider LS et al. N Engl J Med 2006",
      url: "https://www.nejm.org/doi/10.1056/NEJMoa061372",
    },
  ],
};

const qolImpact = {
  eq5d_decrement: -0.18,
  productivity_loss_pct: 40,
  caregiver_hours_per_week: 47,
  qualitative_summary: "Substantial caregiver burden documented.",
  citations: [
    {
      claim_anchor: "eq5d",
      citation: "Jones S et al. PharmacoEconomics 2020",
    },
  ],
};

const economicBurden = {
  annual_direct_cost_per_patient: 35000,
  annual_indirect_cost_per_patient: 18000,
  currency: "USD",
  qualitative_summary: "High total cost of illness due to care needs.",
  citations: [
    {
      claim_anchor: "direct_cost",
      citation: "Hurd MD et al. NEJM 2013",
      url: "https://www.nejm.org/doi/10.1056/NEJMsa1204629",
    },
  ],
};

const fullParams: EvidenceUnmetNeedInput = {
  drug: DRUG,
  indication: INDICATION,
  jurisdictions: ["us", "uk"],
  disease_burden: diseaseBurden,
  treatment_landscape: treatmentLandscape,
  qol_impact: qolImpact,
  economic_burden: economicBurden,
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("evidenceUnmetNeedHandler", () => {
  // Test 1: Basic call with all 4 dimensions — returns UnmetNeedResult with all fields
  it("returns UnmetNeedResult with all top-level fields when all 4 dimensions provided", async () => {
    const result = await evidenceUnmetNeedHandler(fullParams);

    expect(result.schema_version).toBe("1.0");
    expect(result.drug).toBe(DRUG);
    expect(result.indication).toBe(INDICATION);
    expect(result.jurisdictions).toEqual(["us", "uk"]);
    expect(result.disease_burden).toBeDefined();
    expect(result.treatment_landscape).toBeDefined();
    expect(result.qol_impact).toBeDefined();
    expect(result.economic_burden).toBeDefined();
    expect(result.markdown_section).toBeDefined();
    expect(result.unmet_need_summary).toBeDefined();
    expect(result.total_citations).toBeDefined();
    expect(result.gaps).toBeDefined();
  });

  // Test 2: Disease burden rendering
  it("renders incidence, prevalence, and five_year_survival in disease_burden.rendered", async () => {
    const result = await evidenceUnmetNeedHandler(fullParams);
    const rendered = result.disease_burden.rendered;

    expect(rendered).toContain("600");
    expect(rendered).toContain("4500");
    // five_year_survival 0.35 → 35.0%
    expect(rendered).toContain("35.0%");
  });

  // Test 3: Treatment landscape rendering
  it("renders SoC names and response rate in treatment_landscape.rendered", async () => {
    const result = await evidenceUnmetNeedHandler(fullParams);
    const rendered = result.treatment_landscape.rendered;

    expect(rendered).toContain("donepezil");
    expect(rendered).toContain("memantine");
    expect(rendered).toContain("30");
    expect(rendered).toContain("18");
  });

  // Test 4: QoL impact rendering
  it("renders EQ-5D decrement and productivity loss in qol_impact.rendered", async () => {
    const result = await evidenceUnmetNeedHandler(fullParams);
    const rendered = result.qol_impact.rendered;

    expect(rendered).toContain("0.18");
    expect(rendered).toContain("40");
    expect(rendered).toContain("47");
  });

  // Test 5: Economic burden rendering with currency
  it("renders cost with currency and indirect cost in economic_burden.rendered", async () => {
    const result = await evidenceUnmetNeedHandler(fullParams);
    const rendered = result.economic_burden.rendered;

    expect(rendered).toContain("35000");
    expect(rendered).toContain("18000");
    expect(rendered).toContain("USD");
  });

  // Test 6: Citation numbering globally across dimensions
  it("numbers citations globally 1..N across all dimensions", async () => {
    const result = await evidenceUnmetNeedHandler(fullParams);
    const md = result.markdown_section;

    // Each citation dimension has 1 citation → total 4 citations numbered 1-4
    expect(md).toContain("[<sup>1</sup>]");
    expect(md).toContain("[<sup>2</sup>]");
    expect(md).toContain("[<sup>3</sup>]");
    expect(md).toContain("[<sup>4</sup>]");
  });

  // Test 7: Citation URLs rendered in References section
  it("renders citation URLs in the References section of markdown_section", async () => {
    const result = await evidenceUnmetNeedHandler(fullParams);
    const md = result.markdown_section;

    expect(md).toContain("https://www.alz.org/facts");
    expect(md).toContain("https://www.nejm.org/doi/10.1056/NEJMoa061372");
    expect(md).toContain("https://www.nejm.org/doi/10.1056/NEJMsa1204629");
  });

  // Test 8: Gap detection — missing dimension produces gap entry
  it("produces gap entry when disease_burden is undefined", async () => {
    const params = { ...fullParams, disease_burden: undefined };
    const result = await evidenceUnmetNeedHandler(params);

    expect(result.gaps).toContain("disease_burden missing — no data provided");
    expect(result.disease_burden.gaps).toContain(
      "disease_burden missing — no data provided",
    );
  });

  // Test 9: Gap detection — qualitative-only with no citations and no quantitative
  it("flags gap when dimension has only qualitative_summary and no quantitative fields and no citations", async () => {
    const params = {
      ...fullParams,
      disease_burden: {
        qualitative_summary: "AD is a serious disease.",
        // no incidence, no prevalence, no citations
      },
    };
    const result = await evidenceUnmetNeedHandler(params);

    expect(result.disease_burden.gaps).toContain(
      "disease_burden missing quantitative or citation",
    );
  });

  // Test 10: unmet_need_summary is a non-empty 1-paragraph string containing drug and indication
  it("produces non-empty unmet_need_summary containing drug name and indication", async () => {
    const result = await evidenceUnmetNeedHandler(fullParams);
    const summary = result.unmet_need_summary;

    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(10);
    expect(summary.toLowerCase()).toContain(DRUG.toLowerCase());
    expect(summary.toLowerCase()).toContain("alzheimer");
  });

  // Test 11: markdown_section contains all 4 section headers
  it("markdown_section contains all 4 numbered section headers", async () => {
    const result = await evidenceUnmetNeedHandler(fullParams);
    const md = result.markdown_section;

    expect(md).toContain("### 1.");
    expect(md).toContain("### 2.");
    expect(md).toContain("### 3.");
    expect(md).toContain("### 4.");
  });

  // Test 12: markdown_section contains References section when citations supplied
  it("markdown_section contains a References section when citations are provided", async () => {
    const result = await evidenceUnmetNeedHandler(fullParams);
    const md = result.markdown_section;

    expect(md).toContain("### References");
    expect(md).toContain("Alzheimer's Association 2024 Facts and Figures");
    expect(md).toContain("Schneider LS et al.");
  });

  // Test 13: unmet_need_summary is a plain string (no markdown headers)
  it("unmet_need_summary contains no markdown headers (no # prefix)", async () => {
    const result = await evidenceUnmetNeedHandler(fullParams);
    const summary = result.unmet_need_summary;

    expect(summary).not.toMatch(/^#{1,6}\s/m);
  });

  // Test 14: total_citations deduplicates across dimensions
  it("total_citations deduplicates citations that appear in multiple dimensions", async () => {
    // Use same citation in two dimensions
    const sharedCitation = {
      claim_anchor: "shared",
      citation: "Shared Study 2024",
      url: "https://example.com/shared",
    };
    const params = {
      ...fullParams,
      disease_burden: {
        ...diseaseBurden,
        citations: [sharedCitation],
      },
      treatment_landscape: {
        ...treatmentLandscape,
        citations: [sharedCitation],
      },
    };
    const result = await evidenceUnmetNeedHandler(params);

    const sharedCount = result.total_citations.filter(
      (c) => c.citation === "Shared Study 2024",
    ).length;
    expect(sharedCount).toBe(1);
  });

  // Test 15: schema_version is "1.0"
  it('schema_version is "1.0"', async () => {
    const result = await evidenceUnmetNeedHandler(fullParams);
    expect(result.schema_version).toBe("1.0");
  });

  // Additional: markdown_section contains drug and indication in header
  it("markdown_section header contains drug and indication", async () => {
    const result = await evidenceUnmetNeedHandler(fullParams);
    const md = result.markdown_section;

    expect(md).toContain(DRUG);
    expect(md).toContain(INDICATION);
  });

  // Additional: dimension rendered strings include qualitative summaries
  it("renders qualitative_summary text in each dimension's rendered field", async () => {
    const result = await evidenceUnmetNeedHandler(fullParams);

    expect(result.disease_burden.rendered).toContain(
      "AD is the leading cause of dementia globally.",
    );
    expect(result.treatment_landscape.rendered).toContain(
      "Current SoC provides only symptomatic relief.",
    );
    expect(result.qol_impact.rendered).toContain(
      "Substantial caregiver burden documented.",
    );
    expect(result.economic_burden.rendered).toContain(
      "High total cost of illness due to care needs.",
    );
  });

  // Additional: no gaps when all dimensions provided with quantitative data
  it("produces empty gaps array when all 4 dimensions provided with quantitative data", async () => {
    const result = await evidenceUnmetNeedHandler(fullParams);
    expect(result.gaps).toHaveLength(0);
  });

  // Additional: annual_deaths renders in disease burden
  it("renders annual_deaths in disease_burden.rendered", async () => {
    const result = await evidenceUnmetNeedHandler(fullParams);
    expect(result.disease_burden.rendered).toContain("120000");
  });

  // Additional: median_pfs_months renders in treatment_landscape
  it("renders median_pfs_months in treatment_landscape.rendered", async () => {
    const result = await evidenceUnmetNeedHandler(fullParams);
    expect(result.treatment_landscape.rendered).toContain("18");
  });

  // Additional: all 4 missing dimensions → 4 gap entries
  it("produces 4 gap entries when all dimensions are undefined", async () => {
    const params: EvidenceUnmetNeedInput = {
      drug: DRUG,
      indication: INDICATION,
      jurisdictions: ["us"],
    };
    const result = await evidenceUnmetNeedHandler(params);

    expect(result.gaps).toHaveLength(4);
    expect(result.gaps).toContain("disease_burden missing — no data provided");
    expect(result.gaps).toContain(
      "treatment_landscape missing — no data provided",
    );
    expect(result.gaps).toContain("qol_impact missing — no data provided");
    expect(result.gaps).toContain("economic_burden missing — no data provided");
  });

  // Additional: default currency USD when not specified
  it("defaults to USD currency when not specified in economic_burden", async () => {
    const params = {
      ...fullParams,
      economic_burden: {
        annual_direct_cost_per_patient: 20000,
        // currency omitted → defaults to USD
      },
    };
    const result = await evidenceUnmetNeedHandler(params);
    expect(result.economic_burden.rendered).toContain("USD");
  });
});

// ─── Schema validation tests ──────────────────────────────────────────────────

describe("evidenceUnmetNeedSchema", () => {
  it("requires drug, indication, and jurisdictions (min 1)", () => {
    const result = evidenceUnmetNeedSchema.safeParse({
      drug: "test",
      indication: "test",
      jurisdictions: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid minimal params", () => {
    const result = evidenceUnmetNeedSchema.safeParse({
      drug: "lecanemab",
      indication: "early AD",
      jurisdictions: ["us"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts 'global' as a valid jurisdiction", () => {
    const result = evidenceUnmetNeedSchema.safeParse({
      drug: "x",
      indication: "y",
      jurisdictions: ["global"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid jurisdiction enum values", () => {
    const result = evidenceUnmetNeedSchema.safeParse({
      drug: "x",
      indication: "y",
      jurisdictions: ["ca"], // not in enum
    });
    expect(result.success).toBe(false);
  });

  it("validates five_year_survival is between 0 and 1", () => {
    const result = evidenceUnmetNeedSchema.safeParse({
      drug: "x",
      indication: "y",
      jurisdictions: ["us"],
      disease_burden: { five_year_survival: 1.5 },
    });
    expect(result.success).toBe(false);
  });
});

// ─── Tool schema tests ────────────────────────────────────────────────────────

describe("evidenceUnmetNeedToolSchema", () => {
  it("has name 'evidence.unmet_need'", () => {
    expect(evidenceUnmetNeedToolSchema.name).toBe("evidence.unmet_need");
  });

  it("has a description string", () => {
    expect(typeof evidenceUnmetNeedToolSchema.description).toBe("string");
    expect(evidenceUnmetNeedToolSchema.description.length).toBeGreaterThan(10);
  });

  it("has inputSchema with required fields: drug, indication, jurisdictions", () => {
    const schema = evidenceUnmetNeedToolSchema.inputSchema as {
      required: string[];
    };
    expect(schema.required).toContain("drug");
    expect(schema.required).toContain("indication");
    expect(schema.required).toContain("jurisdictions");
  });
});
