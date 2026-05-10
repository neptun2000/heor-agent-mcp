/**
 * Tests for providers/regulatory/autoCheck.ts — design log #26
 *
 * TDD: tests written BEFORE implementation.
 * Run: npm test -- --testPathPattern=autoCheck
 */

import type { AutoCheckRequest, AutoCheckResult } from "../../../src/providers/regulatory/autoCheck.js";

// ── Mock regulatoryStatusCheck ─────────────────────────────────────────────

// We mock the module so that autoCheckRegulatory doesn't hit live OpenFDA.
// We control what handleRegulatoryStatusCheck returns per drug.

const mockHandleRegulatoryStatusCheck = jest.fn();

jest.mock("../../../src/tools/regulatoryStatusCheck.js", () => ({
  handleRegulatoryStatusCheck: mockHandleRegulatoryStatusCheck,
}));

// Import AFTER mock is set up (dynamic require to ensure mock is applied)
// We use a lazy import pattern to avoid hoisting issues.
let autoCheckRegulatory: (requests: AutoCheckRequest[]) => Promise<AutoCheckResult[]>;

beforeAll(async () => {
  const mod = await import("../../../src/providers/regulatory/autoCheck.js");
  autoCheckRegulatory = mod.autoCheckRegulatory;
});

function makeApprovedResult(drug: string, region: string) {
  return {
    content: JSON.stringify({
      schema_version: "1.0",
      drug,
      drug_normalised_inn: drug.toLowerCase(),
      drug_brand_names: [],
      region,
      current_status: "approved",
      approved_indications: [
        {
          indication_text_verbatim: `${drug} is approved for the preventive treatment of migraine.`,
          population: "adults",
          population_parsed: null,
          approval_date: "2020-01",
          label_revision: null,
          region_specific: false,
        },
      ],
      black_box_warnings: [],
      rems_required: false,
      contraindications: [],
      recent_label_changes: { count_12_months: 0, last_revision_date: null, last_revision_summary: null },
      source_urls: [{ source: "OpenFDA", url: "https://api.fda.gov/drug/label.json", fetched_at: "2026-05-10T00:00:00Z" }],
      data_fetched_at: "2026-05-10T00:00:00Z",
      data_age_hours: 0,
      cache_hit: false,
    }),
  };
}

function makeUnknownResult(drug: string, region: string) {
  return {
    content: JSON.stringify({
      schema_version: "1.0",
      drug,
      drug_normalised_inn: drug.toLowerCase(),
      drug_brand_names: [],
      region,
      current_status: "unknown",
      approved_indications: [],
      black_box_warnings: [],
      rems_required: false,
      contraindications: [],
      recent_label_changes: { count_12_months: 0, last_revision_date: null, last_revision_summary: null },
      source_urls: [],
      data_fetched_at: "2026-05-10T00:00:00Z",
      data_age_hours: 0,
      cache_hit: false,
      did_you_mean: ["topiramate", "topamax"],
    }),
  };
}

function makeApiErrorResult(drug: string, region: string) {
  return {
    content: JSON.stringify({
      schema_version: "1.0",
      drug,
      drug_normalised_inn: drug.toLowerCase(),
      drug_brand_names: [],
      region,
      current_status: "api_error",
      approved_indications: [],
      black_box_warnings: [],
      rems_required: false,
      contraindications: [],
      recent_label_changes: { count_12_months: 0, last_revision_date: null, last_revision_summary: null },
      source_urls: [],
      data_fetched_at: "2026-05-10T00:00:00Z",
      data_age_hours: 0,
      cache_hit: false,
      api_error: { source: "OpenFDA", message: "Network error", retry_after_seconds: 60 },
    }),
  };
}

beforeEach(() => {
  mockHandleRegulatoryStatusCheck.mockReset();
});

// ── Test 1: Returns one result per input request ───────────────────────────

describe("autoCheckRegulatory", () => {
  it("Test 1: returns one result per input request", async () => {
    mockHandleRegulatoryStatusCheck
      .mockResolvedValueOnce(makeApprovedResult("fremanezumab", "us"))
      .mockResolvedValueOnce(makeApprovedResult("topiramate", "us"));

    const requests: AutoCheckRequest[] = [
      { drug: "fremanezumab", region: "us", indication: "migraine" },
      { drug: "topiramate", region: "us", indication: "migraine" },
    ];

    const results = await autoCheckRegulatory(requests);

    expect(results).toHaveLength(2);
    expect(results[0].drug).toBe("fremanezumab");
    expect(results[0].region).toBe("us");
    expect(results[1].drug).toBe("topiramate");
    expect(results[1].region).toBe("us");
  });

  // ── Test 2: Caps at 8 ──────────────────────────────────────────────────

  it("Test 2: caps at 8 when 12 requests are supplied", async () => {
    // Mock returns approved for any drug
    mockHandleRegulatoryStatusCheck.mockImplementation((input: { drug: string; region: string }) =>
      Promise.resolve(makeApprovedResult(input.drug as string, input.region as string)),
    );

    const requests: AutoCheckRequest[] = Array.from({ length: 12 }, (_, i) => ({
      drug: `drug-${i}`,
      region: "us" as const,
    }));

    const results = await autoCheckRegulatory(requests);

    expect(results).toHaveLength(8);
    expect(mockHandleRegulatoryStatusCheck).toHaveBeenCalledTimes(8);
  });

  // ── Test 3: One failure doesn't kill the batch ─────────────────────────

  it("Test 3: one mock failure doesn't kill the rest of the batch", async () => {
    mockHandleRegulatoryStatusCheck
      .mockResolvedValueOnce(makeApprovedResult("fremanezumab", "us"))
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockResolvedValueOnce(makeApprovedResult("galcanezumab", "us"));

    const requests: AutoCheckRequest[] = [
      { drug: "fremanezumab", region: "us" },
      { drug: "bad-drug", region: "us" },
      { drug: "galcanezumab", region: "us" },
    ];

    const results = await autoCheckRegulatory(requests);

    // All 3 return results (error becomes api_error gracefully)
    expect(results).toHaveLength(3);

    const fremanezumab = results.find((r) => r.drug === "fremanezumab");
    const badDrug = results.find((r) => r.drug === "bad-drug");
    const galca = results.find((r) => r.drug === "galcanezumab");

    expect(fremanezumab?.result.current_status).toBe("approved");
    expect(badDrug?.result.current_status).toBe("api_error");
    expect(galca?.result.current_status).toBe("approved");
  });

  // ── Test 4: Empty input returns empty array ────────────────────────────

  it("Test 4: empty input returns empty array without calling handler", async () => {
    const results = await autoCheckRegulatory([]);
    expect(results).toHaveLength(0);
    expect(mockHandleRegulatoryStatusCheck).not.toHaveBeenCalled();
  });

  // ── Test 5: Result structure includes drug, region, result ─────────────

  it("Test 5: each result has drug, region, and a parsed RegulatoryStatusResult", async () => {
    mockHandleRegulatoryStatusCheck.mockResolvedValueOnce(
      makeApprovedResult("fremanezumab", "us"),
    );

    const results = await autoCheckRegulatory([
      { drug: "fremanezumab", region: "us", indication: "migraine" },
    ]);

    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.drug).toBe("fremanezumab");
    expect(r.region).toBe("us");
    expect(r.result).toBeDefined();
    expect(r.result.schema_version).toBe("1.0");
    expect(r.result.current_status).toBe("approved");
    expect(r.result.approved_indications).toHaveLength(1);
  });

  // ── Test 6: Handles unknown status ────────────────────────────────────

  it("Test 6: handles unknown status gracefully (no throw)", async () => {
    mockHandleRegulatoryStatusCheck.mockResolvedValueOnce(
      makeUnknownResult("totally-fake-drug", "us"),
    );

    const results = await autoCheckRegulatory([
      { drug: "totally-fake-drug", region: "us" },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].result.current_status).toBe("unknown");
    expect(results[0].result.did_you_mean).toContain("topiramate");
  });

  // ── Test 7: Handles api_error status ──────────────────────────────────

  it("Test 7: handles api_error status gracefully (no throw)", async () => {
    mockHandleRegulatoryStatusCheck.mockResolvedValueOnce(
      makeApiErrorResult("topiramate", "uk"),
    );

    const results = await autoCheckRegulatory([
      { drug: "topiramate", region: "uk" as const },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].result.current_status).toBe("api_error");
  });

  // ── Test 8: All results have non-null result object ────────────────────

  it("Test 8: all results have non-null result object even on mixed success/failure", async () => {
    mockHandleRegulatoryStatusCheck
      .mockRejectedValueOnce(new Error("error A"))
      .mockRejectedValueOnce(new Error("error B"));

    const results = await autoCheckRegulatory([
      { drug: "drug-a", region: "us" },
      { drug: "drug-b", region: "eu" },
    ]);

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.result).toBeDefined();
      expect(r.result.current_status).toBe("api_error");
    }
  });
});

// ── Cycle-safety static check ──────────────────────────────────────────────

describe("cycleSafety — regulatory module must not import from evidence or hta tools", () => {
  it("regulatoryStatusCheck.ts does not import from evidenceUnmetNeed or htaWorkflow", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(
      process.cwd(),
      "src/tools/regulatoryStatusCheck.ts",
    );
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).not.toMatch(/evidenceUnmetNeed/);
    expect(source).not.toMatch(/htaWorkflow/);
    expect(source).not.toMatch(/hta_workflow/);
    expect(source).not.toMatch(/evidence\.unmet_need/);
  });
});
