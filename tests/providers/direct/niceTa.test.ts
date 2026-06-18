import { fetchNiceTa } from "../../../src/providers/direct/niceTa.js";
import { liveDescribe } from "../../helpers/live.js";

// Hits the live NICE endpoint — gated behind RUN_LIVE_TESTS so a slow or
// unreachable endpoint can't flake CI (see tests/helpers/live.ts). The 15s
// timeout tolerates slow-but-successful responses when live tests are run.
liveDescribe("fetchNiceTa (live)", () => {
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
