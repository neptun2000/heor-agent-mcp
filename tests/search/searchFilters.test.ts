import { getFilter, getSignFilterBlock, SIGN_FILTERS } from "../../src/data/searchFilters/index.js";

const SIGN_PAGE = "https://www.sign.ac.uk/using-our-guidelines/methodology/search-filters/";

describe("SIGN search filter catalog", () => {
  it("includes all six official SIGN templates", () => {
    expect(Object.keys(SIGN_FILTERS).sort()).toEqual([
      "diagnostic-studies",
      "economic-studies",
      "observational-studies",
      "patient-issues",
      "randomised-controlled-trials",
      "systematic-reviews",
    ]);
  });

  it.each([
    ["clinical", "randomised-controlled-trials", "24 not 28"],
    ["economic", "economic-studies", "Or/1-32"],
    ["hrqol", "patient-issues", "45 or 55 or 60"],
    ["epidemiology", "observational-studies", "Or/1-12"],
  ] as const)(
    "maps strand %s to SIGN %s with expected Medline final line",
    (strand, signId, finalLine) => {
      const block = getFilter(strand, "pubmed");
      expect(block.provenance.url).toBe(SIGN_PAGE);
      expect(block.provenance.templateUrl).toContain(signId);
      expect(block.lines[block.lines.length - 1]).toBe(finalLine);
      expect(block.lines[0]).toMatch(/^(exp |[A-Z"]|\d)/i);
    },
  );

  it("RCT Medline filter matches SIGN template opening lines verbatim", () => {
    const rct = getSignFilterBlock("randomised-controlled-trials", "pubmed");
    expect(rct.lines[0]).toBe("Randomized Controlled Trials as Topic/");
    expect(rct.lines[15]).toBe("or/1-15");
    expect(rct.lines[rct.lines.length - 1]).toBe("24 not 28");
  });

  it("economic Embase filter ends with Or/1-16 per SIGN template", () => {
    const econ = getSignFilterBlock("economic-studies", "embase");
    expect(econ.lines[0]).toBe("Socioeconomics/");
    expect(econ.lines[econ.lines.length - 1]).toBe("Or/1-16");
  });

  it("patient-issues filter is Medline-only in SIGN template", () => {
    const patient = SIGN_FILTERS["patient-issues"];
    expect(patient.sections.medline?.length).toBe(61);
    expect(patient.sections.embase).toBeUndefined();
  });

  it("systematic reviews Medline filter ends with 35 not 34", () => {
    const sr = getSignFilterBlock("systematic-reviews", "pubmed");
    expect(sr.lines[sr.lines.length - 1]).toBe("35 not 34");
  });
});