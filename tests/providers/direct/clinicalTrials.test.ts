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

  it("throws on API errors so the dispatcher can record failure", async () => {
    (global.fetch as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "rate limit",
      });
    await expect(fetchClinicalTrials("semaglutide", 20)).rejects.toThrow(
      /\[ClinicalTrials.gov\] API 429/,
    );
  });
});
