/**
 * Integration tests for the CE-tool MFN sensitivity wire-in (design log #27).
 *
 * Verifies the end-to-end behaviour: when caller supplies mfn_sensitivity
 * inputs on the CE schema, the tool runs the deterministic price sweep
 * and emits both a structured field on the JSON result and a textual
 * section in the markdown output.
 */
import { handleCostEffectivenessModel } from "../../src/tools/costEffectivenessModel.js";

const baseParams = {
  intervention: "TestDrug",
  comparator: "SoC",
  indication: "Test indication",
  time_horizon: "5yr",
  perspective: "us_payer",
  clinical_inputs: {
    efficacy_delta: 0.05,
    mortality_reduction: 0.01,
  },
  cost_inputs: {
    drug_cost_annual: 200,
    comparator_cost_annual: 50,
  },
  utility_inputs: {
    qaly_on_treatment: 0.8,
    qaly_comparator: 0.7,
  },
  run_psa: false, // skip PSA for speed in this suite
  run_owsa: false,
};

describe("cost_effectiveness_model — MFN sensitivity wire-in", () => {
  it("emits mfn_sensitivity in JSON output when caller supplies mfn_sensitivity inputs", async () => {
    const result = await handleCostEffectivenessModel({
      ...baseParams,
      output_format: "json",
      mfn_sensitivity: {
        min_basket: 100,
        current_us_price: 300,
        n_points: 5,
      },
    });
    const r = result.content as Record<string, unknown>;
    expect(r).toHaveProperty("mfn_sensitivity");
    const mfn = r.mfn_sensitivity as {
      range: { n_points: number };
      curve: Array<{ drug_price: number; icer: number }>;
      crossovers: Array<{ wtp: number; crossover_price: number | null }>;
    };
    expect(mfn.range.n_points).toBe(5);
    expect(mfn.curve).toHaveLength(5);
    // First curve point is the MFN ceiling.
    expect(mfn.curve[0]?.drug_price).toBe(100);
    // Last curve point is the current US price.
    expect(mfn.curve[4]?.drug_price).toBe(300);
    // Default WTP thresholds: 30K, 100K, 150K.
    expect(mfn.crossovers.map((c) => c.wtp).sort((a, b) => a - b)).toEqual([
      30000, 100000, 150000,
    ]);
  });

  it("omits mfn_sensitivity from JSON when caller doesn't supply it", async () => {
    const result = await handleCostEffectivenessModel({
      ...baseParams,
      output_format: "json",
    });
    const r = result.content as Record<string, unknown>;
    expect(r.mfn_sensitivity).toBeUndefined();
  });

  it("renders MFN section in text output with curve table and crossovers", async () => {
    const result = await handleCostEffectivenessModel({
      ...baseParams,
      output_format: "text",
      mfn_sensitivity: {
        min_basket: 100,
        current_us_price: 300,
        n_points: 3,
        wtp_thresholds: [50000, 100000],
      },
    });
    const text = result.content as string;
    expect(text).toContain("### MFN Price Sensitivity");
    expect(text).toContain("MFN ceiling");
    expect(text).toContain("current US");
    // Curve table header
    expect(text).toContain("| Drug price | ICER |");
    // ICER-at-ceiling and ICER-at-current lines
    expect(text).toContain("ICER at MFN ceiling");
    expect(text).toContain("ICER at current US price");
    // WTP crossover bullets — both must appear regardless of outcome
    expect(text).toContain("/QALY");
  });

  it("does NOT render MFN section in text output when not requested", async () => {
    const result = await handleCostEffectivenessModel({
      ...baseParams,
      output_format: "text",
    });
    const text = result.content as string;
    expect(text).not.toContain("### MFN Price Sensitivity");
  });

  it("rejects min_basket > current_us_price at the Zod layer (inverted range)", async () => {
    // The Zod schema doesn't enforce min_basket <= current_us_price (would
    // need .refine()), so this validation happens at runMfnSensitivity.
    // The handler bubbles the TypeError as a rejected promise.
    await expect(
      handleCostEffectivenessModel({
        ...baseParams,
        mfn_sensitivity: {
          min_basket: 300,
          current_us_price: 100,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects negative basket prices at the Zod layer", async () => {
    await expect(
      handleCostEffectivenessModel({
        ...baseParams,
        mfn_sensitivity: {
          min_basket: -10,
          current_us_price: 100,
        },
      }),
    ).rejects.toThrow();
  });
});
