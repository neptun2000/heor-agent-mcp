import { handleHtaDossierPrep } from "../../src/tools/htaDossierPrep.js";
import type { DossierParams } from "../../src/providers/types.js";

const baseParams: DossierParams = {
  hta_body: "nice",
  submission_type: "sta",
  drug_name: "semaglutide",
  indication: "type 2 diabetes",
};

describe("handleHtaDossierPrep", () => {
  it("returns ToolResult with audit", async () => {
    const result = await handleHtaDossierPrep(baseParams);
    expect(result.audit.tool).toBe("hta_dossier_prep");
    expect(result.audit.methodology).toContain("NICE STA");
  });

  it("includes PICO section for NICE STA", async () => {
    const result = await handleHtaDossierPrep(baseParams);
    expect(result.content as string).toContain("Population");
    expect(result.content as string).toContain("Intervention");
    expect(result.content as string).toContain("Comparator");
    expect(result.content as string).toContain("Outcome");
  });

  it("flags missing evidence as gaps", async () => {
    const result = await handleHtaDossierPrep(baseParams);
    expect(result.content as string).toContain("⚠️");
  });

  it("incorporates evidence_summary when provided", async () => {
    const result = await handleHtaDossierPrep({
      ...baseParams,
      evidence_summary: "Three RCTs showed semaglutide reduced HbA1c by 1.5%",
    });
    expect(result.content as string).toContain("semaglutide reduced HbA1c");
  });

  it("records template version in audit assumptions", async () => {
    const result = await handleHtaDossierPrep(baseParams);
    expect(result.audit.assumptions.some((a) => a.includes("NICE STA"))).toBe(
      true,
    );
  });

  it("throws on missing required field", async () => {
    await expect(handleHtaDossierPrep({})).rejects.toThrow();
  });
});
