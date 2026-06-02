import { handleQueryAgent, queryAgentToolSchema } from "../../src/tools/queryAgent.js";

// Mock handleClaimsQuery so tests don't need Azure Blob Storage
jest.mock("../../src/tools/claimsQuery.js", () => ({
  handleClaimsQuery: jest.fn(),
}));

import { handleClaimsQuery } from "../../src/tools/claimsQuery.js";

const mockClaims = handleClaimsQuery as jest.MockedFunction<typeof handleClaimsQuery>;

function makeClaimsResult(byYear: { year: number; record_count: number }[]) {
  return {
    content: JSON.stringify({
      status: "ok",
      results: {
        total_records: byYear.reduce((s, y) => s + y.record_count, 0),
        by_year: byYear,
      },
    }),
    audit: {
      tool: "data.claims_query",
      timestamp: new Date().toISOString(),
      query: {},
      sources_queried: [],
      methodology: "",
      inclusions: 0,
      exclusions: [],
      assumptions: [],
      warnings: [],
      output_format: "json",
      tools_called: [],
    },
  };
}

beforeEach(() => {
  mockClaims.mockReset();
});

describe("queryAgent — ToolResult shape", () => {
  it("returns object with content and audit when indication is unknown", async () => {
    const result = await handleQueryAgent({
      indication: "COMPLETELY_UNKNOWN_XYZXYZ",
      country_codes: ["BR"],
      regions: [],
    });
    expect(result).toHaveProperty("content");
    expect(result).toHaveProperty("audit");
    expect(typeof result.content).toBe("string");
    const parsed = JSON.parse(result.content as string);
    expect(parsed.status).toBe("no_data");
  });

  it("returns object with content and audit for a known indication", async () => {
    mockClaims.mockResolvedValue(
      makeClaimsResult([
        { year: 2021, record_count: 200000 },
        { year: 2022, record_count: 210000 },
        { year: 2023, record_count: 220000 },
      ]),
    );

    const result = await handleQueryAgent({
      indication: "type 2 diabetes",
      country_codes: ["BR"],
      regions: [],
    });

    expect(result).toHaveProperty("content");
    expect(result).toHaveProperty("audit");
    const parsed = JSON.parse(result.content as string);
    expect(parsed.status).toBe("ok");
    expect(parsed.indication_resolved.icd10_prefixes.length).toBeGreaterThan(0);
    expect(parsed.results[0].recommended_estimate.value).toBeGreaterThan(0);
  });
});

describe("queryAgent — ICD resolution", () => {
  it("resolves known indication T2D to E11", async () => {
    mockClaims.mockResolvedValue(
      makeClaimsResult([{ year: 2022, record_count: 150000 }]),
    );
    const result = await handleQueryAgent({
      indication: "T2D",
      country_codes: ["BR"],
      regions: [],
    });
    const parsed = JSON.parse(result.content as string);
    expect(parsed.indication_resolved.icd10_prefixes).toContain("E11");
  });

  it("falls back to additional_icd_prefixes when indication unknown", async () => {
    mockClaims.mockResolvedValue(
      makeClaimsResult([{ year: 2022, record_count: 50000 }]),
    );
    const result = await handleQueryAgent({
      indication: "unknown disease xyz",
      country_codes: ["BR"],
      regions: [],
      additional_icd_prefixes: ["Z99"],
    });
    const parsed = JSON.parse(result.content as string);
    expect(parsed.indication_resolved.icd10_prefixes).toContain("Z99");
  });
});

describe("queryAgent — dataset selection and validation", () => {
  it("uses configured secondary datasets for countries that define them", async () => {
    mockClaims.mockResolvedValue(
      makeClaimsResult([{ year: 2022, record_count: 150000 }]),
    );

    await handleQueryAgent({
      indication: "type 2 diabetes",
      country_codes: ["US"],
      regions: [],
    });

    expect(mockClaims).toHaveBeenCalledWith(
      expect.objectContaining({
        datasets: ["ny_sparcs", "meps"],
      }),
    );
  });

  it("assesses plausibility against each country's own population denominator", async () => {
    mockClaims.mockImplementation(async (input) => {
      const datasets = (input as { datasets: string[] }).datasets;
      if (datasets.includes("mexico_egresos")) {
        return makeClaimsResult([{ year: 2022, record_count: 3000 }]);
      }
      return makeClaimsResult([{ year: 2022, record_count: 300000 }]);
    });

    const result = await handleQueryAgent({
      indication: "type 2 diabetes",
      country_codes: ["BR", "MX"],
      regions: [],
    });
    const parsed = JSON.parse(result.content as string);
    const mxResult = parsed.results.find(
      (r: { country: string }) => r.country === "MX",
    );

    expect(mxResult.plausibility.failed).toHaveLength(0);
  });
});

describe("queryAgent — schema", () => {
  it("schema name is data.query_agent", () => {
    expect(queryAgentToolSchema.name).toBe("data.query_agent");
  });

  it("schema has required input properties", () => {
    const props = queryAgentToolSchema.inputSchema.properties;
    expect(props).toHaveProperty("indication");
    expect(props).toHaveProperty("country_codes");
  });
});
