import { DirectProvider } from "../../../src/providers/direct/index.js";
import * as pubmed from "../../../src/providers/direct/pubmed.js";
import * as ct from "../../../src/providers/direct/clinicalTrials.js";
import * as biorxiv from "../../../src/providers/direct/biorxiv.js";
import * as chembl from "../../../src/providers/direct/chembl.js";

jest.mock("../../../src/providers/direct/pubmed.js");
jest.mock("../../../src/providers/direct/clinicalTrials.js");
jest.mock("../../../src/providers/direct/biorxiv.js");
jest.mock("../../../src/providers/direct/chembl.js");

const mockResult = {
  id: "pubmed_123",
  source: "pubmed" as const,
  title: "Test study",
  authors: ["Smith J"],
  date: "2024",
  study_type: "rct",
  abstract: "Background...",
  url: "https://pubmed.ncbi.nlm.nih.gov/123/",
};

describe("DirectProvider.searchLiterature", () => {
  beforeEach(() => {
    jest.mocked(pubmed.fetchPubMed).mockResolvedValue([mockResult]);
    jest.mocked(ct.fetchClinicalTrials).mockResolvedValue([]);
    jest.mocked(biorxiv.fetchBiorxiv).mockResolvedValue([]);
    jest.mocked(chembl.fetchChembl).mockResolvedValue([]);
  });

  afterEach(() => jest.clearAllMocks());

  it("returns ToolResult with content and audit", async () => {
    const provider = new DirectProvider();
    const result = await provider.searchLiterature({ query: "semaglutide" });
    expect(result.content).toBeDefined();
    expect(result.audit.tool).toBe("literature_search");
    expect(result.audit.sources_queried.length).toBeGreaterThan(0);
    expect(result.audit.inclusions).toBe(1);
  });

  it("queries only specified sources", async () => {
    const provider = new DirectProvider();
    await provider.searchLiterature({ query: "semaglutide", sources: ["pubmed"] });
    expect(pubmed.fetchPubMed).toHaveBeenCalledTimes(1);
    expect(ct.fetchClinicalTrials).not.toHaveBeenCalled();
  });

  it("includes warning when a source fails", async () => {
    jest.mocked(pubmed.fetchPubMed).mockRejectedValue(new Error("fail"));
    const provider = new DirectProvider();
    const result = await provider.searchLiterature({ query: "semaglutide", sources: ["pubmed"] });
    expect(result.audit.warnings.length).toBeGreaterThan(0);
  });
});
