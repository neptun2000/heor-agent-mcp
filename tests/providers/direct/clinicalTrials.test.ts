import { fetchClinicalTrials } from "../../../src/providers/direct/clinicalTrials.js";

const mockResponse = {
  studies: [
    {
      protocolSection: {
        identificationModule: {
          nctId: "NCT04999999",
          briefTitle: "Semaglutide vs Placebo in T2D",
          officialTitle: "A Phase III Trial of Semaglutide in Type 2 Diabetes",
        },
        statusModule: { startDateStruct: { date: "2021-03" } },
        descriptionModule: { briefSummary: "This study evaluates semaglutide..." },
        contactsLocationsModule: { overallOfficials: [{ name: "Dr. Jane Smith" }] },
        designModule: { studyType: "INTERVENTIONAL" },
      },
    },
  ],
  nextPageToken: null,
};

global.fetch = jest.fn();

describe("fetchClinicalTrials", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it("returns LiteratureResult array from ClinicalTrials", async () => {
    const results = await fetchClinicalTrials("semaglutide type 2 diabetes", 20);
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("clinicaltrials");
    expect(results[0].id).toBe("ct_NCT04999999");
    expect(results[0].url).toContain("NCT04999999");
  });

  it("returns empty array on error", async () => {
    (global.fetch as jest.Mock).mockReset().mockRejectedValueOnce(new Error("Network error"));
    const results = await fetchClinicalTrials("semaglutide", 20);
    expect(results).toEqual([]);
  });
});
