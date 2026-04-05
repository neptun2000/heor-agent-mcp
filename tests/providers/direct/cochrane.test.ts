import { fetchCochrane } from "../../../src/providers/direct/cochrane.js";

describe("fetchCochrane", () => {
  const original = process.env.COCHRANE_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.COCHRANE_API_KEY;
    else process.env.COCHRANE_API_KEY = original;
  });

  it("returns empty array when COCHRANE_API_KEY is not set", async () => {
    delete process.env.COCHRANE_API_KEY;
    const results = await fetchCochrane("semaglutide", 5);
    expect(results).toEqual([]);
  });

  it("returns empty array on fetch error when key is set", async () => {
    process.env.COCHRANE_API_KEY = "test-key";
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error("fail"));
    const results = await fetchCochrane("semaglutide", 5);
    expect(results).toEqual([]);
    global.fetch = origFetch;
  });
});
