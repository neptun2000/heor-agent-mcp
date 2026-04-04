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

describe("JCA dossier", () => {
  it("generates JCA sections with default PICO when none provided", async () => {
    const result = await handleHtaDossierPrep({
      hta_body: "jca",
      submission_type: "initial",
      drug_name: "nivolumab",
      indication: "non-small cell lung cancer",
    });
    expect(result.content as string).toContain("Joint Clinical Assessment");
    expect(result.content as string).toContain("PICO-1");
    expect(result.content as string).toContain(
      "comparative clinical effectiveness",
    );
  });

  it("generates per-PICO sections when picos array provided", async () => {
    const result = await handleHtaDossierPrep({
      hta_body: "jca",
      submission_type: "initial",
      drug_name: "nivolumab",
      indication: "non-small cell lung cancer",
      picos: [
        {
          id: "PICO-1",
          population: "PD-L1 ≥50%",
          comparator: "pembrolizumab",
          outcomes: ["OS", "PFS"],
        },
        {
          id: "PICO-2",
          population: "PD-L1 1-49%",
          comparator: "chemotherapy",
          outcomes: ["OS", "QoL"],
        },
      ],
    });
    const content = result.content as string;
    expect(content).toContain("PICO-1");
    expect(content).toContain("PICO-2");
    expect(content).toContain("pembrolizumab");
    expect(content).toContain("chemotherapy");
  });

  it("warns when no picos provided", async () => {
    const result = await handleHtaDossierPrep({
      hta_body: "jca",
      submission_type: "initial",
      drug_name: "nivolumab",
      indication: "NSCLC",
    });
    expect(result.audit.warnings.some((w) => w.includes("default PICO"))).toBe(
      true,
    );
  });

  it("flags JCA as clinical-only in assumptions", async () => {
    const result = await handleHtaDossierPrep({
      hta_body: "jca",
      submission_type: "initial",
      drug_name: "nivolumab",
      indication: "NSCLC",
    });
    expect(
      result.audit.assumptions.some((a) => a.includes("cost-effectiveness")),
    ).toBe(true);
  });

  it("includes ITC section with feasibility guidance", async () => {
    const result = await handleHtaDossierPrep({
      hta_body: "jca",
      submission_type: "initial",
      drug_name: "nivolumab",
      indication: "NSCLC",
    });
    expect(result.content as string).toContain("Indirect Treatment Comparison");
    expect(result.content as string).toContain("MAIC");
  });

  it("throws on invalid hta_body", async () => {
    await expect(
      handleHtaDossierPrep({
        hta_body: "unknown_body",
        submission_type: "initial",
        drug_name: "X",
        indication: "Y",
      }),
    ).rejects.toThrow();
  });
});
