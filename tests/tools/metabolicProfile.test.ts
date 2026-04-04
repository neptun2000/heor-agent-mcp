import {
  analyzeMetabolicProfile,
  profileToMarkdown,
} from "../../src/tools/metabolicProfile.js";

describe("analyzeMetabolicProfile", () => {
  it("identifies metabolic indicators from abstracts", () => {
    const results = [
      {
        title: "Semaglutide effects on HbA1c and BMI",
        abstract:
          "Patients with mean BMI 32.5, HbA1c 8.2%. Semaglutide reduced HbA1c by 1.5% and body weight by 5kg.",
      },
      {
        title: "Cardiovascular outcomes",
        abstract:
          "Blood pressure reduced. LDL cholesterol improved. MACE endpoint met.",
      },
    ];
    const profile = analyzeMetabolicProfile(results, "type 2 diabetes");
    expect(profile.indicators_found.length).toBeGreaterThan(0);
    expect(profile.indicators_found.some((i) => i.name === "HbA1c")).toBe(true);
    expect(profile.indicators_found.some((i) => i.name === "BMI")).toBe(true);
    expect(
      profile.indicators_found.some((i) => i.name === "Blood pressure"),
    ).toBe(true);
  });

  it("identifies comorbidities", () => {
    const results = [
      {
        title: "Study in T2DM with CKD",
        abstract:
          "Patients with type 2 diabetes and chronic kidney disease. Hypertension present in 70%.",
      },
    ];
    const profile = analyzeMetabolicProfile(results, "diabetes");
    expect(profile.comorbidities_mentioned).toContain("Type 2 diabetes");
    expect(profile.comorbidities_mentioned).toContain("Chronic kidney disease");
    expect(profile.comorbidities_mentioned).toContain("Hypertension");
  });

  it("identifies biomarkers", () => {
    const results = [
      {
        title: "Biomarker analysis",
        abstract:
          "CRP levels elevated. NT-proBNP measured as cardiac biomarker. IL-6 elevated.",
      },
    ];
    const profile = analyzeMetabolicProfile(results, "heart failure");
    expect(profile.biomarkers_mentioned).toContain("CRP / hs-CRP");
    expect(profile.biomarkers_mentioned).toContain("NT-proBNP");
  });

  it("returns weak quality for sparse data", () => {
    const results = [{ title: "Brief study", abstract: "No metabolic data." }];
    const profile = analyzeMetabolicProfile(results, "test");
    expect(profile.data_quality).toBe("weak");
  });

  it("returns strong quality for rich data", () => {
    const results = Array(6)
      .fill(null)
      .map((_, i) => ({
        title: `Study ${i}`,
        abstract:
          "HbA1c BMI blood pressure LDL cholesterol eGFR NAFLD triglycerides",
      }));
    const profile = analyzeMetabolicProfile(results, "metabolic syndrome");
    expect(profile.data_quality).toBe("strong");
  });
});

describe("profileToMarkdown", () => {
  it("generates markdown output", () => {
    const profile = analyzeMetabolicProfile(
      [
        {
          title: "Test",
          abstract: "BMI 30, HbA1c 7.5%, LDL high, hypertension, CRP elevated",
        },
      ],
      "diabetes",
    );
    const md = profileToMarkdown(profile);
    expect(md).toContain("Population Metabolic Profile");
    expect(md).toContain("Metabolic Indicators");
  });
});
