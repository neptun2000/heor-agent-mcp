/**
 * Tests for regulatory.status_check — primary-source regulatory lookup tool.
 *
 * Design log #25. Target: tool #27 in HEORAgent (v1.7.0).
 *
 * CRITICAL INVARIANTS:
 * - current_status NEVER equals "not_approved" — only "unknown" on absence
 * - approved_indications[].indication_text_verbatim is always non-empty when status="approved"
 * - source_urls[] is non-empty when status="approved"
 * - UK region returns api_error (deferred to v1.7.1)
 *
 * All external network calls are mocked. Facts about specific drugs are NOT
 * hard-coded — mocks drive the test data to prevent staleness.
 */

import { handleRegulatoryStatusCheck } from "../../src/tools/regulatoryStatusCheck.js";
import type { RegulatoryStatusResult } from "../../src/providers/regulatory/types.js";

// ── Mock the regulatory provider modules ──────────────────────────────────

jest.mock("../../src/providers/regulatory/openfda.js", () => ({
  fetchOpenFdaLabel: jest.fn(),
  buildOpenFdaUrl: jest.requireActual(
    "../../src/providers/regulatory/openfda.js",
  ).buildOpenFdaUrl,
  parseOpenFdaResult: jest.requireActual(
    "../../src/providers/regulatory/openfda.js",
  ).parseOpenFdaResult,
}));

jest.mock("../../src/providers/regulatory/dailymed.js", () => ({
  fetchDailyMedCrossCheck: jest.fn(),
  buildDailyMedSearchUrl: jest.requireActual(
    "../../src/providers/regulatory/dailymed.js",
  ).buildDailyMedSearchUrl,
  parseDailyMedSearchResponse: jest.requireActual(
    "../../src/providers/regulatory/dailymed.js",
  ).parseDailyMedSearchResponse,
}));

jest.mock("../../src/providers/regulatory/emaEpi.js", () => ({
  fetchEmaEpiLabel: jest.fn(),
  parseFhirBundle: jest.requireActual(
    "../../src/providers/regulatory/emaEpi.js",
  ).parseFhirBundle,
}));

import { fetchOpenFdaLabel } from "../../src/providers/regulatory/openfda.js";
import { fetchDailyMedCrossCheck } from "../../src/providers/regulatory/dailymed.js";
import { fetchEmaEpiLabel } from "../../src/providers/regulatory/emaEpi.js";

const mockFetchOpenFdaLabel = fetchOpenFdaLabel as jest.MockedFunction<
  typeof fetchOpenFdaLabel
>;
const mockFetchDailyMedCrossCheck =
  fetchDailyMedCrossCheck as jest.MockedFunction<
    typeof fetchDailyMedCrossCheck
  >;
const mockFetchEmaEpiLabel = fetchEmaEpiLabel as jest.MockedFunction<
  typeof fetchEmaEpiLabel
>;

// ── Approved result fixture ────────────────────────────────────────────────

const MOCK_APPROVED_RESULT: RegulatoryStatusResult = {
  schema_version: "1.0",
  drug: "fremanezumab",
  drug_normalised_inn: "fremanezumab",
  drug_brand_names: ["AJOVY"],
  region: "us",
  current_status: "approved",
  approved_indications: [
    {
      indication_text_verbatim:
        "Preventive treatment of episodic or chronic migraine in adults.",
      population: "adults",
      population_parsed: {
        age_min_years: 18,
        age_max_years: null,
        weight_constraint_kg: null,
        sex_constraint: null,
      },
      approval_date: "2018-09-14",
      label_revision: null,
      region_specific: false,
    },
    {
      indication_text_verbatim:
        "Preventive treatment of episodic migraine in pediatric patients aged 6 to 17 years weighing 45 kg or more.",
      population:
        "pediatric patients aged 6 to 17 years weighing 45 kg or more",
      population_parsed: {
        age_min_years: 6,
        age_max_years: 17,
        weight_constraint_kg: 45,
        sex_constraint: null,
      },
      approval_date: "2025-08",
      label_revision: "s031",
      region_specific: false,
    },
  ],
  black_box_warnings: [],
  rems_required: false,
  contraindications: [
    "Hypersensitivity to fremanezumab-vfrm or any excipients.",
  ],
  recent_label_changes: {
    count_12_months: 1,
    last_revision_date: "2025-08-08",
    last_revision_summary: null,
  },
  source_urls: [
    {
      source: "OpenFDA",
      url: "https://api.fda.gov/drug/label.json?search=openfda.generic_name:%22fremanezumab%22&limit=5",
      fetched_at: new Date().toISOString(),
    },
  ],
  data_fetched_at: new Date().toISOString(),
  data_age_hours: 0,
  cache_hit: false,
};

// ── Setup / teardown ──────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Default: approved result
  mockFetchOpenFdaLabel.mockResolvedValue(MOCK_APPROVED_RESULT);
  mockFetchDailyMedCrossCheck.mockResolvedValue(null);
  mockFetchEmaEpiLabel.mockResolvedValue(null);
});

// ── Schema version ────────────────────────────────────────────────────────

describe("regulatory.status_check — schema_version", () => {
  it("returns schema_version: '1.0'", async () => {
    const result = await handleRegulatoryStatusCheck({
      drug: "fremanezumab",
      region: "us",
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    expect(parsed.schema_version).toBe("1.0");
  });
});

// ── Approved status ───────────────────────────────────────────────────────

describe("regulatory.status_check — approved status", () => {
  it("returns current_status: 'approved' when OpenFDA returns a result", async () => {
    const result = await handleRegulatoryStatusCheck({
      drug: "fremanezumab",
      region: "us",
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    expect(parsed.current_status).toBe("approved");
  });

  it("approved_indications[] is non-empty when status='approved'", async () => {
    const result = await handleRegulatoryStatusCheck({
      drug: "fremanezumab",
      region: "us",
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    expect(parsed.approved_indications.length).toBeGreaterThan(0);
  });

  it("indication_text_verbatim is always non-empty when status='approved'", async () => {
    const result = await handleRegulatoryStatusCheck({
      drug: "fremanezumab",
      region: "us",
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    for (const ind of parsed.approved_indications) {
      expect(typeof ind.indication_text_verbatim).toBe("string");
      expect(ind.indication_text_verbatim.length).toBeGreaterThan(0);
    }
  });

  it("source_urls[] is non-empty when status='approved'", async () => {
    const result = await handleRegulatoryStatusCheck({
      drug: "fremanezumab",
      region: "us",
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    expect(parsed.source_urls.length).toBeGreaterThan(0);
    expect(parsed.source_urls[0].source).toBeTruthy();
    expect(parsed.source_urls[0].url).toBeTruthy();
    expect(parsed.source_urls[0].fetched_at).toBeTruthy();
  });
});

// ── Unknown status — THE CRITICAL INVARIANT ───────────────────────────────

describe("regulatory.status_check — unknown status (NEVER 'not_approved')", () => {
  it("returns current_status: 'unknown' when OpenFDA returns no match", async () => {
    mockFetchOpenFdaLabel.mockResolvedValue(null);
    const result = await handleRegulatoryStatusCheck({
      drug: "totally-fake-drug-xyz",
      region: "us",
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    expect(parsed.current_status).toBe("unknown");
  });

  it("NEVER returns 'not_approved' — exact string assertion", async () => {
    mockFetchOpenFdaLabel.mockResolvedValue(null);
    const result = await handleRegulatoryStatusCheck({
      drug: "totally-fake-drug-xyz",
      region: "us",
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    expect(parsed.current_status).not.toBe("not_approved");
    // Also check the raw JSON string doesn't contain "not_approved"
    expect(String(result.content)).not.toContain('"not_approved"');
  });

  it("populates did_you_mean[] when status='unknown'", async () => {
    mockFetchOpenFdaLabel.mockResolvedValue(null);
    const result = await handleRegulatoryStatusCheck({
      drug: "fremanzumab", // typo
      region: "us",
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    expect(parsed.current_status).toBe("unknown");
    expect(Array.isArray(parsed.did_you_mean)).toBe(true);
    expect(parsed.did_you_mean!.length).toBeGreaterThan(0);
  });
});

// ── Timestamps and cache ──────────────────────────────────────────────────

describe("regulatory.status_check — timestamps", () => {
  it("data_fetched_at is a valid ISO timestamp", async () => {
    const result = await handleRegulatoryStatusCheck({
      drug: "fremanezumab",
      region: "us",
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    expect(parsed.data_fetched_at).toBeTruthy();
    expect(() => new Date(parsed.data_fetched_at)).not.toThrow();
    expect(new Date(parsed.data_fetched_at).getTime()).toBeGreaterThan(0);
  });

  it("data_age_hours is 0 on first call (fresh fetch)", async () => {
    const result = await handleRegulatoryStatusCheck({
      drug: "fremanezumab-first-call-test-" + Date.now(),
      region: "us",
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    expect(parsed.data_age_hours).toBeGreaterThanOrEqual(0);
    expect(parsed.data_age_hours).toBeLessThan(0.01);
  });

  it("cache_hit: false on first call", async () => {
    const result = await handleRegulatoryStatusCheck({
      drug: "fremanezumab-cache-miss-" + Date.now(),
      region: "us",
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    expect(parsed.cache_hit).toBe(false);
  });

  it("cache_hit: true on second call within 24h", async () => {
    const key = "fremanezumab-cache-hit-" + Date.now();
    await handleRegulatoryStatusCheck({ drug: key, region: "us" });
    // Second call for same drug
    const result2 = await handleRegulatoryStatusCheck({
      drug: key,
      region: "us",
    });
    const parsed2 = JSON.parse(
      String(result2.content),
    ) as RegulatoryStatusResult;
    expect(parsed2.cache_hit).toBe(true);
  });

  it("force_refresh: true bypasses cache (cache_hit: false even within 24h)", async () => {
    const key = "fremanezumab-force-refresh-" + Date.now();
    await handleRegulatoryStatusCheck({ drug: key, region: "us" });
    const result2 = await handleRegulatoryStatusCheck({
      drug: key,
      region: "us",
      force_refresh: true,
    });
    const parsed2 = JSON.parse(
      String(result2.content),
    ) as RegulatoryStatusResult;
    expect(parsed2.cache_hit).toBe(false);
  });
});

// ── API error handling ────────────────────────────────────────────────────

describe("regulatory.status_check — api_error", () => {
  it("returns current_status: 'api_error' when OpenFDA throws", async () => {
    const err = new Error("OpenFDA unavailable") as Error & {
      retry_after_seconds?: number;
    };
    err.retry_after_seconds = 60;
    mockFetchOpenFdaLabel.mockRejectedValue(err);

    // Use force_refresh to bypass cache from earlier tests
    const result = await handleRegulatoryStatusCheck({
      drug: "fremanezumab",
      region: "us",
      force_refresh: true,
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    expect(parsed.current_status).toBe("api_error");
    expect(parsed.api_error).toBeDefined();
    expect(parsed.api_error!.source).toBeTruthy();
    expect(typeof parsed.api_error!.retry_after_seconds).toBe("number");
  });

  it("api_error includes source and message", async () => {
    const err = Object.assign(new Error("Rate limited"), {
      retry_after_seconds: 120,
    });
    mockFetchOpenFdaLabel.mockRejectedValue(err);

    // Use force_refresh to bypass cache from earlier tests
    const result = await handleRegulatoryStatusCheck({
      drug: "fremanezumab",
      region: "us",
      force_refresh: true,
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    expect(parsed.api_error!.source).toBe("OpenFDA");
    expect(parsed.api_error!.retry_after_seconds).toBe(120);
  });
});

// ── UK region — deferred to v1.7.1 ────────────────────────────────────────

describe("regulatory.status_check — UK region (v1.7.0 deferred)", () => {
  it("returns api_error for region='uk' with v1.7.1 deferral message", async () => {
    const result = await handleRegulatoryStatusCheck({
      drug: "fremanezumab",
      region: "uk",
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    expect(parsed.current_status).toBe("api_error");
    expect(parsed.api_error!.message.toLowerCase()).toMatch(
      /v1\.7\.1|deferred|not available|uk/,
    );
  });
});

// ── EU region ─────────────────────────────────────────────────────────────

describe("regulatory.status_check — EU region", () => {
  it("calls EMA EPI client for region='eu'", async () => {
    mockFetchEmaEpiLabel.mockResolvedValue({
      indication_text:
        "AJOVY is indicated for preventive treatment of migraine in adults.",
      source: "EMA EPI",
      url: "https://epi.developer.ema.europa.eu/",
      fetched_at: new Date().toISOString(),
    });

    await handleRegulatoryStatusCheck({
      drug: "fremanezumab",
      region: "eu",
    });

    expect(mockFetchEmaEpiLabel).toHaveBeenCalled();
  });

  it("returns unknown status when EMA has no match", async () => {
    mockFetchEmaEpiLabel.mockResolvedValue(null);

    const result = await handleRegulatoryStatusCheck({
      drug: "totally-fake-drug-xyz",
      region: "eu",
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    expect(parsed.current_status).toBe("unknown");
    expect(parsed.current_status).not.toBe("not_approved");
  });
});

// ── Drug name normalisation ────────────────────────────────────────────────

describe("regulatory.status_check — drug name normalisation", () => {
  it("brand name input ('Ajovy') → drug_normalised_inn: 'fremanezumab'", async () => {
    const result = await handleRegulatoryStatusCheck({
      drug: "Ajovy",
      region: "us",
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    expect(parsed.drug_normalised_inn).toBe("fremanezumab");
  });

  it("INN+suffix 'fremanezumab-vfrm' → drug_normalised_inn: 'fremanezumab'", async () => {
    const result = await handleRegulatoryStatusCheck({
      drug: "fremanezumab-vfrm",
      region: "us",
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    expect(parsed.drug_normalised_inn).toBe("fremanezumab");
  });

  it("case-insensitive 'AJOVY' → drug_normalised_inn: 'fremanezumab'", async () => {
    const result = await handleRegulatoryStatusCheck({
      drug: "AJOVY",
      region: "us",
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    expect(parsed.drug_normalised_inn).toBe("fremanezumab");
  });

  it("case-insensitive 'ajovy' → drug_normalised_inn: 'fremanezumab'", async () => {
    const result = await handleRegulatoryStatusCheck({
      drug: "ajovy",
      region: "us",
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    expect(parsed.drug_normalised_inn).toBe("fremanezumab");
  });
});

// ── Indication filter ─────────────────────────────────────────────────────

describe("regulatory.status_check — indication filter", () => {
  it("indication filter narrows results when provided", async () => {
    const filteredMock: RegulatoryStatusResult = {
      ...MOCK_APPROVED_RESULT,
      approved_indications: [
        MOCK_APPROVED_RESULT.approved_indications[0],
        MOCK_APPROVED_RESULT.approved_indications[1],
        {
          indication_text_verbatim:
            "Treatment of acute migraine episodes in adults.",
          population: "adults",
          population_parsed: {
            age_min_years: 18,
            age_max_years: null,
            weight_constraint_kg: null,
            sex_constraint: null,
          },
          approval_date: "2020-01",
          label_revision: null,
          region_specific: false,
        },
      ],
    };
    mockFetchOpenFdaLabel.mockResolvedValue(filteredMock);

    const result = await handleRegulatoryStatusCheck({
      drug: "fremanezumab",
      region: "us",
      indication: "pediatric",
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    // Only the pediatric indication should remain
    expect(parsed.approved_indications.length).toBeLessThan(3);
    expect(
      parsed.approved_indications.some((i) =>
        i.indication_text_verbatim.toLowerCase().includes("pediatric"),
      ),
    ).toBe(true);
  });
});

// ── Population parsed ─────────────────────────────────────────────────────

describe("regulatory.status_check — population_parsed", () => {
  it("population_parsed is null when label population text is unparseable", async () => {
    const mockWithUnparseable: RegulatoryStatusResult = {
      ...MOCK_APPROVED_RESULT,
      approved_indications: [
        {
          indication_text_verbatim:
            "For use as indicated in the full prescribing information.",
          population: "as part of the approved regimen per label",
          population_parsed: null,
          approval_date: null,
          label_revision: null,
          region_specific: false,
        },
      ],
    };
    mockFetchOpenFdaLabel.mockResolvedValue(mockWithUnparseable);

    // Use force_refresh to bypass cache from approved-status tests above
    const result = await handleRegulatoryStatusCheck({
      drug: "fremanezumab",
      region: "us",
      force_refresh: true,
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    const ind = parsed.approved_indications[0];
    expect(ind.population_parsed).toBeNull();
    // But verbatim population text must still be present
    expect(ind.population.length).toBeGreaterThan(0);
    // And indication_text_verbatim must be present
    expect(ind.indication_text_verbatim.length).toBeGreaterThan(0);
  });
});

// ── recent_label_changes ──────────────────────────────────────────────────

describe("regulatory.status_check — recent_label_changes", () => {
  it("count_12_months is a number >= 0", async () => {
    const result = await handleRegulatoryStatusCheck({
      drug: "fremanezumab",
      region: "us",
    });
    const parsed = JSON.parse(String(result.content)) as RegulatoryStatusResult;
    expect(typeof parsed.recent_label_changes.count_12_months).toBe("number");
    expect(parsed.recent_label_changes.count_12_months).toBeGreaterThanOrEqual(
      0,
    );
  });
});

// ── Zod schema validation ─────────────────────────────────────────────────

describe("regulatory.status_check — Zod validation", () => {
  it("rejects missing drug field", async () => {
    await expect(
      handleRegulatoryStatusCheck({ region: "us" } as never),
    ).rejects.toThrow(/drug/i);
  });

  it("rejects empty drug string", async () => {
    await expect(
      handleRegulatoryStatusCheck({ drug: "", region: "us" }),
    ).rejects.toThrow();
  });

  it("rejects invalid region", async () => {
    await expect(
      handleRegulatoryStatusCheck({
        drug: "fremanezumab",
        region: "mars" as never,
      }),
    ).rejects.toThrow(/region/i);
  });

  it("accepts valid minimal input", async () => {
    await expect(
      handleRegulatoryStatusCheck({ drug: "fremanezumab", region: "us" }),
    ).resolves.toBeDefined();
  });
});
