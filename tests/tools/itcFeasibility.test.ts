import { handleItcFeasibility } from "../../src/tools/itcFeasibility.js";

describe("handleItcFeasibility", () => {
  it("recommends direct comparison when H2H evidence available", async () => {
    const r = await handleItcFeasibility({
      connected_network: true,
      h2h_available: true,
    });
    const text = r.content as string;
    expect(text).toContain("direct_comparison_preferred");
    expect(text).toContain("NMA can supplement");
  });

  it("recommends direct comparison without network if H2H exists", async () => {
    const r = await handleItcFeasibility({
      connected_network: false,
      h2h_available: true,
    });
    const text = r.content as string;
    expect(text).toContain("direct_comparison_preferred");
    expect(text).toContain("ITC is not required");
  });

  it("recommends unanchored MAIC/STC when no network but IPD + effect modifiers", async () => {
    const r = await handleItcFeasibility({
      connected_network: false,
      h2h_available: false,
      ipd_available_for_intervention: true,
      effect_modifiers_identified: true,
    });
    const text = r.content as string;
    expect(text).toContain("unanchored_maic_stc");
    expect(text).toContain("weakest ITC approach");
    expect(text).toContain("Residual confounding");
  });

  it("returns infeasible when no network, no H2H, no IPD/modifiers", async () => {
    const r = await handleItcFeasibility({
      connected_network: false,
      h2h_available: false,
      ipd_available_for_intervention: false,
      effect_modifiers_identified: false,
    });
    const text = r.content as string;
    expect(text).toContain("infeasible");
  });

  it("recommends anchored MAIC/STC when network + major imbalance + IPD", async () => {
    const r = await handleItcFeasibility({
      connected_network: true,
      effect_modifiers_identified: true,
      effect_modifier_imbalance: "major",
      ipd_available_for_intervention: true,
    });
    const text = r.content as string;
    expect(text).toContain("anchored_maic_stc");
    expect(text).toContain("ESS");
  });

  it("recommends ML-NMR when major imbalance but no IPD", async () => {
    const r = await handleItcFeasibility({
      connected_network: true,
      effect_modifiers_identified: true,
      effect_modifier_imbalance: "major",
      ipd_available_for_intervention: false,
    });
    const text = r.content as string;
    expect(text).toContain("ml_nmr_recommended");
    expect(text).toContain("Phillippo 2020");
  });

  it("flags considerable heterogeneity via meta-regression path", async () => {
    const r = await handleItcFeasibility({
      connected_network: true,
      heterogeneity_i2_pct: 85,
      n_studies_per_comparison: 3,
    });
    const text = r.content as string;
    expect(text).toContain("nmr_subgroup_meta_regression");
    expect(text).toContain("considerable heterogeneity");
  });

  it("recommends full NMA when network is clean and multiple studies per comparison", async () => {
    const r = await handleItcFeasibility({
      connected_network: true,
      effect_modifiers_identified: true,
      effect_modifier_imbalance: "minor",
      n_studies_per_comparison: 3,
      heterogeneity_i2_pct: 30,
    });
    const text = r.content as string;
    expect(text).toContain("full_nma");
    expect(text).toContain("frequentist_nma");
  });

  it("recommends Bucher when single study per comparison", async () => {
    const r = await handleItcFeasibility({
      connected_network: true,
      effect_modifiers_identified: false,
      effect_modifier_imbalance: "minor",
      n_studies_per_comparison: 1,
    });
    const text = r.content as string;
    expect(text).toContain("bucher_anchored");
    expect(text).toContain("transitivity");
  });

  it("cites all four reference frameworks", async () => {
    const r = await handleItcFeasibility({ connected_network: true });
    const text = r.content as string;
    expect(text).toContain("Cope");
    expect(text).toContain("TSD 18");
    expect(text).toContain("Signorovitch");
    expect(text).toContain("Cochrane Handbook");
  });

  it("returns an audit record", async () => {
    const r = await handleItcFeasibility({ connected_network: true });
    expect(r.audit?.tool).toBe("evidence.itc");
  });

  it("validates required connected_network field", async () => {
    await expect(handleItcFeasibility({})).rejects.toThrow();
  });
});
