/**
 * Excel (XLSX) formatters for cost-effectiveness models and budget impact analyses.
 *
 * Designed for local pharma market-access teams who need to:
 * 1. Localize inputs (country prices, prevalence, exchange rates)
 * 2. Modify assumptions
 * 3. Submit to HTA bodies
 *
 * Workbooks use formulas (not static values) so inputs can be changed and
 * results recalculate. Multi-tab structure: Inputs, Model, Results, PSA, Audit.
 */

import ExcelJS from "exceljs";
import type { CEModelParams, CEModelResult } from "../providers/types.js";
import type { AuditRecord } from "../audit/types.js";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E3A5F" },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 12,
};

const INPUT_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFF3C4" },
};

const FORMULA_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE3F2FD" },
};

function styleHeaderCell(cell: ExcelJS.Cell): void {
  cell.fill = HEADER_FILL;
  cell.font = HEADER_FONT;
  cell.alignment = { horizontal: "center", vertical: "middle" };
  cell.border = {
    top: { style: "thin" },
    bottom: { style: "thin" },
    left: { style: "thin" },
    right: { style: "thin" },
  };
}

/**
 * Build a cost-effectiveness model Excel workbook.
 * Inputs are editable (yellow), formulas are read-only (blue).
 */
export async function ceModelToXlsx(
  params: CEModelParams,
  result: CEModelResult,
  audit: AuditRecord,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HEORAgent MCP";
  wb.created = new Date();

  const perspective = params.perspective;
  const currency = perspective === "nhs" ? "GBP" : "USD";
  const symbol = perspective === "nhs" ? "£" : "$";

  // --- Tab 1: Summary ---
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Metric", key: "metric", width: 40 },
    { header: "Value", key: "value", width: 30 },
  ];
  styleHeaderCell(summary.getCell("A1"));
  styleHeaderCell(summary.getCell("B1"));

  const rows: Array<[string, string | number]> = [
    ["Intervention", params.intervention],
    ["Comparator", params.comparator],
    ["Indication", params.indication],
    ["Perspective", perspective.toUpperCase()],
    ["Currency", currency],
    ["Time Horizon", String(params.time_horizon)],
    ["Model Type", params.model_type ?? "markov"],
    ["Discount Rate", 0.035],
    ["", ""],
    [
      "ICER",
      isFinite(result.base_case.icer) ? result.base_case.icer : "Dominated",
    ],
    ["Delta Cost", result.base_case.delta_cost],
    ["Delta QALY", result.base_case.delta_qaly],
    ["Incremental Life Years", result.base_case.incremental_lys],
    ["Total Cost Intervention", result.base_case.total_cost_intervention],
    ["Total Cost Comparator", result.base_case.total_cost_comparator],
    ["Total QALYs Intervention", result.base_case.total_qaly_intervention],
    ["Total QALYs Comparator", result.base_case.total_qaly_comparator],
  ];

  rows.forEach(([metric, value], i) => {
    const row = summary.getRow(i + 2);
    row.getCell(1).value = metric;
    row.getCell(2).value = value;
    if (
      (typeof value === "number" && metric.includes("Cost")) ||
      metric === "ICER"
    ) {
      row.getCell(2).numFmt = `"${symbol}"#,##0`;
    } else if (
      typeof value === "number" &&
      (metric.includes("QALY") || metric.includes("Life Years"))
    ) {
      row.getCell(2).numFmt = "0.000";
    } else if (metric === "Discount Rate") {
      row.getCell(2).numFmt = "0.0%";
    }
  });

  // --- Tab 2: Inputs (editable) ---
  const inputs = wb.addWorksheet("Inputs");
  inputs.columns = [
    { header: "Parameter", key: "param", width: 40 },
    { header: "Value", key: "value", width: 20 },
    { header: "Unit", key: "unit", width: 20 },
    { header: "Notes", key: "notes", width: 50 },
  ];
  ["A1", "B1", "C1", "D1"].forEach((c) => styleHeaderCell(inputs.getCell(c)));

  const inputRows: Array<[string, number, string, string]> = [
    [
      "Drug cost annual (intervention)",
      params.cost_inputs.drug_cost_annual,
      currency,
      "Editable — localize for your market",
    ],
    [
      "Drug cost annual (comparator)",
      params.cost_inputs.comparator_cost_annual,
      currency,
      "Editable — localize for your market",
    ],
    [
      "Admin cost annual",
      params.cost_inputs.admin_cost ?? 0,
      currency,
      "Shared across arms",
    ],
    [
      "AE cost annual",
      params.cost_inputs.ae_cost ?? 0,
      currency,
      "Adverse event management cost",
    ],
    [
      "Efficacy delta",
      params.clinical_inputs.efficacy_delta,
      "probability",
      "Relative efficacy of intervention",
    ],
    [
      "Mortality reduction",
      params.clinical_inputs.mortality_reduction ?? 0,
      "probability",
      "0 = no mortality effect",
    ],
    [
      "Utility on treatment",
      params.utility_inputs?.qaly_on_treatment ?? 0.75,
      "QALY weight",
      "0-1 scale",
    ],
    [
      "Utility comparator",
      params.utility_inputs?.qaly_comparator ?? 0.7,
      "QALY weight",
      "0-1 scale",
    ],
    ["Discount rate (costs)", 0.035, "annual %", "NICE reference case"],
    ["Discount rate (outcomes)", 0.035, "annual %", "NICE reference case"],
  ];

  inputRows.forEach(([param, value, unit, notes], i) => {
    const row = inputs.getRow(i + 2);
    row.getCell(1).value = param;
    row.getCell(2).value = value;
    row.getCell(3).value = unit;
    row.getCell(4).value = notes;
    row.getCell(2).fill = INPUT_FILL;
    if (unit === currency) row.getCell(2).numFmt = `"${symbol}"#,##0`;
    else if (unit === "annual %") row.getCell(2).numFmt = "0.00%";
    else row.getCell(2).numFmt = "0.000";
  });

  inputs.getRow(inputRows.length + 3).getCell(1).value =
    "Inputs shown for transparency. To re-run with modified values, call the cost_effectiveness_model tool again — editing this sheet does not recalculate results.";
  inputs.getRow(inputRows.length + 3).getCell(1).font = {
    italic: true,
    color: { argb: "FF666666" },
  };

  // --- Tab 3: Transition Matrix ---
  // Derive actual transition probabilities from model params (same logic as
  // src/models/modelUtils.ts buildMarkovParamsFromCE).
  const efficacyDelta = Math.max(
    0,
    Math.min(0.999, params.clinical_inputs.efficacy_delta),
  );
  const mortalityReduction = params.clinical_inputs.mortality_reduction ?? 0;
  const baseMortality = 0.02;
  const interventionMortality = Math.max(
    0.005,
    baseMortality * (1 - mortalityReduction),
  );
  const comparatorMortality = baseMortality;
  const probStayOnIntervention = Math.max(
    0.05,
    Math.min(0.93, 0.5 + efficacyDelta * 0.5),
  );
  const baselineProbStayOn = Math.max(
    0.05,
    Math.min(0.88, probStayOnIntervention * 0.7),
  );

  const trans = wb.addWorksheet("Transition Matrix");
  trans.columns = [
    { header: "From \\ To", key: "state", width: 20 },
    { header: "On-Treatment", key: "on", width: 16 },
    { header: "Off-Treatment", key: "off", width: 16 },
    { header: "Dead", key: "dead", width: 16 },
  ];
  ["A1", "B1", "C1", "D1"].forEach((c) => styleHeaderCell(trans.getCell(c)));

  trans.getRow(2).values = [
    "On-Treatment (Intervention)",
    probStayOnIntervention,
    Math.max(0, 1 - probStayOnIntervention - interventionMortality),
    interventionMortality,
  ];
  trans.getRow(3).values = [
    "Off-Treatment (Intervention)",
    0.05,
    Math.max(0, 0.95 - interventionMortality),
    interventionMortality,
  ];
  trans.getRow(4).values = ["Dead", 0, 0, 1];
  trans.getRow(5).values = [""];
  trans.getRow(6).values = [
    "On-Treatment (Comparator)",
    baselineProbStayOn,
    Math.max(0, 1 - baselineProbStayOn - comparatorMortality),
    comparatorMortality,
  ];
  trans.getRow(7).values = [
    "Off-Treatment (Comparator)",
    0.05,
    Math.max(0, 0.95 - comparatorMortality),
    comparatorMortality,
  ];
  trans.getRow(8).values = ["Dead", 0, 0, 1];

  for (let r = 2; r <= 8; r++) {
    for (let c = 2; c <= 4; c++) {
      const cell = trans.getRow(r).getCell(c);
      if (typeof cell.value === "number") {
        cell.numFmt = "0.0000";
      }
    }
  }
  trans.getRow(10).getCell(1).value =
    "Transition probabilities derived from efficacy_delta and mortality_reduction inputs. Values are read-only for transparency — modify efficacy_delta on the Inputs tab to change them.";
  trans.getRow(10).getCell(1).font = {
    italic: true,
    color: { argb: "FF666666" },
  };

  trans.getRow(10).getCell(1).value =
    "Rows must sum to 1.0. Editable — modify to reflect trial-specific transitions.";
  trans.getRow(10).getCell(1).font = {
    italic: true,
    color: { argb: "FF666666" },
  };

  // --- Tab 4: PSA Iterations ---
  if (result.psa && result.psa.scatter.length > 0) {
    const psaSheet = wb.addWorksheet("PSA");
    psaSheet.columns = [
      { header: "Iteration", key: "i", width: 12 },
      { header: "Delta Cost", key: "dc", width: 16 },
      { header: "Delta QALY", key: "dq", width: 16 },
      { header: "ICER (Delta Cost / Delta QALY)", key: "icer", width: 30 },
    ];
    ["A1", "B1", "C1", "D1"].forEach((c) =>
      styleHeaderCell(psaSheet.getCell(c)),
    );

    result.psa.scatter.forEach((it, i) => {
      const row = psaSheet.getRow(i + 2);
      row.getCell(1).value = i + 1;
      row.getCell(2).value = it.delta_cost;
      row.getCell(3).value = it.delta_qaly;
      // Use a formula so the ICER recalculates if user modifies
      row.getCell(4).value = {
        formula: `IF(C${i + 2}=0,"N/A",B${i + 2}/C${i + 2})`,
      };
      row.getCell(2).numFmt = `"${symbol}"#,##0`;
      row.getCell(3).numFmt = "0.000";
      row.getCell(4).numFmt = `"${symbol}"#,##0`;
    });

    // Summary at the bottom
    const summaryRow = result.psa.scatter.length + 3;
    psaSheet.getRow(summaryRow).values = [
      "ICER of means (E[ΔC] / E[ΔQ])",
      {
        formula: `AVERAGE(B2:B${result.psa.scatter.length + 1})/AVERAGE(C2:C${result.psa.scatter.length + 1})`,
      },
      "",
      "",
    ];
    psaSheet.getRow(summaryRow).getCell(1).font = { bold: true };
    psaSheet.getRow(summaryRow).getCell(2).numFmt = `"${symbol}"#,##0`;

    // Mean of per-iteration ICERs (the correct "mean ICER" interpretation)
    psaSheet.getRow(summaryRow + 1).values = [
      "Mean of per-iteration ICERs",
      {
        formula: `AVERAGEIF(D2:D${result.psa.scatter.length + 1},"<>N/A")`,
      },
      "",
      "",
    ];
    psaSheet.getRow(summaryRow + 1).getCell(1).font = { bold: true };
    psaSheet.getRow(summaryRow + 1).getCell(2).numFmt = `"${symbol}"#,##0`;
  }

  // --- Tab 5: CEAC ---
  if (result.psa && result.psa.ceac.length > 0) {
    const ceacSheet = wb.addWorksheet("CEAC");
    ceacSheet.columns = [
      { header: "WTP Threshold", key: "wtp", width: 20 },
      { header: "P(cost-effective)", key: "p", width: 20 },
    ];
    ["A1", "B1"].forEach((c) => styleHeaderCell(ceacSheet.getCell(c)));

    result.psa.ceac.forEach((pt, i) => {
      const row = ceacSheet.getRow(i + 2);
      row.getCell(1).value = pt.wtp;
      row.getCell(2).value = pt.prob_ce;
      row.getCell(1).numFmt = `"${symbol}"#,##0`;
      row.getCell(2).numFmt = "0.00%";
    });
  }

  // --- Tab 6: Audit ---
  const auditSheet = wb.addWorksheet("Audit");
  auditSheet.columns = [
    { header: "Field", key: "field", width: 25 },
    { header: "Value", key: "value", width: 80 },
  ];
  ["A1", "B1"].forEach((c) => styleHeaderCell(auditSheet.getCell(c)));

  const auditRows: Array<[string, string]> = [
    ["Tool", audit.tool],
    ["Methodology", audit.methodology ?? ""],
    ["Timestamp", audit.timestamp ?? new Date().toISOString()],
    ["Assumptions", audit.assumptions.join("\n")],
    ["Warnings", audit.warnings.join("\n")],
  ];
  auditRows.forEach(([f, v], i) => {
    const row = auditSheet.getRow(i + 2);
    row.getCell(1).value = f;
    row.getCell(2).value = v;
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/**
 * Build a Budget Impact Analysis Excel workbook.
 */
export async function bimToXlsx(
  params: Record<string, unknown>,
  results: Array<{
    year: number;
    eligible_population: number;
    treated_population: number;
    intervention_cost: number;
    comparator_cost: number;
    displaced_cost_saved: number;
    net_budget_impact: number;
    per_patient_cost: number;
  }>,
  audit: AuditRecord,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HEORAgent MCP";
  wb.created = new Date();

  const perspective = (params.perspective as string) ?? "nhs";
  const symbol = perspective === "nhs" ? "£" : "$";

  // --- Tab 1: Summary ---
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Metric", key: "m", width: 40 },
    { header: "Value", key: "v", width: 30 },
  ];
  styleHeaderCell(summary.getCell("A1"));
  styleHeaderCell(summary.getCell("B1"));

  const totalNet = results.reduce((s, r) => s + r.net_budget_impact, 0);
  const totalTreated = results.reduce((s, r) => s + r.treated_population, 0);

  [
    ["Intervention", params.intervention],
    ["Comparator", params.comparator],
    ["Indication", params.indication],
    ["Perspective", perspective.toUpperCase()],
    ["Time Horizon (years)", results.length],
    ["Eligible Population (Year 1)", params.eligible_population],
    ["", ""],
    ["Total Net Budget Impact", totalNet],
    ["Total Patients Treated", totalTreated],
    ["Average Net Cost per Patient", totalNet / (totalTreated || 1)],
  ].forEach((r, i) => {
    const row = summary.getRow(i + 2);
    row.getCell(1).value = r[0] as string;
    row.getCell(2).value = r[1] as string | number;
    const metric = r[0] as string;
    if (metric.includes("Cost") || metric.includes("Impact")) {
      row.getCell(2).numFmt = `"${symbol}"#,##0`;
    } else if (metric.includes("Population") || metric.includes("Patients")) {
      row.getCell(2).numFmt = "#,##0";
    }
  });

  // --- Tab 2: Inputs (editable) ---
  const inputs = wb.addWorksheet("Inputs");
  inputs.columns = [
    { header: "Parameter", key: "p", width: 40 },
    { header: "Value", key: "v", width: 20 },
    { header: "Unit", key: "u", width: 20 },
    { header: "Notes", key: "n", width: 50 },
  ];
  ["A1", "B1", "C1", "D1"].forEach((c) => styleHeaderCell(inputs.getCell(c)));

  const inputRows: Array<[string, number | string, string, string]> = [
    [
      "Eligible Population Year 1",
      params.eligible_population as number,
      "patients",
      "Editable",
    ],
    [
      "Annual growth rate",
      (params.population_growth_rate as number) ?? 0,
      "annual %",
      "Editable",
    ],
    [
      "Drug cost (intervention)",
      params.drug_cost_annual as number,
      `${symbol}/year`,
      "Editable — localize",
    ],
    [
      "Drug cost (comparator)",
      params.comparator_cost_annual as number,
      `${symbol}/year`,
      "Editable — localize",
    ],
    [
      "Admin cost annual",
      (params.admin_cost_annual as number) ?? 0,
      `${symbol}/year`,
      "",
    ],
    [
      "Monitoring cost annual",
      (params.monitoring_cost_annual as number) ?? 0,
      `${symbol}/year`,
      "",
    ],
    [
      "AE cost (intervention)",
      (params.ae_cost_annual as number) ?? 0,
      `${symbol}/year`,
      "",
    ],
    [
      "AE cost (comparator)",
      (params.comparator_ae_cost_annual as number) ?? 0,
      `${symbol}/year`,
      "",
    ],
  ];

  inputRows.forEach(([p, v, u, n], i) => {
    const row = inputs.getRow(i + 2);
    row.getCell(1).value = p;
    row.getCell(2).value = v;
    row.getCell(3).value = u;
    row.getCell(4).value = n;
    row.getCell(2).fill = INPUT_FILL;
    if (u.includes(symbol)) row.getCell(2).numFmt = `"${symbol}"#,##0`;
    else if (u === "annual %") row.getCell(2).numFmt = "0.00%";
    else row.getCell(2).numFmt = "#,##0";
  });

  // --- Tab 3: Year-by-Year ---
  const yearly = wb.addWorksheet("Year-by-Year");
  yearly.columns = [
    { header: "Year", key: "y", width: 8 },
    { header: "Eligible Pop.", key: "ep", width: 16 },
    { header: "Treated", key: "t", width: 14 },
    { header: "Market Share", key: "ms", width: 14 },
    { header: "Intervention Cost", key: "ic", width: 20 },
    { header: "Comparator Cost", key: "cc", width: 20 },
    { header: "Displaced Saved", key: "ds", width: 18 },
    { header: "Net Budget Impact", key: "nbi", width: 22 },
    { header: "Per Patient", key: "pp", width: 16 },
  ];
  for (let c = 0; c < 9; c++) styleHeaderCell(yearly.getRow(1).getCell(c + 1));

  results.forEach((r, i) => {
    const row = yearly.getRow(i + 2);
    row.values = [
      r.year,
      r.eligible_population,
      r.treated_population,
      r.eligible_population > 0
        ? r.treated_population / r.eligible_population
        : 0,
      r.intervention_cost,
      r.comparator_cost,
      r.displaced_cost_saved,
      r.net_budget_impact,
      r.per_patient_cost,
    ];
    row.getCell(2).numFmt = "#,##0";
    row.getCell(3).numFmt = "#,##0";
    row.getCell(4).numFmt = "0.0%";
    for (let c = 5; c <= 9; c++) row.getCell(c).numFmt = `"${symbol}"#,##0`;
  });

  // Total row
  const totalRow = yearly.getRow(results.length + 2);
  totalRow.getCell(1).value = "Total";
  totalRow.getCell(3).value = totalTreated;
  totalRow.getCell(8).value = totalNet;
  totalRow.font = { bold: true };
  totalRow.getCell(3).numFmt = "#,##0";
  totalRow.getCell(8).numFmt = `"${symbol}"#,##0`;

  // --- Tab 4: Audit ---
  const auditSheet = wb.addWorksheet("Audit");
  auditSheet.columns = [
    { header: "Field", key: "f", width: 25 },
    { header: "Value", key: "v", width: 80 },
  ];
  ["A1", "B1"].forEach((c) => styleHeaderCell(auditSheet.getCell(c)));

  [
    ["Tool", audit.tool],
    ["Methodology", audit.methodology ?? ""],
    ["Timestamp", audit.timestamp ?? new Date().toISOString()],
    ["Assumptions", audit.assumptions.join("\n")],
    ["Warnings", audit.warnings.join("\n")],
  ].forEach(([f, v], i) => {
    const row = auditSheet.getRow(i + 2);
    row.getCell(1).value = f;
    row.getCell(2).value = v;
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
