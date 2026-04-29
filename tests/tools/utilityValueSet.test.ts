import { handleUtilityValueSet } from "../../src/tools/utilityValueSet.js";

describe("handleUtilityValueSet", () => {
  describe("action: compare", () => {
    it("returns a comparison of all four value sets", async () => {
      const result = await handleUtilityValueSet({ action: "compare" });
      const text = result.content as string;
      expect(text).toContain("UK 3L");
      expect(text).toContain("England 5L");
      expect(text).toContain("UK 5L (NEW)");
      expect(text).toContain("DSU Mapping");
    });

    it("includes all four worst-state values from the OHE table", async () => {
      const result = await handleUtilityValueSet({ action: "compare" });
      const text = result.content as string;
      expect(text).toContain("-0.594"); // UK 3L worst state
      expect(text).toContain("-0.285"); // England 5L worst state
      expect(text).toContain("-0.567"); // UK 5L new worst state
      expect(text).toContain("-0.524"); // DSU mapping worst state
    });

    it("flags the shift in dimension weights", async () => {
      const result = await handleUtilityValueSet({ action: "compare" });
      const text = result.content as string;
      expect(text).toContain("25.2");
      expect(text).toContain("17.8");
      expect(text).toContain("Key shift");
    });

    it("mentions the NICE consultation window", async () => {
      const result = await handleUtilityValueSet({ action: "compare" });
      const text = result.content as string;
      expect(text).toContain("2026-04-15");
      expect(text).toContain("2026-05-13");
    });
  });

  describe("action: lookup", () => {
    it("returns details for the new UK 5L value set", async () => {
      const result = await handleUtilityValueSet({
        action: "lookup",
        value_set: "uk_5l_new",
      });
      const text = result.content as string;
      expect(text).toContain("UK EQ-5D-5L (NEW 2026)");
      expect(text).toContain("cTTO");
      expect(text).toContain("1,200"); // respondents
      expect(text).toContain("consultation");
    });

    it("returns error if value_set is missing for lookup", async () => {
      const result = await handleUtilityValueSet({ action: "lookup" });
      const text = result.content as string;
      expect(text).toContain("requires");
      expect(text).toContain("value_set");
    });

    it("shows that UK 3L has no 'slight' mildest state", async () => {
      const result = await handleUtilityValueSet({
        action: "lookup",
        value_set: "uk_3l",
      });
      const text = result.content as string;
      expect(text).toContain("N/A");
    });
  });

  describe("action: estimate_impact", () => {
    it("projects non_cancer_qol_only ICER as +59% when base provided", async () => {
      const result = await handleUtilityValueSet({
        action: "estimate_impact",
        indication_type: "non_cancer_qol_only",
        base_icer: 30000,
      });
      const text = result.content as string;
      expect(text).toContain("47,700"); // 30000 * 1.59
      expect(text).toContain("59");
      expect(text).toContain("-37");
      expect(text).toContain("High-impact category");
    });

    it("lists the QoL-only example indications", async () => {
      const result = await handleUtilityValueSet({
        action: "estimate_impact",
        indication_type: "non_cancer_qol_only",
      });
      const text = result.content as string;
      expect(text).toContain("Migraine");
      expect(text).toContain("Ulcerative colitis");
      expect(text).toContain("Atopic dermatitis");
    });

    it("shows favourable impact for cancer life-extending", async () => {
      const result = await handleUtilityValueSet({
        action: "estimate_impact",
        indication_type: "cancer_life_extending",
        base_icer: 40000,
      });
      const text = result.content as string;
      expect(text).toContain("+13.7%"); // QALY
      expect(text).toContain("more cost effective");
      expect(text).toContain("35,200"); // 40000 * 0.88
    });

    it("handles mixed non_cancer_life_extending category", async () => {
      const result = await handleUtilityValueSet({
        action: "estimate_impact",
        indication_type: "non_cancer_life_extending",
      });
      const text = result.content as string;
      expect(text).toContain("mixed");
      expect(text).toContain("-9.6");
    });

    it("returns error if indication_type is missing", async () => {
      const result = await handleUtilityValueSet({
        action: "estimate_impact",
      });
      const text = result.content as string;
      expect(text).toContain("requires");
      expect(text).toContain("indication_type");
    });

    it("cites Biz et al. 2026", async () => {
      const result = await handleUtilityValueSet({
        action: "estimate_impact",
        indication_type: "non_cancer_qol_only",
      });
      const text = result.content as string;
      expect(text).toContain("Biz");
      expect(text).toContain("Value in Health");
    });

    it("projects incremental QALY when base_incremental_qaly provided", async () => {
      const result = await handleUtilityValueSet({
        action: "estimate_impact",
        indication_type: "non_cancer_qol_only",
        base_incremental_qaly: 0.5,
      });
      const text = result.content as string;
      expect(text).toContain("0.500");
      expect(text).toContain("0.315"); // 0.5 * 0.63
    });
  });

  describe("audit trail", () => {
    it("returns an audit record", async () => {
      const result = await handleUtilityValueSet({ action: "compare" });
      expect(result.audit).toBeDefined();
      expect(result.audit?.tool).toBe("hta.utility");
    });
  });
});
