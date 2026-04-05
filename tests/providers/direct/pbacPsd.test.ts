import { fetchPbacPsd } from "../../../src/providers/direct/pbacPsd.js";

describe("fetchPbacPsd", () => {
  it("returns structured reference results", async () => {
    const results = await fetchPbacPsd("semaglutide", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("pbac_psd");
  });

  it("respects maxResults", async () => {
    const results = await fetchPbacPsd("test", 1);
    expect(results.length).toBe(1);
  });
});
