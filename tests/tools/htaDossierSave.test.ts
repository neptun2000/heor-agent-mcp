import { handleHtaDossierPrep } from "../../src/tools/htaDossierPrep.js";

jest.mock("../../src/knowledge/index.js", () => ({
  saveDossier: jest.fn(),
  saveReport: jest.fn(),
}));

import { saveDossier } from "../../src/knowledge/index.js";

const mockSaveDossier = saveDossier as jest.MockedFunction<typeof saveDossier>;

const baseParams = {
  hta_body: "nice",
  submission_type: "sta",
  drug_name: "TestDrug",
  indication: "Test indication",
  output_format: "text",
  project: "demo-project",
};

beforeEach(() => {
  mockSaveDossier.mockReset();
});

describe("hta.dossier — knowledge-base persistence", () => {
  it("surfaces a warning when saveDossier fails instead of failing silently", async () => {
    mockSaveDossier.mockRejectedValue(new Error("disk full"));

    const result = await handleHtaDossierPrep(baseParams);
    const text = result.content as string;

    expect(text).toContain("Knowledge-base save failed");
    expect(text).toContain("disk full");
    expect(result.audit.warnings.some((w) => w.includes("disk full"))).toBe(true);
  });
});