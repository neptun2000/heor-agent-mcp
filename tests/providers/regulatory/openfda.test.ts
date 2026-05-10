/**
 * Tests for OpenFDA drug label client.
 *
 * All network calls are mocked — unit tests only.
 * Integration smoke test lives in bench/runs/run_regulatory_status_smoke.mjs.
 */

import {
  buildOpenFdaUrl,
  parseOpenFdaResult,
  fetchOpenFdaLabel,
} from "../../../src/providers/regulatory/openfda.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

const FREMANEZUMAB_FIXTURE = {
  meta: {
    results: {
      total: 1,
    },
  },
  results: [
    {
      effective_time: "20250808",
      indications_and_usage: [
        "1 INDICATIONS AND USAGE\n\nAJOVY is a calcitonin gene-related peptide antagonist indicated for:\n1.1 Preventive Treatment of Migraine in Adults\nPreventive treatment of episodic or chronic migraine in adults.\n1.2 Preventive Treatment of Episodic Migraine in Pediatric Patients\nPreventive treatment of episodic migraine in pediatric patients aged 6 to 17 years weighing 45 kg or more.",
      ],
      contraindications: [
        "Hypersensitivity to fremanezumab-vfrm or any excipients.",
      ],
      warnings_and_cautions: [
        "Hypersensitivity Reactions: Discontinue and treat appropriately if serious hypersensitivity reaction occurs.",
      ],
      boxed_warning: [],
      pediatric_use: [
        "8.4 Pediatric Use\nThe safety and effectiveness of AJOVY for the preventive treatment of episodic migraine have been established in pediatric patients aged 6 to 17 years weighing 45 kg or more.",
      ],
      openfda: {
        generic_name: ["fremanezumab-vfrm"],
        brand_name: ["AJOVY"],
        substance_name: ["FREMANEZUMAB"],
        application_number: ["BLA761089"],
        product_type: ["HUMAN PRESCRIPTION DRUG"],
        route: ["SUBCUTANEOUS"],
        manufacturer_name: ["Test Pharma Corp."],
      },
    },
  ],
};

const EMPTY_RESULT_FIXTURE = {
  meta: {
    results: {
      total: 0,
    },
  },
  results: [],
};

// ── URL builder tests ──────────────────────────────────────────────────────

describe("buildOpenFdaUrl — query string construction", () => {
  it("builds URL for generic_name search", () => {
    const url = buildOpenFdaUrl("fremanezumab", "generic_name");
    expect(url).toContain("api.fda.gov/drug/label.json");
    expect(url).toContain("openfda.generic_name");
    expect(url).toContain("fremanezumab");
    expect(url).toContain("limit=5");
  });

  it("builds URL for brand_name search", () => {
    const url = buildOpenFdaUrl("Ajovy", "brand_name");
    expect(url).toContain("openfda.brand_name");
    expect(url).toContain("Ajovy");
  });

  it("builds URL for substance_name search", () => {
    const url = buildOpenFdaUrl("FREMANEZUMAB", "substance_name");
    expect(url).toContain("openfda.substance_name");
  });

  it("URL-encodes special characters in drug name", () => {
    const url = buildOpenFdaUrl("drug name with spaces", "generic_name");
    expect(url).not.toContain(" ");
  });

  it("appends API key when OPENFDA_API_KEY env var is set", () => {
    const original = process.env.OPENFDA_API_KEY;
    process.env.OPENFDA_API_KEY = "test-api-key-123";
    const url = buildOpenFdaUrl("fremanezumab", "generic_name");
    expect(url).toContain("api_key=test-api-key-123");
    process.env.OPENFDA_API_KEY = original;
  });
});

// ── Result parser tests ────────────────────────────────────────────────────

describe("parseOpenFdaResult — approved indications extraction", () => {
  it("returns empty array for empty results", () => {
    const indications = parseOpenFdaResult(EMPTY_RESULT_FIXTURE);
    expect(indications.approved_indications).toEqual([]);
    expect(indications.current_status).toBe("unknown");
  });

  it("extracts at least one indication from fremanezumab fixture", () => {
    const parsed = parseOpenFdaResult(FREMANEZUMAB_FIXTURE);
    expect(parsed.approved_indications.length).toBeGreaterThan(0);
    expect(parsed.current_status).toBe("approved");
  });

  it("indication_text_verbatim is always non-empty when status=approved", () => {
    const parsed = parseOpenFdaResult(FREMANEZUMAB_FIXTURE);
    for (const ind of parsed.approved_indications) {
      expect(typeof ind.indication_text_verbatim).toBe("string");
      expect(ind.indication_text_verbatim.length).toBeGreaterThan(0);
    }
  });

  it("extracts pediatric indication from fremanezumab fixture", () => {
    const parsed = parseOpenFdaResult(FREMANEZUMAB_FIXTURE);
    const pedInd = parsed.approved_indications.find((i) =>
      i.indication_text_verbatim.toLowerCase().includes("pediatric"),
    );
    expect(pedInd).toBeDefined();
  });

  it("extracts brand names from openfda.brand_name", () => {
    const parsed = parseOpenFdaResult(FREMANEZUMAB_FIXTURE);
    expect(parsed.drug_brand_names).toContain("AJOVY");
  });

  it("extracts INN from openfda fields", () => {
    const parsed = parseOpenFdaResult(FREMANEZUMAB_FIXTURE);
    expect(parsed.drug_normalised_inn.toLowerCase()).toContain("fremanezumab");
  });
});

describe("parseOpenFdaResult — black box warnings", () => {
  it("returns empty black_box_warnings array when no boxed_warning", () => {
    const parsed = parseOpenFdaResult(FREMANEZUMAB_FIXTURE);
    // fremanezumab fixture has empty boxed_warning
    expect(Array.isArray(parsed.black_box_warnings)).toBe(true);
  });

  it("extracts black_box_warnings when present", () => {
    const fixtureWithBBW = {
      ...FREMANEZUMAB_FIXTURE,
      results: [
        {
          ...FREMANEZUMAB_FIXTURE.results[0],
          boxed_warning: [
            "WARNING: SERIOUS ADVERSE EFFECTS\nDescription of serious adverse effects here.",
          ],
        },
      ],
    };
    const parsed = parseOpenFdaResult(fixtureWithBBW);
    expect(parsed.black_box_warnings.length).toBeGreaterThan(0);
    expect(parsed.black_box_warnings[0].heading).toBeTruthy();
    expect(parsed.black_box_warnings[0].text_verbatim).toBeTruthy();
  });
});

describe("parseOpenFdaResult — REMS detection", () => {
  it("rems_required is false when no REMS mention in warnings", () => {
    const parsed = parseOpenFdaResult(FREMANEZUMAB_FIXTURE);
    expect(parsed.rems_required).toBe(false);
  });

  it("rems_required is true when warnings contain REMS", () => {
    const fixtureWithREMS = {
      ...FREMANEZUMAB_FIXTURE,
      results: [
        {
          ...FREMANEZUMAB_FIXTURE.results[0],
          warnings_and_cautions: [
            "REMS program required. Risk Evaluation and Mitigation Strategy for prescribers.",
          ],
        },
      ],
    };
    const parsed = parseOpenFdaResult(fixtureWithREMS);
    expect(parsed.rems_required).toBe(true);
  });
});

describe("parseOpenFdaResult — contraindications", () => {
  it("extracts contraindications array", () => {
    const parsed = parseOpenFdaResult(FREMANEZUMAB_FIXTURE);
    expect(Array.isArray(parsed.contraindications)).toBe(true);
    expect(parsed.contraindications.length).toBeGreaterThan(0);
  });
});

describe("parseOpenFdaResult — label revision date", () => {
  it("extracts effective_time as YYYY-MM-DD", () => {
    const parsed = parseOpenFdaResult(FREMANEZUMAB_FIXTURE);
    expect(parsed.recent_label_changes.last_revision_date).toBe("2025-08-08");
  });

  it("count_12_months is a number >= 0", () => {
    const parsed = parseOpenFdaResult(FREMANEZUMAB_FIXTURE);
    expect(typeof parsed.recent_label_changes.count_12_months).toBe("number");
    expect(parsed.recent_label_changes.count_12_months).toBeGreaterThanOrEqual(
      0,
    );
  });
});

// ── fetchOpenFdaLabel — network error handling ────────────────────────────

describe("fetchOpenFdaLabel — error handling (mocked fetch)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns null (not throw) when API returns 404", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
    }) as unknown as typeof fetch;

    const result = await fetchOpenFdaLabel("totally-fake-drug-xyz");
    expect(result).toBeNull();
  });

  it("throws with retry_after_seconds on 429 rate limit", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: {
        get: (h: string) => (h.toLowerCase() === "retry-after" ? "60" : null),
      },
    }) as unknown as typeof fetch;

    await expect(fetchOpenFdaLabel("fremanezumab")).rejects.toMatchObject({
      retry_after_seconds: 60,
    });
  });

  it("throws on 5xx server error with retry_after_seconds", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
    }) as unknown as typeof fetch;

    await expect(fetchOpenFdaLabel("fremanezumab")).rejects.toMatchObject({
      retry_after_seconds: expect.any(Number),
    });
  });

  it("returns parsed result on 200 OK with valid JSON", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FREMANEZUMAB_FIXTURE,
      headers: { get: () => null },
    }) as unknown as typeof fetch;

    const result = await fetchOpenFdaLabel("fremanezumab");
    expect(result).not.toBeNull();
    expect(result!.current_status).toBe("approved");
  });
});
