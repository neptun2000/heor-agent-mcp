import { buildConceptBlock } from "../../src/search/conceptBlock.js";

describe("buildConceptBlock", () => {
  it("formats Embase Emtree + free-text and PubMed MeSH + tiab lines", () => {
    const b = buildConceptBlock({ conditionTerms: ["adrenal insufficiency", "Addison disease"] });
    expect(b.embaseLines[0]).toContain("'adrenal insufficiency'/exp");
    expect(b.embaseLines[0]).toContain("adrenal insufficiency:ab,ti");
    expect(b.pubmedLines[0]).toContain('"adrenal insufficiency"[MeSH]');
    expect(b.pubmedLines[0]).toContain("adrenal insufficiency[tiab]");
    expect(b.emtreeDraft).toBe(true);
  });
});
