import { formatStrategyMarkdown } from "../../src/search/strategyFormatter.js";

it("renders a DRAFT banner, real PubMed counts, and no Embase counts", () => {
  const markdown = formatStrategyMarkdown(
    [
      {
        strand: "economic",
        embase_lines: [{ n: 1, query: "'x'/exp" }],
        pubmed_lines: [{ n: 1, query: '"x"[MeSH]', count: 26906 }],
        provenance: {
          source: "SIGN — ECONOMIC STUDIES",
          url: "https://www.sign.ac.uk/using-our-guidelines/methodology/search-filters/",
          templateUrl:
            "https://www.sign.ac.uk/assets/search-filters-economic-studies.docx",
          citation: "SIGN economic filter",
        },
      },
    ],
    { emtreeDraft: true },
  );
  expect(markdown).toMatch(/DRAFT — verify in Emtree/);
  expect(markdown).toContain("26906");
  expect(markdown).toContain("SIGN economic filter");
  expect(markdown).toMatch(/—/);
});