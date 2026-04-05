import { fetchTlv } from "../../../src/providers/direct/tlv.js";

describe("fetchTlv", () => {
  it("returns structured reference results", async () => {
    const results = await fetchTlv("semaglutide", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("tlv");
  });

  it("respects maxResults", async () => {
    const results = await fetchTlv("test", 1);
    expect(results.length).toBe(1);
  });
});
