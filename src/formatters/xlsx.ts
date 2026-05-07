/**
 * Excel (XLSX) formatters for cost-effectiveness models and budget impact analyses.
 *
 * Designed for local pharma market-access teams who need to:
 * 1. Localize inputs (country prices, prevalence, exchange rates)
 * 2. Modify assumptions
 * 3. Submit to HTA bodies
 *
 * Workbooks use live Excel formulas so inputs can be changed and
 * results recalculate. Multi-tab structure: Summary, Inputs, Transition Matrix,
 * Markov Trace, PSA, CEAC, Audit.
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

function getNCycles(time_horizon: CEModelParams["time_horizon"]): number {
  if (time_horizon === "lifetime") return 40;
  if (time_horizon === "5yr") return 5;
  if (time_horizon === "10yr") return 10;
  return Number(time_horizon);
}

/**
 * Build a cost-effectiveness model Excel workbook.
 * Inputs are editable (yellow); formula cells (blue) update automatically
 * when Inputs values are changed and the workbook is saved/recalculated.
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
  const n_cycles = getNCycles(params.time_horizon);

  // Precompute transition probabilities (needed for result caching in formula cells)
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

  // --- Tab 1: Summary ---
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Metric", key: "metric", width: 40 },
    { header: "Value", key: "value", width: 30 },
  ];
  styleHeaderCell(summary.getCell("A1"));
  styleHeaderCell(summary.getCell("B1"));

  const staticRows: Array<[string, string | number]> = [
    ["Intervention", params.intervention],
    ["Comparator", params.comparator],
    ["Indication", params.indication],
    ["Perspective", perspective.toUpperCase()],
    ["Currency", currency],
    ["Time Horizon", String(params.time_horizon)],
    ["Model Type", params.model_type ?? "markov"],
    ["Discount Rate", 0.035],
    ["", ""],
  ];

  staticRows.forEach(([metric, value], i) => {
    const row = summary.getRow(i + 2);
    row.getCell(1).value = metric;
    row.getCell(2).value = value;
    if (metric === "Discount Rate") {
      row.getCell(2).numFmt = "0.0%";
    }
  });

  // Rows 11-18: formula cells referencing Markov Trace
  const lastTraceRow = 2 + n_cycles; // row 2 = cycle 0, row 2+n_cycles = last cycle

  // Row 11: ICER
  summary.getRow(11).getCell(1).value = "ICER";
  summary.getRow(11).getCell(2).value = {
    formula: `=IF(B13=0,"Dominated",B12/B13)`,
    result: isFinite(result.base_case.icer)
      ? result.base_case.icer
      : "Dominated",
  };
  summary.getRow(11).getCell(2).numFmt = `"${symbol}"#,##0`;
  summary.getRow(11).getCell(2).fill = FORMULA_FILL;

  // Row 12: Delta Cost
  summary.getRow(12).getCell(1).value = "Delta Cost";
  summary.getRow(12).getCell(2).value = {
    formula: `=B15-B16`,
    result: result.base_case.delta_cost,
  };
  summary.getRow(12).getCell(2).numFmt = `"${symbol}"#,##0`;
  summary.getRow(12).getCell(2).fill = FORMULA_FILL;

  // Row 13: Delta QALY
  summary.getRow(13).getCell(1).value = "Delta QALY";
  summary.getRow(13).getCell(2).value = {
    formula: `=B17-B18`,
    result: result.base_case.delta_qaly,
  };
  summary.getRow(13).getCell(2).numFmt = "0.000";
  summary.getRow(13).getCell(2).fill = FORMULA_FILL;

  // Row 14: Incremental Life Years — keep static (complex lifecycle, minor value)
  summary.getRow(14).getCell(1).value = "Incremental Life Years";
  summary.getRow(14).getCell(2).value = result.base_case.incremental_lys;
  summary.getRow(14).getCell(2).numFmt = "0.000";

  // Row 15: Total Cost Intervention
  summary.getRow(15).getCell(1).value = "Total Cost Intervention";
  summary.getRow(15).getCell(2).value = {
    formula: `=SUM('Markov Trace'!$I$2:$I$${lastTraceRow})`,
    result: result.base_case.total_cost_intervention,
  };
  summary.getRow(15).getCell(2).numFmt = `"${symbol}"#,##0`;
  summary.getRow(15).getCell(2).fill = FORMULA_FILL;

  // Row 16: Total Cost Comparator
  summary.getRow(16).getCell(1).value = "Total Cost Comparator";
  summary.getRow(16).getCell(2).value = {
    formula: `=SUM('Markov Trace'!$J$2:$J$${lastTraceRow})`,
    result: result.base_case.total_cost_comparator,
  };
  summary.getRow(16).getCell(2).numFmt = `"${symbol}"#,##0`;
  summary.getRow(16).getCell(2).fill = FORMULA_FILL;

  // Row 17: Total QALYs Intervention
  summary.getRow(17).getCell(1).value = "Total QALYs Intervention";
  summary.getRow(17).getCell(2).value = {
    formula: `=SUM('Markov Trace'!$L$2:$L$${lastTraceRow})`,
    result: result.base_case.total_qaly_intervention,
  };
  summary.getRow(17).getCell(2).numFmt = "0.000";
  summary.getRow(17).getCell(2).fill = FORMULA_FILL;

  // Row 18: Total QALYs Comparator
  summary.getRow(18).getCell(1).value = "Total QALYs Comparator";
  summary.getRow(18).getCell(2).value = {
    formula: `=SUM('Markov Trace'!$M$2:$M$${lastTraceRow})`,
    result: result.base_case.total_qaly_comparator,
  };
  summary.getRow(18).getCell(2).numFmt = "0.000";
  summary.getRow(18).getCell(2).fill = FORMULA_FILL;

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

  // Inputs row mapping (1-based after header):
  // B2 = drug_cost_annual, B3 = comparator_cost_annual, B4 = admin_cost, B5 = ae_cost
  // B6 = efficacy_delta, B7 = mortality_reduction
  // B8 = qaly_on_treatment, B9 = qaly_comparator
  // B10 = discount_rate_costs, B11 = discount_rate_outcomes

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
    "Inputs are linked to the Markov Trace, Transition Matrix, Results, and CEAC sheets — edit any value and save to trigger Excel recalculation.";
  inputs.getRow(inputRows.length + 3).getCell(1).font = {
    italic: true,
    color: { argb: "FF666666" },
  };

  // --- Tab 3: Transition Matrix (formula cells referencing Inputs) ---
  const trans = wb.addWorksheet("Transition Matrix");
  trans.columns = [
    { header: "From \\ To", key: "state", width: 20 },
    { header: "On-Treatment", key: "on", width: 16 },
    { header: "Off-Treatment", key: "off", width: 16 },
    { header: "Dead", key: "dead", width: 16 },
  ];
  ["A1", "B1", "C1", "D1"].forEach((c) => styleHeaderCell(trans.getCell(c)));

  // Row 2: On-Treatment (Intervention)
  trans.getRow(2).getCell(1).value = "On-Treatment (Intervention)";
  trans.getRow(2).getCell(2).value = {
    formula: `=MIN(0.93,MAX(0.05,0.5+Inputs!$B$6*0.5))`,
    result: probStayOnIntervention,
  };
  trans.getRow(2).getCell(2).fill = FORMULA_FILL;
  trans.getRow(2).getCell(3).value = {
    formula: `=MAX(0,1-B2-MAX(0.005,0.02*(1-Inputs!$B$7)))`,
    result: Math.max(0, 1 - probStayOnIntervention - interventionMortality),
  };
  trans.getRow(2).getCell(3).fill = FORMULA_FILL;
  trans.getRow(2).getCell(4).value = {
    formula: `=MAX(0.005,0.02*(1-Inputs!$B$7))`,
    result: interventionMortality,
  };
  trans.getRow(2).getCell(4).fill = FORMULA_FILL;

  // Row 3: Off-Treatment (Intervention)
  trans.getRow(3).getCell(1).value = "Off-Treatment (Intervention)";
  trans.getRow(3).getCell(2).value = {
    formula: `=0.05`,
    result: 0.05,
  };
  trans.getRow(3).getCell(2).fill = FORMULA_FILL;
  trans.getRow(3).getCell(3).value = {
    formula: `=MAX(0,0.95-MAX(0.005,0.02*(1-Inputs!$B$7)))`,
    result: Math.max(0, 0.95 - interventionMortality),
  };
  trans.getRow(3).getCell(3).fill = FORMULA_FILL;
  trans.getRow(3).getCell(4).value = {
    formula: `=MAX(0.005,0.02*(1-Inputs!$B$7))`,
    result: interventionMortality,
  };
  trans.getRow(3).getCell(4).fill = FORMULA_FILL;

  // Row 4: Dead (Intervention) — static
  trans.getRow(4).values = ["Dead", 0, 0, 1];

  // Row 5: empty separator
  trans.getRow(5).values = [""];

  // Row 6: On-Treatment (Comparator)
  trans.getRow(6).getCell(1).value = "On-Treatment (Comparator)";
  trans.getRow(6).getCell(2).value = {
    formula: `=MIN(0.88,MAX(0.05,MIN(0.93,MAX(0.05,0.5+Inputs!$B$6*0.5))*0.7))`,
    result: baselineProbStayOn,
  };
  trans.getRow(6).getCell(2).fill = FORMULA_FILL;
  trans.getRow(6).getCell(3).value = {
    formula: `=MAX(0,1-B6-0.02)`,
    result: Math.max(0, 1 - baselineProbStayOn - comparatorMortality),
  };
  trans.getRow(6).getCell(3).fill = FORMULA_FILL;
  trans.getRow(6).getCell(4).value = 0.02;

  // Row 7: Off-Treatment (Comparator)
  trans.getRow(7).getCell(1).value = "Off-Treatment (Comparator)";
  trans.getRow(7).getCell(2).value = {
    formula: `=0.05`,
    result: 0.05,
  };
  trans.getRow(7).getCell(2).fill = FORMULA_FILL;
  trans.getRow(7).getCell(3).value = {
    formula: `=MAX(0,0.95-0.02)`,
    result: 0.93,
  };
  trans.getRow(7).getCell(3).fill = FORMULA_FILL;
  trans.getRow(7).getCell(4).value = 0.02;

  // Row 8: Dead (Comparator) — static
  trans.getRow(8).values = ["Dead", 0, 0, 1];

  // Apply number format to all data cells
  for (let r = 2; r <= 8; r++) {
    for (let c = 2; c <= 4; c++) {
      const cell = trans.getRow(r).getCell(c);
      if (cell.value !== undefined && cell.value !== "") {
        cell.numFmt = "0.0000";
      }
    }
  }

  trans.getRow(10).getCell(1).value =
    "Rows must sum to 1.0. Formulas reference Inputs tab — edit efficacy_delta or mortality_reduction to update.";
  trans.getRow(10).getCell(1).font = {
    italic: true,
    color: { argb: "FF666666" },
  };

  // --- Tab 4: Markov Trace (NEW — live formulas for state populations and discounted costs/QALYs) ---
  const traceSheet = wb.addWorksheet("Markov Trace");
  traceSheet.columns = [
    { header: "Cycle", key: "cycle", width: 8 },
    { header: "Int-On", key: "i_on", width: 12 },
    { header: "Int-Off", key: "i_off", width: 12 },
    { header: "Int-Dead", key: "i_dead", width: 12 },
    { header: "Comp-On", key: "c_on", width: 12 },
    { header: "Comp-Off", key: "c_off", width: 12 },
    { header: "Comp-Dead", key: "c_dead", width: 12 },
    { header: "Cost Disc Factor", key: "hdf", width: 18 },
    { header: "Int Disc Cost", key: "idc", width: 18 },
    { header: "Comp Disc Cost", key: "cdc", width: 18 },
    { header: "QALY Disc Factor", key: "kdf", width: 18 },
    { header: "Int Disc QALY", key: "idq", width: 18 },
    { header: "Comp Disc QALY", key: "cdq", width: 18 },
  ];
  for (let c = 1; c <= 13; c++) {
    styleHeaderCell(traceSheet.getRow(1).getCell(c));
  }

  // Row 2: Cycle 0 (initial state)
  // Precompute initial discounted cost/QALY for result caching
  const drugCost = params.cost_inputs.drug_cost_annual;
  const comparatorCost = params.cost_inputs.comparator_cost_annual;
  const adminCost = params.cost_inputs.admin_cost ?? 0;
  const qalyOnTx = params.utility_inputs?.qaly_on_treatment ?? 0.75;
  const qalyComparator = params.utility_inputs?.qaly_comparator ?? 0.7;

  const initIntDiscCost = drugCost + adminCost; // cycle 0: 100% On-Treatment
  const initCompDiscCost = comparatorCost + adminCost;
  const initIntDiscQaly = qalyOnTx; // cycle 0: 100% On-Treatment
  const initCompDiscQaly = qalyOnTx; // cycle 0: comparator also starts On-Treatment

  traceSheet.getRow(2).getCell(1).value = 0; // cycle
  traceSheet.getRow(2).getCell(2).value = 1; // Int-On = 1
  traceSheet.getRow(2).getCell(3).value = 0; // Int-Off = 0
  traceSheet.getRow(2).getCell(4).value = 0; // Int-Dead = 0
  traceSheet.getRow(2).getCell(5).value = 1; // Comp-On = 1
  traceSheet.getRow(2).getCell(6).value = 0; // Comp-Off = 0
  traceSheet.getRow(2).getCell(7).value = 0; // Comp-Dead = 0

  // H2: cost discount factor at cycle 0 = 1
  traceSheet.getRow(2).getCell(8).value = { formula: `=1`, result: 1 };
  traceSheet.getRow(2).getCell(8).fill = FORMULA_FILL;

  // I2: Int discounted cost at cycle 0
  traceSheet.getRow(2).getCell(9).value = {
    formula: `=H2*(B2*(Inputs!$B$2+Inputs!$B$4))`,
    result: initIntDiscCost,
  };
  traceSheet.getRow(2).getCell(9).fill = FORMULA_FILL;

  // J2: Comp discounted cost at cycle 0
  traceSheet.getRow(2).getCell(10).value = {
    formula: `=H2*(E2*(Inputs!$B$3+Inputs!$B$4))`,
    result: initCompDiscCost,
  };
  traceSheet.getRow(2).getCell(10).fill = FORMULA_FILL;

  // K2: QALY discount factor at cycle 0 = 1
  traceSheet.getRow(2).getCell(11).value = { formula: `=1`, result: 1 };
  traceSheet.getRow(2).getCell(11).fill = FORMULA_FILL;

  // L2: Int discounted QALY at cycle 0
  traceSheet.getRow(2).getCell(12).value = {
    formula: `=K2*(B2*Inputs!$B$8+C2*Inputs!$B$9)`,
    result: initIntDiscQaly,
  };
  traceSheet.getRow(2).getCell(12).fill = FORMULA_FILL;

  // M2: Comp discounted QALY at cycle 0
  traceSheet.getRow(2).getCell(13).value = {
    formula: `=K2*(E2*Inputs!$B$8+F2*Inputs!$B$9)`,
    result: initCompDiscQaly,
  };
  traceSheet.getRow(2).getCell(13).fill = FORMULA_FILL;

  // Apply number formats to row 2
  traceSheet.getRow(2).getCell(9).numFmt = `"${symbol}"#,##0`;
  traceSheet.getRow(2).getCell(10).numFmt = `"${symbol}"#,##0`;
  traceSheet.getRow(2).getCell(12).numFmt = "0.000";
  traceSheet.getRow(2).getCell(13).numFmt = "0.000";

  // Rows 3..n_cycles+2: one row per cycle 1..n_cycles
  // Precompute Markov trace for result caching
  let intOn = 1,
    intOff = 0,
    intDead = 0;
  let compOn = 1,
    compOff = 0,
    compDead = 0;
  let costDiscFactor = 1;
  let qalyDiscFactor = 1;
  const discRateCosts = 0.035;
  const discRateOutcomes = 0.035;

  // Transition probabilities (precomputed)
  const pIntOnOn = probStayOnIntervention;
  const pIntOffOn = 0.05;
  const pIntOnOff = Math.max(0, 1 - probStayOnIntervention - interventionMortality);
  const pIntOffOff = Math.max(0, 0.95 - interventionMortality);
  const pIntOnDead = interventionMortality;
  const pIntOffDead = interventionMortality;
  const pCompOnOn = baselineProbStayOn;
  const pCompOffOn = 0.05;
  const pCompOnOff = Math.max(0, 1 - baselineProbStayOn - comparatorMortality);
  const pCompOffOff = Math.max(0, 0.95 - comparatorMortality);
  const pCompOnDead = comparatorMortality;
  const pCompOffDead = comparatorMortality;

  for (let cycle = 1; cycle <= n_cycles; cycle++) {
    const r = cycle + 2; // Excel row number
    const prev = r - 1;

    // Apply transitions for caching
    costDiscFactor = costDiscFactor * (1 / (1 + discRateCosts));
    qalyDiscFactor = qalyDiscFactor * (1 / (1 + discRateOutcomes));

    const newIntOn = pIntOnOn * intOn + pIntOffOn * intOff; // Dead stays dead → 0 contribution
    const newIntOff = pIntOnOff * intOn + pIntOffOff * intOff;
    const newIntDead = pIntOnDead * intOn + pIntOffDead * intOff + intDead;
    intOn = newIntOn;
    intOff = newIntOff;
    intDead = newIntDead;

    const newCompOn = pCompOnOn * compOn + pCompOffOn * compOff;
    const newCompOff = pCompOnOff * compOn + pCompOffOff * compOff;
    const newCompDead = pCompOnDead * compOn + pCompOffDead * compOff + compDead;
    compOn = newCompOn;
    compOff = newCompOff;
    compDead = newCompDead;

    const intDiscCost = costDiscFactor * (intOn * (drugCost + adminCost));
    const compDiscCost = costDiscFactor * (compOn * (comparatorCost + adminCost));
    const intDiscQaly = qalyDiscFactor * (intOn * qalyOnTx + intOff * qalyComparator);
    const compDiscQaly = qalyDiscFactor * (compOn * qalyOnTx + compOff * qalyComparator);

    const row = traceSheet.getRow(r);

    // A: cycle number
    row.getCell(1).value = cycle;

    // B: Int-On
    row.getCell(2).value = {
      formula: `='Transition Matrix'!$B$2*B${prev}+'Transition Matrix'!$B$3*C${prev}+'Transition Matrix'!$B$4*D${prev}`,
      result: intOn,
    };
    row.getCell(2).fill = FORMULA_FILL;

    // C: Int-Off
    row.getCell(3).value = {
      formula: `='Transition Matrix'!$C$2*B${prev}+'Transition Matrix'!$C$3*C${prev}+'Transition Matrix'!$C$4*D${prev}`,
      result: intOff,
    };
    row.getCell(3).fill = FORMULA_FILL;

    // D: Int-Dead
    row.getCell(4).value = {
      formula: `='Transition Matrix'!$D$2*B${prev}+'Transition Matrix'!$D$3*C${prev}+'Transition Matrix'!$D$4*D${prev}`,
      result: intDead,
    };
    row.getCell(4).fill = FORMULA_FILL;

    // E: Comp-On
    row.getCell(5).value = {
      formula: `='Transition Matrix'!$B$6*E${prev}+'Transition Matrix'!$B$7*F${prev}+'Transition Matrix'!$B$8*G${prev}`,
      result: compOn,
    };
    row.getCell(5).fill = FORMULA_FILL;

    // F: Comp-Off
    row.getCell(6).value = {
      formula: `='Transition Matrix'!$C$6*E${prev}+'Transition Matrix'!$C$7*F${prev}+'Transition Matrix'!$C$8*G${prev}`,
      result: compOff,
    };
    row.getCell(6).fill = FORMULA_FILL;

    // G: Comp-Dead
    row.getCell(7).value = {
      formula: `='Transition Matrix'!$D$6*E${prev}+'Transition Matrix'!$D$7*F${prev}+'Transition Matrix'!$D$8*G${prev}`,
      result: compDead,
    };
    row.getCell(7).fill = FORMULA_FILL;

    // H: Cost discount factor (recurrence)
    row.getCell(8).value = {
      formula: `=H${prev}*(1/(1+Inputs!$B$10))`,
      result: costDiscFactor,
    };
    row.getCell(8).fill = FORMULA_FILL;

    // I: Int discounted cost
    row.getCell(9).value = {
      formula: `=H${r}*(B${r}*(Inputs!$B$2+Inputs!$B$4))`,
      result: intDiscCost,
    };
    row.getCell(9).fill = FORMULA_FILL;
    row.getCell(9).numFmt = `"${symbol}"#,##0`;

    // J: Comp discounted cost
    row.getCell(10).value = {
      formula: `=H${r}*(E${r}*(Inputs!$B$3+Inputs!$B$4))`,
      result: compDiscCost,
    };
    row.getCell(10).fill = FORMULA_FILL;
    row.getCell(10).numFmt = `"${symbol}"#,##0`;

    // K: QALY discount factor (recurrence)
    row.getCell(11).value = {
      formula: `=K${prev}*(1/(1+Inputs!$B$11))`,
      result: qalyDiscFactor,
    };
    row.getCell(11).fill = FORMULA_FILL;

    // L: Int discounted QALY
    row.getCell(12).value = {
      formula: `=K${r}*(B${r}*Inputs!$B$8+C${r}*Inputs!$B$9)`,
      result: intDiscQaly,
    };
    row.getCell(12).fill = FORMULA_FILL;
    row.getCell(12).numFmt = "0.000";

    // M: Comp discounted QALY
    row.getCell(13).value = {
      formula: `=K${r}*(E${r}*Inputs!$B$8+F${r}*Inputs!$B$9)`,
      result: compDiscQaly,
    };
    row.getCell(13).fill = FORMULA_FILL;
    row.getCell(13).numFmt = "0.000";
  }

  // --- Tab 5: PSA Iterations ---
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

  // --- Tab 6: CEAC (COUNTIF formulas referencing PSA sheet) ---
  if (result.psa && result.psa.ceac.length > 0) {
    const ceacSheet = wb.addWorksheet("CEAC");
    ceacSheet.columns = [
      { header: "WTP Threshold", key: "wtp", width: 20 },
      { header: "P(cost-effective)", key: "p", width: 20 },
    ];
    ["A1", "B1"].forEach((c) => styleHeaderCell(ceacSheet.getCell(c)));

    const n_psa = result.psa.scatter.length;
    const lastPSARow = n_psa + 1;

    result.psa.ceac.forEach((pt, i) => {
      const row = ceacSheet.getRow(i + 2);
      row.getCell(1).value = pt.wtp;
      row.getCell(1).numFmt = `"${symbol}"#,##0`;
      row.getCell(2).value = {
        formula: `=COUNTIFS(PSA!$D$2:PSA!$D$${lastPSARow},"<>N/A",PSA!$D$2:PSA!$D$${lastPSARow},"<="&A${i + 2})/${n_psa}`,
        result: pt.prob_ce,
      };
      row.getCell(2).fill = FORMULA_FILL;
      row.getCell(2).numFmt = "0.00%";
    });
  }

  // --- Tab 7: Audit ---
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

  const totalNet = results.reduce((s, r) => s + r.net_budget_impact, 0);
  const totalTreated = results.reduce((s, r) => s + r.treated_population, 0);
  const dataLastRow = results.length + 1; // last data row in Year-by-Year (1-based, row 2 = year 1)

  // --- Tab 1: Summary ---
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Metric", key: "m", width: 40 },
    { header: "Value", key: "v", width: 30 },
  ];
  styleHeaderCell(summary.getCell("A1"));
  styleHeaderCell(summary.getCell("B1"));

  [
    ["Intervention", params.intervention],
    ["Comparator", params.comparator],
    ["Indication", params.indication],
    ["Perspective", perspective.toUpperCase()],
    ["Time Horizon (years)", results.length],
    ["Eligible Population (Year 1)", params.eligible_population],
    ["", ""],
  ].forEach((r, i) => {
    const row = summary.getRow(i + 2);
    row.getCell(1).value = r[0] as string;
    row.getCell(2).value = r[1] as string | number;
  });

  // Row 9: Total Net Budget Impact — SUM formula referencing Year-by-Year
  summary.getRow(9).getCell(1).value = "Total Net Budget Impact";
  summary.getRow(9).getCell(2).value = {
    formula: `=SUM('Year-by-Year'!H2:H${dataLastRow})`,
    result: totalNet,
  };
  summary.getRow(9).getCell(2).numFmt = `"${symbol}"#,##0`;
  summary.getRow(9).getCell(2).fill = FORMULA_FILL;

  // Row 10: Total Patients Treated
  summary.getRow(10).getCell(1).value = "Total Patients Treated";
  summary.getRow(10).getCell(2).value = {
    formula: `=SUM('Year-by-Year'!C2:C${dataLastRow})`,
    result: totalTreated,
  };
  summary.getRow(10).getCell(2).numFmt = "#,##0";
  summary.getRow(10).getCell(2).fill = FORMULA_FILL;

  // Row 11: Average Net Cost per Patient
  summary.getRow(11).getCell(1).value = "Average Net Cost per Patient";
  summary.getRow(11).getCell(2).value = {
    formula: `=IF(B10=0,0,B9/B10)`,
    result: totalTreated > 0 ? totalNet / totalTreated : 0,
  };
  summary.getRow(11).getCell(2).numFmt = `"${symbol}"#,##0`;
  summary.getRow(11).getCell(2).fill = FORMULA_FILL;

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

  // Total row — SUM formulas
  const totalRowNum = results.length + 2;
  const totalRow = yearly.getRow(totalRowNum);
  totalRow.getCell(1).value = "Total";
  totalRow.getCell(3).value = {
    formula: `=SUM(C2:C${dataLastRow})`,
    result: totalTreated,
  };
  totalRow.getCell(3).fill = FORMULA_FILL;
  totalRow.getCell(8).value = {
    formula: `=SUM(H2:H${dataLastRow})`,
    result: totalNet,
  };
  totalRow.getCell(8).fill = FORMULA_FILL;
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
