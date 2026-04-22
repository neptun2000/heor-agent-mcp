import { fetchOhe } from "../../../src/providers/direct/ohe.js";

describe("fetchOhe", () => {
  it("returns curated OHE publication pointers", async () => {
    const results = await fetchOhe("EQ-5D value set", 3);
    expect(results).toHaveLength(3);
    expect(results[0].source).toBe("ohe");
    expect(results[0].url).toContain("ohe.org");
    expect(results[0].title).toContain("EQ-5D value set");
  });

  it("respects maxResults", async () => {
    const results = await fetchOhe("test", 1);
    expect(results).toHaveLength(1);
  });

  it("tags every entry with the OHE author", async () => {
    const results = await fetchOhe("test", 3);
    results.forEach((r) => {
      expect(r.authors).toContain("Office of Health Economics (OHE)");
      expect(r.source).toBe("ohe");
    });
  });
});
