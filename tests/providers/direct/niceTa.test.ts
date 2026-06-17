import { fetchNiceTa } from "../../../src/providers/direct/niceTa.js";

// These hit the live NICE endpoint. Use a generous timeout so transient
// endpoint slowness doesn't trip Jest's 5s default (matches wiley.test.ts).
// The assertions still fail on a broken endpoint or wrong-shaped data — the
// timeout only tolerates slow-but-successful responses.
describe("fetchNiceTa", () => {
  it("returns structured reference results", async () => {
    const results = await fetchNiceTa("semaglutide", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("nice_ta");
  }, 15000);

  it("respects maxResults", async () => {
    const results = await fetchNiceTa("test", 1);
    expect(results.length).toBe(1);
  }, 15000);
});
