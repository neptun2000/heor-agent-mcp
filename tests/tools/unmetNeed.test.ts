/**
 * Tests for evidence.unmet_need tool — design log #23 + #26
 *
 * TDD: tests written BEFORE implementation.
 * Run: npm test -- --testPathPattern=unmetNeed
 */

// ── Mock autoCheckRegulatory for design log #26 tests ─────────────────────

const mockAutoCheckRegulatory = jest.fn();

jest.mock("../../src/providers/regulatory/autoCheck.js", () => ({
  autoCheckRegulatory: mockAutoCheckRegulatory,
}));

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

// Reset mock before each test so auto-wire tests don't bleed into other tests
beforeEach(() => {
  mockAutoCheckRegulatory.mockReset();
  // Default: return empty (no auto-wire calls) — individual tests override as needed
  mockAutoCheckRegulatory.mockResolvedValue([]);
});

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

  it("flags uncited treatment landscape/regulatory status claims as gaps", async () => {
    const params: EvidenceUnmetNeedInput = {
      drug: "fremanezumab",
      indication: "pediatric episodic migraine",
      jurisdictions: ["us"],
      treatment_landscape: {
        current_soc: ["topiramate", "amitriptyline", "CGRP mAbs"],
        qualitative_summary: "CGRP mAbs have no approved pediatric indication.",
      },
    };

    const result = await evidenceUnmetNeedHandler(params);

    expect(result.treatment_landscape.gaps).toContain(
      "treatment_landscape current_soc/regulatory status needs citation support",
    );
    expect(result.unmet_need_summary).toContain("require citation support");
    expect(result.unmet_need_summary).not.toContain(
      "has documented limitations",
    );
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

  it("#26: inputSchema has auto_check_regulatory boolean property", () => {
    const schema = evidenceUnmetNeedToolSchema.inputSchema as {
      properties: Record<string, { type: string; default?: unknown }>;
    };
    expect(schema.properties["auto_check_regulatory"]).toBeDefined();
    expect(schema.properties["auto_check_regulatory"].type).toBe("boolean");
  });
});

// ─── Design log #26: auto-wire regulatory.status_check tests ─────────────────

describe("evidenceUnmetNeedHandler — design log #26 auto-wire regulatory", () => {
  // Shared approved result for fremanezumab
  const fremAutoCheckResult = {
    drug: "fremanezumab",
    region: "us",
    result: {
      schema_version: "1.0" as const,
      drug: "fremanezumab",
      drug_normalised_inn: "fremanezumab",
      drug_brand_names: ["Ajovy"],
      region: "us",
      current_status: "approved" as const,
      approved_indications: [
        {
          indication_text_verbatim:
            "1 INDICATIONS AND USAGE\nFREMANEZUMAB-VFRM is indicated for the preventive treatment of episodic migraine in pediatric patients 6 to 17 years of age who weigh 45 kg or more.",
          indication_parsed:
            "preventive treatment of episodic migraine (pediatric 6-17y)",
          population:
            "pediatric patients 6 to 17 years of age who weigh 45 kg or more",
          population_parsed: {
            age_min_years: 6,
            age_max_years: 17,
            weight_constraint_kg: 45,
            sex_constraint: null,
          },
          approval_date: "2025-08-05",
          label_revision: null,
          region_specific: false,
        },
      ],
      black_box_warnings: [],
      rems_required: false,
      contraindications: [],
      recent_label_changes: {
        count_12_months: 1,
        last_revision_date: "2025-08-05",
        last_revision_summary: "Pediatric sBLA approval",
      },
      source_urls: [
        {
          source: "OpenFDA",
          url: "https://api.fda.gov/drug/label.json?search=openfda.generic_name%3A%22fremanezumab%22&limit=5",
          fetched_at: "2026-05-10T00:00:00Z",
        },
      ],
      data_fetched_at: "2026-05-10T00:00:00Z",
      data_age_hours: 0,
      cache_hit: false,
    },
  };

  // ── Test #26-1: default call → regulatory_context populated ──────────────

  it("#26-1: default call with fremanezumab in current_soc populates regulatory_context", async () => {
    mockAutoCheckRegulatory.mockResolvedValueOnce([fremAutoCheckResult]);

    const result = await evidenceUnmetNeedHandler({
      drug: "alternative-cgrp-x",
      indication: "pediatric migraine",
      jurisdictions: ["us"],
      treatment_landscape: {
        current_soc: ["fremanezumab"],
        qualitative_summary: "CGRP mAbs are emerging SoC.",
      },
    });

    expect(result.regulatory_context).toBeDefined();
    expect(result.regulatory_context!.length).toBe(1);
    expect(result.regulatory_context![0].drug).toBe("fremanezumab");
    expect(result.regulatory_context![0].region).toBe("us");
    expect(result.regulatory_context![0].status).toBe("approved");
  });

  // ── Test #26-2: auto_check_regulatory:false → pre-v1.10.1 output ─────────

  it("#26-2: auto_check_regulatory:false returns output without regulatory_context", async () => {
    const result = await evidenceUnmetNeedHandler({
      drug: "alternative-cgrp-x",
      indication: "pediatric migraine",
      jurisdictions: ["us"],
      treatment_landscape: {
        current_soc: ["fremanezumab"],
        qualitative_summary: "CGRP mAbs are emerging SoC.",
      },
      auto_check_regulatory: false,
    });

    // autoCheckRegulatory must NOT have been called
    expect(mockAutoCheckRegulatory).not.toHaveBeenCalled();
    // No regulatory_context field
    expect(result.regulatory_context).toBeUndefined();
    // No "Per FDA/OpenFDA" text injected
    expect(result.treatment_landscape.rendered).not.toContain(
      "Per FDA/OpenFDA",
    );
  });

  // ── Test #26-3: api_error → graceful degradation ──────────────────────────

  it("#26-3: api_error → gap entry added, dossier proceeds, regulatory_context has status=api_error", async () => {
    const apiErrorResult = {
      drug: "topiramate",
      region: "uk",
      result: {
        schema_version: "1.0" as const,
        drug: "topiramate",
        drug_normalised_inn: "topiramate",
        drug_brand_names: [],
        region: "uk",
        current_status: "api_error" as const,
        approved_indications: [],
        black_box_warnings: [],
        rems_required: false,
        contraindications: [],
        recent_label_changes: {
          count_12_months: 0,
          last_revision_date: null,
          last_revision_summary: null,
        },
        source_urls: [],
        data_fetched_at: "2026-05-10T00:00:00Z",
        data_age_hours: 0,
        cache_hit: false,
        api_error: {
          source: "UK eMC",
          message: "UK eMC API not available",
          retry_after_seconds: 0,
        },
      },
    };

    mockAutoCheckRegulatory.mockResolvedValueOnce([apiErrorResult]);

    const result = await evidenceUnmetNeedHandler({
      drug: "drug-x",
      indication: "headache",
      jurisdictions: ["uk"],
      treatment_landscape: {
        current_soc: ["topiramate"],
        qualitative_summary: "Topiramate is first-line.",
      },
    });

    // Dossier still rendered (no throw)
    expect(result.markdown_section).toBeDefined();
    expect(result.markdown_section.length).toBeGreaterThan(0);

    // regulatory_context has the error entry
    expect(result.regulatory_context).toBeDefined();
    expect(result.regulatory_context![0].status).toBe("api_error");

    // gap entry for api_error
    const apiErrorGap = result.gaps.find(
      (g) => g.includes("topiramate") && g.includes("verify label manually"),
    );
    expect(apiErrorGap).toBeDefined();
  });

  // ── Test #26-4: unknown status → gap includes did_you_mean ───────────────

  it("#26-4: unknown status → gap entry includes did_you_mean suggestions", async () => {
    const unknownResult = {
      drug: "topiramte", // typo
      region: "us",
      result: {
        schema_version: "1.0" as const,
        drug: "topiramte",
        drug_normalised_inn: "topiramte",
        drug_brand_names: [],
        region: "us",
        current_status: "unknown" as const,
        approved_indications: [],
        black_box_warnings: [],
        rems_required: false,
        contraindications: [],
        recent_label_changes: {
          count_12_months: 0,
          last_revision_date: null,
          last_revision_summary: null,
        },
        source_urls: [],
        data_fetched_at: "2026-05-10T00:00:00Z",
        data_age_hours: 0,
        cache_hit: false,
        did_you_mean: ["topiramate", "topamax", "topiramax"],
      },
    };

    mockAutoCheckRegulatory.mockResolvedValueOnce([unknownResult]);

    const result = await evidenceUnmetNeedHandler({
      drug: "drug-x",
      indication: "epilepsy",
      jurisdictions: ["us"],
      treatment_landscape: {
        current_soc: ["topiramte"],
        qualitative_summary: "Current SoC includes topiramate.",
      },
    });

    // Gap entry for unknown
    const unknownGap = result.gaps.find(
      (g) =>
        g.includes("topiramte") &&
        g.includes("not found") &&
        g.includes("primary-source verification needed"),
    );
    expect(unknownGap).toBeDefined();

    // did_you_mean included in gap
    expect(unknownGap).toContain("topiramate");
  });

  // ── Test #26-5: multiple jurisdictions → fan-out across us + eu ──────────

  it("#26-5: jurisdictions=[us,de] fans out across us + eu, both in regulatory_context", async () => {
    const usResult = { ...fremAutoCheckResult };
    const euResult = {
      drug: "fremanezumab",
      region: "eu",
      result: {
        schema_version: "1.0" as const,
        drug: "fremanezumab",
        drug_normalised_inn: "fremanezumab",
        drug_brand_names: ["Ajovy"],
        region: "eu",
        current_status: "approved" as const,
        approved_indications: [
          {
            indication_text_verbatim:
              "Fremanezumab is indicated for prophylaxis of migraine in adults.",
            population: "adults",
            population_parsed: null,
            approval_date: "2019-04",
            label_revision: null,
            region_specific: false,
          },
        ],
        black_box_warnings: [],
        rems_required: false,
        contraindications: [],
        recent_label_changes: {
          count_12_months: 0,
          last_revision_date: null,
          last_revision_summary: null,
        },
        source_urls: [
          {
            source: "EMA EPI",
            url: "https://www.ema.europa.eu/epi/fremanezumab",
            fetched_at: "2026-05-10T00:00:00Z",
          },
        ],
        data_fetched_at: "2026-05-10T00:00:00Z",
        data_age_hours: 0,
        cache_hit: false,
      },
    };

    mockAutoCheckRegulatory.mockResolvedValueOnce([usResult, euResult]);

    const result = await evidenceUnmetNeedHandler({
      drug: "alternative-x",
      indication: "migraine",
      jurisdictions: ["us", "de"], // de → eu region
      treatment_landscape: {
        current_soc: ["fremanezumab"],
        qualitative_summary: "CGRP mAbs are SoC.",
      },
    });

    expect(result.regulatory_context).toBeDefined();
    expect(result.regulatory_context!.length).toBe(2);

    const usEntry = result.regulatory_context!.find((r) => r.region === "us");
    const euEntry = result.regulatory_context!.find((r) => r.region === "eu");
    expect(usEntry).toBeDefined();
    expect(euEntry).toBeDefined();
  });

  // ── Test #26-6: citations auto-registered into total_citations ────────────

  it("#26-6: approved result → source_url auto-registered into total_citations", async () => {
    mockAutoCheckRegulatory.mockResolvedValueOnce([fremAutoCheckResult]);

    const result = await evidenceUnmetNeedHandler({
      drug: "alternative-cgrp-x",
      indication: "pediatric migraine",
      jurisdictions: ["us"],
      treatment_landscape: {
        current_soc: ["fremanezumab"],
        qualitative_summary: "CGRP mAbs are SoC.",
      },
    });

    // The OpenFDA source URL should appear in total_citations
    const openFdaCitation = result.total_citations.find(
      (c) => c.url && c.url.includes("api.fda.gov"),
    );
    expect(openFdaCitation).toBeDefined();
  });

  // ── Test #26-7: approved → rendered text includes "Per FDA/OpenFDA label" ─

  it("#26-7: approved result → rendered treatment_landscape includes verbatim label line", async () => {
    mockAutoCheckRegulatory.mockResolvedValueOnce([fremAutoCheckResult]);

    const result = await evidenceUnmetNeedHandler({
      drug: "alternative-cgrp-x",
      indication: "pediatric migraine",
      jurisdictions: ["us"],
      treatment_landscape: {
        current_soc: ["fremanezumab"],
        qualitative_summary: "CGRP mAbs are SoC.",
      },
    });

    expect(result.treatment_landscape.rendered).toContain(
      "Per FDA/OpenFDA label retrieved",
    );
    expect(result.treatment_landscape.rendered).toContain("fremanezumab");
  });

  // ── Test #26-8: no current_soc → autoCheckRegulatory not called ──────────

  it("#26-8: no treatment_landscape → autoCheckRegulatory not called (nothing to check)", async () => {
    const result = await evidenceUnmetNeedHandler({
      drug: "drug-x",
      indication: "condition-y",
      jurisdictions: ["us"],
      // no treatment_landscape
    });

    expect(mockAutoCheckRegulatory).not.toHaveBeenCalled();
    expect(result.regulatory_context).toBeUndefined();
  });
});
