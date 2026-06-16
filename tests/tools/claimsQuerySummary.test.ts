import { __claimsQueryTestHooks } from "../../src/tools/claimsQuery.js";

const {
  buildClaimsSummaryWhere,
  claimsSummaryPathSql,
  parquetPaths,
  shouldUseClaimsSummary,
  summaryDatasetForInput,
} = __claimsQueryTestHooks;

const claimsInput = (overrides: Record<string, unknown>) =>
  ({
    datasets: ["datasus_sih"],
    icd10_prefixes: ["E11"],
    sex: "all",
    aggregation: "prevalence",
    top_n: 20,
    ...overrides,
  }) as any;

describe("claimsQuery primary-diagnosis summary fast path", () => {
  beforeEach(() => {
    process.env.AZURE_STORAGE_CONTAINER = "heor-claims";
  });

  it("uses summary parquet for enabled prevalence/count datasets", () => {
    expect(
      shouldUseClaimsSummary(claimsInput({
        year_from: 2019,
        year_to: 2022,
      })),
    ).toBe(true);
    expect(summaryDatasetForInput(claimsInput({}))).toBe("datasus_sih");

    expect(
      shouldUseClaimsSummary(claimsInput({
        datasets: ["brazil_datasus"],
        aggregation: "count",
      })),
    ).toBe(true);
    expect(
      summaryDatasetForInput(
        claimsInput({ datasets: ["brazil_datasus"], aggregation: "count" }),
      ),
    ).toBe("datasus_sih");

    expect(
      summaryDatasetForInput(claimsInput({ datasets: ["mexico_egresos"] })),
    ).toBe("mexico_egresos");
    expect(summaryDatasetForInput(claimsInput({ datasets: ["chile_deis"] }))).toBe(
      "chile_deis",
    );
    expect(summaryDatasetForInput(claimsInput({ datasets: ["ny_sparcs"] }))).toBe(
      "ny_sparcs",
    );
  });

  it("does not use the summary when non-count details are requested", () => {
    expect(
      shouldUseClaimsSummary(claimsInput({
        drug_names: ["metformin"],
      })),
    ).toBe(false);

    expect(
      shouldUseClaimsSummary(claimsInput({
        aggregation: "cost",
      })),
    ).toBe(false);

    expect(summaryDatasetForInput(claimsInput({ datasets: ["meps"] }))).toBeNull();
  });

  it("builds exact per-year summary paths for partition pruning", () => {
    const pathSql = claimsSummaryPathSql(
      claimsInput({
        datasets: ["mexico_egresos"],
        year_from: 2019,
        year_to: 2020,
      }),
      "mexico_egresos",
    );

    expect(pathSql).toContain(
      "azure://heor-claims/claims_visits_summary/source_dataset=mexico_egresos/source_year=2019/primary_diag_counts.parquet",
    );
    expect(pathSql).toContain(
      "azure://heor-claims/claims_visits_summary/source_dataset=mexico_egresos/source_year=2020/primary_diag_counts.parquet",
    );
    expect(pathSql).not.toContain("claims_visits/source_dataset=mexico_egresos");
  });

  it("skips known missing summary years instead of building empty NY SPARCS globs", () => {
    const pathSql = claimsSummaryPathSql(
      claimsInput({
        datasets: ["ny_sparcs"],
        year_from: 2022,
        year_to: 2024,
      }),
      "ny_sparcs",
    );

    expect(pathSql).toContain(
      "claims_visits_summary/source_dataset=ny_sparcs/source_year=2022/primary_diag_counts.parquet",
    );
    expect(pathSql).toContain(
      "claims_visits_summary/source_dataset=ny_sparcs/source_year=2024/primary_diag_counts.parquet",
    );
    expect(pathSql).not.toContain("source_year=2023");
  });

  it("sanitizes and applies the same filters against summary rows", () => {
    const where = buildClaimsSummaryWhere(
      claimsInput({
        datasets: ["chile_deis"],
        icd10_prefixes: ["E11", "I50'; DROP"],
        regions: ["sp", "RJ!"],
        age_min: 18,
        age_max: 80,
        sex: "female",
        year_from: 2019,
        year_to: 2022,
      }),
      "chile_deis",
    );

    expect(where).toContain("source_dataset = 'chile_deis'");
    expect(where).toContain("source_year >= 2019");
    expect(where).toContain("source_year <= 2022");
    expect(where).toContain("primary_diag_icd LIKE 'E11%'");
    expect(where).toContain("primary_diag_icd LIKE 'I50DROP%'");
    expect(where).toContain("region IN ('SP','RJ')");
    expect(where).toContain("age_years >= 18");
    expect(where).toContain("age_years <= 80");
    expect(where).toContain("sex = 'female'");
  });

  it("does not translate NY SPARCS ICD-10 prefixes back to legacy CCSR codes", () => {
    const where = buildClaimsSummaryWhere(
      claimsInput({
        datasets: ["ny_sparcs"],
        icd10_prefixes: ["E11"],
        year_from: 2024,
        year_to: 2024,
      }),
      "ny_sparcs",
    );

    expect(where).toContain("primary_diag_icd LIKE 'E11%'");
    expect(where).not.toContain("END003");
  });

  it("keeps DATASUS raw fallback paths nested by UF region", () => {
    const { pathSql } = parquetPaths(claimsInput({
      year_from: 2022,
      year_to: 2022,
    }));

    expect(pathSql).toContain(
      "claims_visits/source_dataset=datasus_sih/source_year=2022/*/*.parquet",
    );
    expect(pathSql).not.toContain(
      "claims_visits/source_dataset=datasus_sih/source_year=2022/*.parquet",
    );
  });
});
