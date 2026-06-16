import {
  handleTrialEnrollmentCriteria,
  trialEnrollmentCriteriaToolSchema,
} from "../../src/tools/trialEnrollmentCriteria.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_NCT = "NCT04184622";

function makeStudy(overrides: Record<string, unknown> = {}): unknown {
  return {
    protocolSection: {
      identificationModule: {
        nctId: VALID_NCT,
        briefTitle: "SURMOUNT-1: A Study of Tirzepatide",
        officialTitle: "A Randomised, Double-blind, Placebo-controlled Trial",
      },
      designModule: {
        studyType: "INTERVENTIONAL",
        phases: ["PHASE3"],
        enrollmentInfo: { count: 2539, type: "ACTUAL" },
      },
      eligibilityModule: {
        eligibilityCriteria:
          "Inclusion Criteria:\n- BMI ≥30 kg/m²\n- Age ≥18 years\n\nExclusion Criteria:\n- Type 2 diabetes mellitus\n- Prior bariatric surgery",
        sex: "ALL",
        minimumAge: "18 Years",
        maximumAge: "N/A",
        healthyVolunteers: false,
      },
      outcomesModule: {
        primaryOutcomes: [
          {
            measure: "Change in body weight (%)",
            timeFrame: "72 weeks",
            description: "Percent change from baseline",
          },
        ],
      },
      conditionsModule: {
        conditions: ["Obesity"],
        keywords: ["GLP-1", "GIP", "tirzepatide"],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Schema / registration
// ---------------------------------------------------------------------------

describe("trialEnrollmentCriteriaToolSchema", () => {
  it("has the correct MCP tool name", () => {
    expect(trialEnrollmentCriteriaToolSchema.name).toBe(
      "trial.enrollment_criteria",
    );
  });

  it("requires nct_id property", () => {
    expect(
      trialEnrollmentCriteriaToolSchema.inputSchema.required,
    ).toContain("nct_id");
  });

  it("validates NCT pattern in inputSchema", () => {
    expect(
      (trialEnrollmentCriteriaToolSchema.inputSchema.properties as Record<string, {pattern?: string}>)
        .nct_id?.pattern,
    ).toBe("^NCT\\d{8}$");
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe("handleTrialEnrollmentCriteria — input validation", () => {
  it("rejects a missing nct_id", async () => {
    await expect(handleTrialEnrollmentCriteria({})).rejects.toThrow();
  });

  it("rejects a malformed NCT ID (wrong prefix)", async () => {
    await expect(
      handleTrialEnrollmentCriteria({ nct_id: "XYZ12345678" }),
    ).rejects.toThrow();
  });

  it("rejects a short NCT ID (7 digits)", async () => {
    await expect(
      handleTrialEnrollmentCriteria({ nct_id: "NCT0418462" }),
    ).rejects.toThrow();
  });

  it("rejects a long NCT ID (9 digits)", async () => {
    await expect(
      handleTrialEnrollmentCriteria({ nct_id: "NCT041846220" }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Happy-path rendering (fetch mocked)
// ---------------------------------------------------------------------------

describe("handleTrialEnrollmentCriteria — rendering", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(body: unknown, status = 200): void {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response);
  }

  it("returns structured markdown with all sections", async () => {
    mockFetch(makeStudy());
    const result = await handleTrialEnrollmentCriteria({ nct_id: VALID_NCT });
    const text = result.content as string;

    expect(text).toContain("## Trial Identity");
    expect(text).toContain("## Study Design");
    expect(text).toContain("## Eligibility Criteria");
    expect(text).toContain("### Inclusion");
    expect(text).toContain("### Exclusion");
    expect(text).toContain("## Primary Outcomes");
    expect(text).toContain("## Audit");
  });

  it("includes the NCT ID and brief title", async () => {
    mockFetch(makeStudy());
    const result = await handleTrialEnrollmentCriteria({ nct_id: VALID_NCT });
    const text = result.content as string;

    expect(text).toContain(VALID_NCT);
    expect(text).toContain("SURMOUNT-1");
  });

  it("splits inclusion and exclusion criteria correctly", async () => {
    mockFetch(makeStudy());
    const result = await handleTrialEnrollmentCriteria({ nct_id: VALID_NCT });
    const text = result.content as string;

    expect(text).toContain("BMI ≥30 kg/m²");
    expect(text).toContain("Type 2 diabetes mellitus");
  });

  it("formats enrollment count with type", async () => {
    mockFetch(makeStudy());
    const result = await handleTrialEnrollmentCriteria({ nct_id: VALID_NCT });
    const text = result.content as string;

    expect(text).toContain("2539 (ACTUAL)");
  });

  it("renders primary outcome with measure and time frame", async () => {
    mockFetch(makeStudy());
    const result = await handleTrialEnrollmentCriteria({ nct_id: VALID_NCT });
    const text = result.content as string;

    expect(text).toContain("Change in body weight");
    expect(text).toContain("72 weeks");
  });

  it("includes audit block with tool name and status ok", async () => {
    mockFetch(makeStudy());
    const result = await handleTrialEnrollmentCriteria({ nct_id: VALID_NCT });
    const text = result.content as string;

    expect(text).toContain("trial.enrollment_criteria");
    expect(text).toContain("**Status:** ok");
  });

  it("returns audit object alongside content", async () => {
    mockFetch(makeStudy());
    const result = await handleTrialEnrollmentCriteria({ nct_id: VALID_NCT });

    expect(result.audit).toBeDefined();
    expect(result.audit?.tool).toBe("trial.enrollment_criteria");
  });
});

// ---------------------------------------------------------------------------
// Error / missing-data paths
// ---------------------------------------------------------------------------

describe("handleTrialEnrollmentCriteria — error paths", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns not-found message on HTTP 404", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as unknown as Response);

    const result = await handleTrialEnrollmentCriteria({ nct_id: VALID_NCT });
    const text = result.content as string;

    expect(text).toContain(VALID_NCT);
    expect(text).toContain("not found");
  });

  it("returns not-found message when protocolSection is absent", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as unknown as Response);

    const result = await handleTrialEnrollmentCriteria({ nct_id: VALID_NCT });
    const text = result.content as string;

    expect(text).toContain(VALID_NCT);
    expect(text).toContain("not found");
  });

  it("returns not-found message on network error", async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

    const result = await handleTrialEnrollmentCriteria({ nct_id: VALID_NCT });
    const text = result.content as string;

    expect(text).toContain(VALID_NCT);
  });

  it("handles missing eligibility criteria gracefully", async () => {
    const study = makeStudy() as { protocolSection: { eligibilityModule: Record<string, unknown> } };
    study.protocolSection.eligibilityModule = {};
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => study,
    } as unknown as Response);

    const result = await handleTrialEnrollmentCriteria({ nct_id: VALID_NCT });
    const text = result.content as string;

    expect(text).toContain("Not reported in ClinicalTrials.gov record.");
  });

  it("handles missing primary outcomes gracefully", async () => {
    const study = makeStudy() as { protocolSection: { outcomesModule: Record<string, unknown> } };
    study.protocolSection.outcomesModule = {};
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => study,
    } as unknown as Response);

    const result = await handleTrialEnrollmentCriteria({ nct_id: VALID_NCT });
    const text = result.content as string;

    expect(text).toContain("Not reported in ClinicalTrials.gov record.");
  });
});

// ---------------------------------------------------------------------------
// Eligibility splitting edge cases
// ---------------------------------------------------------------------------

describe("handleTrialEnrollmentCriteria — criteria splitting", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockWithCriteria(criteria: string): void {
    const study = makeStudy() as { protocolSection: { eligibilityModule: { eligibilityCriteria: string } } };
    study.protocolSection.eligibilityModule.eligibilityCriteria = criteria;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => study,
    } as unknown as Response);
  }

  it("splits exclusion-only criteria without crashing", async () => {
    mockWithCriteria("Exclusion Criteria:\n- Prior bariatric surgery");
    const result = await handleTrialEnrollmentCriteria({ nct_id: VALID_NCT });
    const text = result.content as string;

    expect(text).toContain("Prior bariatric surgery");
    expect(text).toContain("Not separately reported");
  });

  it("handles criteria with no heading (entire blob → inclusion)", async () => {
    mockWithCriteria("BMI ≥30 kg/m²\nAge ≥18 years");
    const result = await handleTrialEnrollmentCriteria({ nct_id: VALID_NCT });
    const text = result.content as string;

    expect(text).toContain("BMI ≥30 kg/m²");
  });
});
