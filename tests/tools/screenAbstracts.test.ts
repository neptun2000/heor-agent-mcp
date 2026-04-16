import { handleScreenAbstracts } from "../../src/tools/screenAbstracts.js";

describe("handleScreenAbstracts", () => {
  const sampleResults = [
    {
      id: "pmid_1",
      source: "pubmed",
      title: "Semaglutide vs placebo in type 2 diabetes: a randomized trial",
      authors: ["Smith J"],
      date: "2024-01-15",
      study_type: "RCT",
      abstract:
        "We randomized 1000 adults with type 2 diabetes to semaglutide or placebo. HbA1c reduction was greater with semaglutide.",
      url: "https://pubmed.ncbi.nlm.nih.gov/123",
    },
    {
      id: "pmid_2",
      source: "pubmed",
      title: "Editorial on diabetes treatments",
      authors: ["Jones K"],
      date: "2024-02-20",
      study_type: "editorial",
      abstract: "An editorial discussing current diabetes therapies.",
      url: "https://pubmed.ncbi.nlm.nih.gov/456",
    },
    {
      id: "pmid_3",
      source: "pubmed",
      title: "Statin use in cardiovascular disease",
      authors: ["Brown L"],
      date: "2024-03-10",
      study_type: "observational",
      abstract:
        "A study of statin use in 50,000 patients with cardiovascular disease.",
      url: "https://pubmed.ncbi.nlm.nih.gov/789",
    },
  ];

  it("runs happy path", async () => {
    const result = await handleScreenAbstracts({
      results: sampleResults,
      criteria: {
        population: "adults with type 2 diabetes",
        intervention: "semaglutide",
        comparator: "placebo",
        outcomes: ["HbA1c"],
      },
    });
    expect(typeof result.content).toBe("string");
    expect(result.content).toContain("Abstract Screening Report");
  });

  it("rejects empty results", async () => {
    await expect(
      handleScreenAbstracts({
        results: [],
        criteria: { population: "X", intervention: "Y" },
      }),
    ).rejects.toThrow();
  });

  it("includes relevant study and excludes editorials", async () => {
    const result = await handleScreenAbstracts({
      results: sampleResults,
      criteria: {
        population: "adults with type 2 diabetes",
        intervention: "semaglutide",
      },
      output_format: "json",
    });
    const content = result.content as {
      results: Array<{ id: string; decision: string; study_design_class: string }>;
    };
    const rctResult = content.results.find((r) => r.id === "pmid_1");
    const editorialResult = content.results.find((r) => r.id === "pmid_2");
    expect(rctResult?.decision).toBe("include");
    expect(editorialResult?.decision).toBe("exclude");
  });

  it("excludes studies with wrong PICO match", async () => {
    const result = await handleScreenAbstracts({
      results: sampleResults,
      criteria: {
        population: "adults with type 2 diabetes",
        intervention: "semaglutide",
      },
      output_format: "json",
    });
    const content = result.content as {
      results: Array<{ id: string; decision: string }>;
    };
    const statinResult = content.results.find((r) => r.id === "pmid_3");
    // Statin study is about CV disease and statins, not diabetes/semaglutide
    expect(statinResult?.decision).toBe("exclude");
  });

  it("respects min_year filter", async () => {
    const result = await handleScreenAbstracts({
      results: sampleResults,
      criteria: {
        population: "adults",
        intervention: "any",
      },
      min_year: 2025,
      output_format: "json",
    });
    const content = result.content as {
      results: Array<{ id: string; decision: string; reasons: string[] }>;
    };
    // All sample results are from 2024, should all be excluded
    const excluded = content.results.filter((r) => r.decision === "exclude");
    expect(excluded.length).toBe(sampleResults.length);
  });
});
