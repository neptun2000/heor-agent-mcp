/**
 * Tests for live Excel formulas in XLSX output (Design Log #20).
 * Verifies that formula cells are present (not static values) and that
 * Markov Trace, Transition Matrix, CEAC, and Summary sheets wire correctly.
 */

import { ceModelToXlsx, bimToXlsx } from "../../src/formatters/xlsx.js";
import ExcelJS from "exceljs";
import type {
  CEModelParams,
  CEModelResult,
} from "../../src/providers/types.js";
import type { AuditRecord } from "../../src/audit/types.js";

// Minimal valid audit record
const mockAudit: AuditRecord = {
  tool: "cost_effectiveness_model",
  timestamp: "2026-05-07T12:00:00Z",
  query: {},
  sources_queried: [],
  methodology: "Markov model",
  inclusions: 0,
  exclusions: [],
  assumptions: ["Base-case discount rate 3.5%"],
  warnings: [],
  output_format: "xlsx",
};

// Minimal valid params
const mockParams: CEModelParams = {
  intervention: "Drug A",
  comparator: "Drug B",
  indication: "Type 2 Diabetes",
  time_horizon: "5yr",
  perspective: "nhs",
  clinical_inputs: {
    efficacy_delta: 0.3,
    mortality_reduction: 0.1,
  },
  cost_inputs: {
    drug_cost_annual: 10000,
    comparator_cost_annual: 5000,
    admin_cost: 500,
    ae_cost: 200,
  },
  utility_inputs: {
    qaly_on_treatment: 0.75,
    qaly_comparator: 0.7,
  },
  run_psa: true,
  psa_iterations: 100,
};

// Minimal valid result
const mockResult: CEModelResult = {
  base_case: {
    icer: 45000,
    delta_cost: 22500,
    delta_qaly: 0.5,
    incremental_lys: 0.3,
    total_cost_intervention: 55000,
    total_cost_comparator: 32500,
    total_qaly_intervention: 3.75,
    total_qaly_comparator: 3.25,
  },
  psa: {
    iterations: 50,
    mean_icer: 44500,
    ci_icer_lower: 30000,
    ci_icer_upper: 60000,
    prob_cost_effective: { "30000": 0.3, "50000": 0.7 },
    scatter: Array.from({ length: 50 }, (_, i) => ({
      delta_cost: 20000 + i * 100,
      delta_qaly: 0.45 + i * 0.001,
    })),
    ceac: [
      { wtp: 20000, prob_ce: 0.1 },
      { wtp: 30000, prob_ce: 0.3 },
      { wtp: 50000, prob_ce: 0.7 },
    ],
    evpi: 1200,
    evppi: [],
  },
  wtp_analysis: {
    nhs: {
      threshold_low: 20000,
      threshold_high: 30000,
      currency: "GBP",
      symbol: "£",
      verdict: "not_cost_effective",
    },
    us_payer: {
      threshold_low: 100000,
      threshold_high: 150000,
      currency: "USD",
      symbol: "$",
      verdict: "cost_effective",
    },
    societal: {
      threshold_low: 50000,
      threshold_high: 80000,
      currency: "USD",
      symbol: "$",
      verdict: "cost_effective",
    },
  },
  model_metadata: {
    model_type: "markov",
    states: ["On-Treatment", "Off-Treatment", "Dead"],
    cycles: 5,
    cycle_length: "annual",
    discount_rate_costs: 0.035,
    discount_rate_outcomes: 0.035,
    time_horizon_years: 5,
  },
  audit: mockAudit,
};

// Helper: parse a Buffer into an ExcelJS workbook
async function parseXlsx(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS.load() wants an ArrayBuffer; slice() on a Node Buffer gives one
  await wb.xlsx.load(
    buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer,
  );
  return wb;
}

// Helper: get cell value from a sheet (1-based row/col)
function getCellValue(sheet: ExcelJS.Worksheet, row: number, col: number) {
  return sheet.getRow(row).getCell(col).value;
}

// Helper: check if a cell value is a formula object
function isFormula(val: unknown): boolean {
  return (
    typeof val === "object" &&
    val !== null &&
    "formula" in val &&
    typeof (val as Record<string, unknown>).formula === "string"
  );
}

// Helper: get formula string from a cell value
function getFormula(val: unknown): string {
  if (isFormula(val)) {
    return (val as { formula: string }).formula;
  }
  return "";
}

describe("ceModelToXlsx — live formula tests", () => {
  let wb: ExcelJS.Workbook;

  beforeAll(async () => {
    const buf = await ceModelToXlsx(mockParams, mockResult, mockAudit);
    wb = await parseXlsx(buf);
  });

  it("1. Markov Trace sheet exists", () => {
    const sheet = wb.getWorksheet("Markov Trace");
    expect(sheet).toBeDefined();
  });

  it("2. Transition Matrix!B2 is a formula (not a raw number)", () => {
    const sheet = wb.getWorksheet("Transition Matrix");
    expect(sheet).toBeDefined();
    const val = getCellValue(sheet!, 2, 2);
    expect(isFormula(val)).toBe(true);
    expect(getFormula(val)).toContain("Inputs");
  });

  it("3. Markov Trace row 2 B2 = 1 (initial On-Treatment state = 100%)", () => {
    const sheet = wb.getWorksheet("Markov Trace");
    expect(sheet).toBeDefined();
    const val = getCellValue(sheet!, 2, 2);
    // Row 2 (cycle 0) B2 is a static value of 1
    expect(val).toBe(1);
  });

  it("4. Markov Trace row 3 B3 is a formula referencing 'Transition Matrix'", () => {
    const sheet = wb.getWorksheet("Markov Trace");
    expect(sheet).toBeDefined();
    const val = getCellValue(sheet!, 3, 2);
    expect(isFormula(val)).toBe(true);
    expect(getFormula(val)).toContain("Transition Matrix");
  });

  it("5. CEAC!B2 is a formula containing COUNTIFS", () => {
    const sheet = wb.getWorksheet("CEAC");
    expect(sheet).toBeDefined();
    const val = getCellValue(sheet!, 2, 2);
    expect(isFormula(val)).toBe(true);
    expect(getFormula(val)).toContain("COUNTIFS");
  });

  it("6. Summary!B11 is a formula containing IF (ICER formula)", () => {
    const sheet = wb.getWorksheet("Summary");
    expect(sheet).toBeDefined();
    const val = getCellValue(sheet!, 11, 2);
    expect(isFormula(val)).toBe(true);
    expect(getFormula(val)).toContain("IF");
  });

  it("7. Summary!B15 is a formula referencing 'Markov Trace'", () => {
    const sheet = wb.getWorksheet("Summary");
    expect(sheet).toBeDefined();
    const val = getCellValue(sheet!, 15, 2);
    expect(isFormula(val)).toBe(true);
    expect(getFormula(val)).toContain("Markov Trace");
  });

  it("8. PSA formulas still present — ICER formula in column D", () => {
    const sheet = wb.getWorksheet("PSA");
    expect(sheet).toBeDefined();
    // Row 2, col 4 = D2 = ICER formula
    const val = getCellValue(sheet!, 2, 4);
    expect(isFormula(val)).toBe(true);
    expect(getFormula(val)).toContain("IF");
  });

  it("9. Transition Matrix rows 2-3 all have formula cells in cols B-D", () => {
    const sheet = wb.getWorksheet("Transition Matrix");
    expect(sheet).toBeDefined();
    for (const rowNum of [2, 3]) {
      for (const colNum of [2, 3, 4]) {
        const val = getCellValue(sheet!, rowNum, colNum);
        expect(isFormula(val)).toBe(true);
      }
    }
  });

  it("10. Markov Trace has n_cycles + 1 data rows (cycle 0 through 5)", () => {
    const sheet = wb.getWorksheet("Markov Trace");
    expect(sheet).toBeDefined();
    // 5yr → n_cycles = 5 → rows 2..7 (6 rows: cycle 0 through 5)
    // Row 7 (cycle 5) col B should be a formula
    const lastRow = getCellValue(sheet!, 7, 2);
    expect(isFormula(lastRow)).toBe(true);
    // Row 8 should be empty (no cycle 6)
    const beyondLast = sheet!.getRow(8).getCell(2).value;
    expect(
      beyondLast === null || beyondLast === undefined || beyondLast === "",
    ).toBe(true);
  });

  it("11. Summary!B12 and B13 are formulas for Delta Cost and Delta QALY", () => {
    const sheet = wb.getWorksheet("Summary");
    expect(sheet).toBeDefined();
    const b12 = getCellValue(sheet!, 12, 2);
    const b13 = getCellValue(sheet!, 13, 2);
    expect(isFormula(b12)).toBe(true);
    expect(isFormula(b13)).toBe(true);
    expect(getFormula(b12)).toContain("B15");
    expect(getFormula(b13)).toContain("B17");
  });

  it("12. Markov Trace!I2 formula references Inputs!$B$2 (drug cost)", () => {
    const sheet = wb.getWorksheet("Markov Trace");
    expect(sheet).toBeDefined();
    const val = getCellValue(sheet!, 2, 9); // col I = col 9
    expect(isFormula(val)).toBe(true);
    expect(getFormula(val)).toContain("Inputs!$B$2");
  });
});

describe("bimToXlsx — live formula tests", () => {
  const bimParams = {
    intervention: "Drug X",
    comparator: "SOC",
    indication: "Hypertension",
    perspective: "us_payer",
    eligible_population: 10000,
    population_growth_rate: 0.02,
    drug_cost_annual: 8000,
    comparator_cost_annual: 3000,
    admin_cost_annual: 200,
    monitoring_cost_annual: 100,
    ae_cost_annual: 50,
    comparator_ae_cost_annual: 30,
  };

  const bimResults = [
    {
      year: 1,
      eligible_population: 10000,
      treated_population: 1000,
      intervention_cost: 8200000,
      comparator_cost: 3000000,
      displaced_cost_saved: 0,
      net_budget_impact: 5200000,
      per_patient_cost: 5200,
    },
    {
      year: 2,
      eligible_population: 10200,
      treated_population: 2040,
      intervention_cost: 16728000,
      comparator_cost: 6120000,
      displaced_cost_saved: 0,
      net_budget_impact: 10608000,
      per_patient_cost: 5200,
    },
    {
      year: 3,
      eligible_population: 10404,
      treated_population: 3121,
      intervention_cost: 25594200,
      comparator_cost: 9363000,
      displaced_cost_saved: 0,
      net_budget_impact: 16231200,
      per_patient_cost: 5200,
    },
  ];

  let wb: ExcelJS.Workbook;

  beforeAll(async () => {
    const buf = await bimToXlsx(bimParams, bimResults, mockAudit);
    wb = await parseXlsx(buf);
  });

  it("9. BIM: Year-by-Year total row uses SUM formula for treated population", () => {
    const sheet = wb.getWorksheet("Year-by-Year");
    expect(sheet).toBeDefined();
    // Total row = results.length + 2 = 3 + 2 = 5
    const totalRow = bimResults.length + 2;
    const val = getCellValue(sheet!, totalRow, 3); // col C = Treated
    expect(isFormula(val)).toBe(true);
    expect(getFormula(val)).toContain("SUM");
  });

  it("10. BIM: Summary sheet B9 uses SUM formula referencing Year-by-Year", () => {
    const sheet = wb.getWorksheet("Summary");
    expect(sheet).toBeDefined();
    const val = getCellValue(sheet!, 9, 2);
    expect(isFormula(val)).toBe(true);
    expect(getFormula(val)).toContain("Year-by-Year");
    expect(getFormula(val)).toContain("SUM");
  });

  it("11. BIM: Summary sheet B11 uses IF formula for Avg Net Cost per Patient", () => {
    const sheet = wb.getWorksheet("Summary");
    expect(sheet).toBeDefined();
    const val = getCellValue(sheet!, 11, 2);
    expect(isFormula(val)).toBe(true);
    expect(getFormula(val)).toContain("IF");
  });
});
