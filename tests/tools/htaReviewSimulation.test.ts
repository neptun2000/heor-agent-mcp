// heor-agent-mcp/tests/tools/htaReviewSimulation.test.ts
// Design log #38 — hta.review_simulation
import {
  htaReviewSimulationSchema,
  htaReviewSimulationHandler,
} from "../../src/tools/htaReviewSimulation.js";

describe("hta.review_simulation — schema", () => {
  it("defaults hta_body to nice and max_questions to 15", () => {
    const p = htaReviewSimulationSchema.parse({
      drug: "seladelpar",
      indication: "primary biliary cholangitis",
    });
    expect(p.hta_body).toBe("nice");
    expect(p.max_questions).toBe(15);
  });

  it("rejects an out-of-scope body (fda → v2)", () => {
    expect(() =>
      htaReviewSimulationSchema.parse({
        drug: "x",
        indication: "y",
        hta_body: "fda",
      }),
    ).toThrow();
  });
});

describe("hta.review_simulation — comparator detector", () => {
  it("fires a Critical comparator question when PICO comparator is unspecified", async () => {
    const r = await htaReviewSimulationHandler({
      drug: "seladelpar",
      indication: "primary biliary cholangitis",
      pico: { population: "adults", intervention: "seladelpar" }, // no comparator
    });
    const q = r.questions.find((x) => x.category === "comparator");
    expect(q).toBeDefined();
    expect(q!.severity).toBe("critical");
    expect(q!.question.length).toBeGreaterThan(0);
  });

  it("fires a Standard comparator question (justify vs SoC) when a comparator IS specified", async () => {
    const r = await htaReviewSimulationHandler({
      drug: "seladelpar",
      indication: "primary biliary cholangitis",
      pico: { comparator: "obeticholic acid" },
    });
    const q = r.questions.find((x) => x.category === "comparator");
    expect(q).toBeDefined();
    expect(q!.severity).toBe("standard");
    expect(q!.question).toContain("obeticholic acid");
  });
});

describe("hta.review_simulation — evidence detectors", () => {
  it("fires Critical indirect_comparison when a comparator is specified but no ITC is presented", async () => {
    const r = await htaReviewSimulationHandler({
      drug: "seladelpar",
      indication: "primary biliary cholangitis",
      pico: { comparator: "obeticholic acid" },
      dossier_markdown: "Seladelpar reduced ALP versus placebo.",
    });
    const q = r.questions.find((x) => x.category === "indirect_comparison");
    expect(q).toBeDefined();
    expect(q!.severity).toBe("critical");
  });

  it("downgrades indirect_comparison to Standard when an ITC is present but assumptions are not addressed", async () => {
    const r = await htaReviewSimulationHandler({
      drug: "seladelpar",
      indication: "primary biliary cholangitis",
      pico: { comparator: "obeticholic acid" },
      dossier_markdown: "We conducted a Bucher ITC versus obeticholic acid.",
    });
    const q = r.questions.find((x) => x.category === "indirect_comparison");
    expect(q).toBeDefined();
    expect(q!.severity).toBe("standard");
  });

  it("fires Standard survival_extrapolation in a survival indication without extrapolation justification", async () => {
    const r = await htaReviewSimulationHandler({
      drug: "drugx",
      indication: "metastatic melanoma",
      dossier_markdown: "Median overall survival improved versus comparator.",
    });
    const q = r.questions.find((x) => x.category === "survival_extrapolation");
    expect(q).toBeDefined();
    expect(q!.severity).toBe("standard");
  });

  it("does NOT fire survival_extrapolation for a non-survival indication", async () => {
    const r = await htaReviewSimulationHandler({
      drug: "seladelpar",
      indication: "primary biliary cholangitis",
      dossier_markdown: "ALP normalisation was the primary endpoint.",
    });
    expect(
      r.questions.find((x) => x.category === "survival_extrapolation"),
    ).toBeUndefined();
  });

  it("fires Standard clinical_rob when the dossier relies on a single-arm study", async () => {
    const r = await htaReviewSimulationHandler({
      drug: "drugx",
      indication: "rare disease",
      dossier_markdown: "Evidence came from a single-arm phase 2 study.",
    });
    const q = r.questions.find((x) => x.category === "clinical_rob");
    expect(q).toBeDefined();
    expect(q!.severity).toBe("standard");
    expect(q!.question.toLowerCase()).toContain("single-arm");
  });
});

describe("hta.review_simulation — economic detectors", () => {
  it("fires Critical economic_model when no economic evaluation is present", async () => {
    const r = await htaReviewSimulationHandler({
      drug: "seladelpar",
      indication: "primary biliary cholangitis",
      dossier_markdown: "ALP normalisation was the primary endpoint.",
    });
    const q = r.questions.find((x) => x.category === "economic_model");
    expect(q).toBeDefined();
    expect(q!.severity).toBe("critical");
  });

  it("fires Standard economic_model (structure) when a model is present but structure is undescribed", async () => {
    const r = await htaReviewSimulationHandler({
      drug: "seladelpar",
      indication: "primary biliary cholangitis",
      model_results: { icer: 20000 },
      dossier_markdown: "The ICER was £20,000 per QALY.",
    });
    const q = r.questions.find((x) => x.category === "economic_model");
    expect(q).toBeDefined();
    expect(q!.severity).toBe("standard");
  });

  it("fires Standard utilities (value set) when EQ-5D-5L is used without a value-set note", async () => {
    const r = await htaReviewSimulationHandler({
      drug: "seladelpar",
      indication: "primary biliary cholangitis",
      dossier_markdown: "Utilities were derived from EQ-5D-5L.",
    });
    const q = r.questions.find((x) => x.category === "utilities");
    expect(q).toBeDefined();
    expect(q!.severity).toBe("standard");
    expect(q!.question.toLowerCase()).toContain("value set");
  });

  it("fires Standard uncertainty when a model is present but no PSA/sensitivity analysis is described", async () => {
    const r = await htaReviewSimulationHandler({
      drug: "seladelpar",
      indication: "primary biliary cholangitis",
      model_results: { icer: 20000 },
      dossier_markdown: "The ICER was £20,000 per QALY.",
    });
    const q = r.questions.find((x) => x.category === "uncertainty");
    expect(q).toBeDefined();
    expect(q!.severity).toBe("standard");
  });
});

describe("hta.review_simulation — context detectors", () => {
  it("fires Standard subgroups for a post-hoc subgroup analysis", async () => {
    const r = await htaReviewSimulationHandler({
      drug: "drugx",
      indication: "rare disease",
      dossier_markdown: "A post-hoc subgroup analysis suggested benefit.",
    });
    const q = r.questions.find((x) => x.category === "subgroups");
    expect(q).toBeDefined();
    expect(q!.severity).toBe("standard");
  });

  it("does NOT fire subgroups when subgroups are pre-specified", async () => {
    const r = await htaReviewSimulationHandler({
      drug: "drugx",
      indication: "rare disease",
      dossier_markdown: "Pre-specified subgroups were analysed.",
    });
    expect(r.questions.find((x) => x.category === "subgroups")).toBeUndefined();
  });

  it("fires Standard rwe when a real-world registry is used without provenance", async () => {
    const r = await htaReviewSimulationHandler({
      drug: "drugx",
      indication: "rare disease",
      dossier_markdown: "Outcomes were drawn from a real-world registry.",
    });
    const q = r.questions.find((x) => x.category === "rwe");
    expect(q).toBeDefined();
    expect(q!.severity).toBe("standard");
  });

  it("fires a Minor innovation prompt for NICE when unmet need is not articulated", async () => {
    const r = await htaReviewSimulationHandler({
      drug: "drugx",
      indication: "rare disease",
      hta_body: "nice",
      dossier_markdown: "Standard clinical results.",
    });
    const q = r.questions.find((x) => x.category === "innovation");
    expect(q).toBeDefined();
    expect(q!.severity).toBe("minor");
  });

  it("fires a Standard added-benefit prompt for G-BA when magnitude is not quantified", async () => {
    const r = await htaReviewSimulationHandler({
      drug: "drugx",
      indication: "rare disease",
      hta_body: "gba_iqwig",
      dossier_markdown: "Standard clinical results.",
    });
    const q = r.questions.find((x) => x.category === "innovation");
    expect(q).toBeDefined();
    expect(q!.severity).toBe("standard");
    expect(q!.question.toLowerCase()).toContain("added benefit");
  });
});

describe("hta.review_simulation — precedent whitelist", () => {
  it("attaches a verified NICE TA precedent to the comparator question when one exists", async () => {
    const r = await htaReviewSimulationHandler({
      drug: "dapagliflozin",
      indication: "HFrEF",
      hta_body: "nice",
      pico: { comparator: "standard care" },
    });
    const q = r.questions.find((x) => x.category === "comparator")!;
    expect(q.precedent).toBeDefined();
    expect(q.precedent!.id).toBe("TA679");
    expect(q.precedent!.url).toContain("ta679");
  });

  it("does not fabricate a precedent when none matches", async () => {
    const r = await htaReviewSimulationHandler({
      drug: "madeupdrug",
      indication: "madeupcondition",
      hta_body: "nice",
      pico: { comparator: "placebo" },
    });
    const q = r.questions.find((x) => x.category === "comparator")!;
    expect(q.precedent).toBeUndefined();
  });

  it("does not attach NICE precedents to a G-BA simulation", async () => {
    const r = await htaReviewSimulationHandler({
      drug: "dapagliflozin",
      indication: "HFrEF",
      hta_body: "gba_iqwig",
      pico: { comparator: "standard care" },
    });
    const q = r.questions.find((x) => x.category === "comparator")!;
    expect(q.precedent).toBeUndefined();
  });
});

describe("hta.review_simulation — ranking, summary, cap, markdown", () => {
  const richInput = {
    drug: "seladelpar",
    indication: "primary biliary cholangitis",
    pico: { comparator: "obeticholic acid" },
    dossier_markdown: "Seladelpar reduced ALP versus placebo.",
  };

  it("orders questions critical-first and sets biggest_exposure to the top question", async () => {
    const r = await htaReviewSimulationHandler(richInput);
    expect(r.questions[0].severity).toBe("critical");
    expect(r.summary.biggest_exposure).toBe(r.questions[0].category_label);
    expect(r.summary.critical).toBeGreaterThanOrEqual(2);
  });

  it("caps the returned questions at max_questions, keeping the highest severity", async () => {
    const r = await htaReviewSimulationHandler({
      ...richInput,
      max_questions: 2,
    });
    expect(r.questions.length).toBe(2);
    expect(r.questions.every((q) => q.severity === "critical")).toBe(true);
    // summary still reflects everything found (no silent truncation)
    expect(r.summary.critical).toBeGreaterThanOrEqual(2);
  });

  it("renders a markdown_section with header, anticipated label, and an ELEVATE disclosure block", async () => {
    const r = await htaReviewSimulationHandler(richInput);
    expect(r.markdown_section).toContain("HTA Review Simulation");
    expect(r.markdown_section).toContain("seladelpar");
    expect(r.markdown_section.toLowerCase()).toContain("anticipated");
    expect(r.markdown_section).toContain("AI Assistance Disclosure");
  });
});
