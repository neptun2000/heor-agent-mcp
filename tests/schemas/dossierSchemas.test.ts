/**
 * Drift guards: prove the new Zod schemas (replacing z.any()) actually
 * validate inputs against the documented type shapes. If a downstream tool
 * passes a malformed object, htaDossierPrep should reject at the schema
 * boundary instead of crashing inside generateGradeTable.
 */

import {
  LiteratureResultSchema,
  RobResultsSchema,
} from "../../src/schemas/dossierInputSchemas.js";

describe("LiteratureResultSchema", () => {
  it("accepts a complete literature result", () => {
    const r = LiteratureResultSchema.parse({
      id: "pubmed:12345",
      source: "pubmed",
      title: "Trial of X",
      authors: ["Smith J"],
      date: "2024-01-15",
      study_type: "RCT",
      abstract: "Background...",
      url: "https://pubmed.ncbi.nlm.nih.gov/12345",
    });
    expect(r.title).toBe("Trial of X");
  });

  it("accepts partial result with only required fields (title, abstract)", () => {
    const r = LiteratureResultSchema.parse({
      title: "Trial of X",
      abstract: "...",
    });
    expect(r.authors).toBeUndefined();
  });

  it("rejects when title is missing", () => {
    expect(() =>
      LiteratureResultSchema.parse({ abstract: "..." }),
    ).toThrow(/title/);
  });

  it("rejects when title is wrong type (number)", () => {
    expect(() =>
      LiteratureResultSchema.parse({ title: 42, abstract: "..." }),
    ).toThrow(/title/);
  });

  it("ignores unknown extra fields (forward-compat)", () => {
    const r = LiteratureResultSchema.parse({
      title: "x",
      abstract: "y",
      future_field_we_dont_know_about: 123,
    });
    expect(r.title).toBe("x");
  });
});

describe("RobResultsSchema", () => {
  const valid = {
    summary: {
      rob_judgment: "Some concerns",
      downgrade: false,
      rationale: "Some studies have concerns",
    },
    overall_certainty_start: "High" as const,
  };

  it("accepts a complete RoB result", () => {
    const r = RobResultsSchema.parse(valid);
    expect(r.overall_certainty_start).toBe("High");
  });

  it("requires overall_certainty_start to be 'High' or 'Low'", () => {
    expect(() =>
      RobResultsSchema.parse({ ...valid, overall_certainty_start: "Medium" }),
    ).toThrow();
  });

  it("requires summary.rob_judgment", () => {
    expect(() =>
      RobResultsSchema.parse({
        summary: { downgrade: false, rationale: "x" },
        overall_certainty_start: "High",
      }),
    ).toThrow(/rob_judgment/);
  });

  it("requires summary.downgrade to be a boolean", () => {
    expect(() =>
      RobResultsSchema.parse({
        summary: { rob_judgment: "Low", downgrade: "no", rationale: "x" },
        overall_certainty_start: "High",
      }),
    ).toThrow(/downgrade/);
  });

  it("rejects when summary itself is missing", () => {
    expect(() =>
      RobResultsSchema.parse({ overall_certainty_start: "High" }),
    ).toThrow(/summary/);
  });
});
