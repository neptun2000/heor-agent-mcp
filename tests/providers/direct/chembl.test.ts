import { fetchChembl } from "../../../src/providers/direct/chembl.js";

const mockResponse = {
  molecules: [
    {
      molecule_chembl_id: "CHEMBL1234",
      pref_name: "SEMAGLUTIDE",
      molecule_properties: { full_mwt: "4113.58" },
      molecule_type: "Protein",
      first_approval: 2017,
    },
  ],
  page_meta: { total_count: 1 },
};

global.fetch = jest.fn();

describe("fetchChembl", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it("returns LiteratureResult array from ChEMBL", async () => {
    const results = await fetchChembl("semaglutide", 20);
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("chembl");
    expect(results[0].id).toBe("chembl_CHEMBL1234");
    expect(results[0].url).toContain("CHEMBL1234");
  });

  it("returns empty array on error", async () => {
    (global.fetch as jest.Mock).mockReset().mockRejectedValueOnce(new Error("fail"));
    const results = await fetchChembl("semaglutide", 20);
    expect(results).toEqual([]);
  });
});
