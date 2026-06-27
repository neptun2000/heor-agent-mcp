import { buildConceptBlock } from "../../src/search/conceptBlock.js";

describe("buildConceptBlock", () => {
  it("formats Embase Emtree + free-text and PubMed MeSH + tiab lines", () => {
    const block = buildConceptBlock({
      conditionTerms: ["adrenal insufficiency", "Addison disease"],
    });
    expect(block.embaseLines[0]).toContain("'adrenal insufficiency'/exp");
    expect(block.embaseLines[0]).toContain("adrenal insufficiency:ab,ti");
    expect(block.pubmedLines[0]).toContain('"adrenal insufficiency"[MeSH]');
    expect(block.pubmedLines[0]).toContain("adrenal insufficiency[tiab]");
    expect(block.emtreeDraft).toBe(true);
  });
});