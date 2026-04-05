import { fetchCiteline } from "../../../src/providers/direct/citeline.js";

describe("fetchCiteline", () => {
  const original = process.env.CITELINE_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.CITELINE_API_KEY;
    else process.env.CITELINE_API_KEY = original;
  });

  it("returns empty array when CITELINE_API_KEY is not set", async () => {
    delete process.env.CITELINE_API_KEY;
    const results = await fetchCiteline("semaglutide", 5);
    expect(results).toEqual([]);
  });

  it("returns empty array on fetch error when key is set", async () => {
    process.env.CITELINE_API_KEY = "test-key";
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error("fail"));
    const results = await fetchCiteline("semaglutide", 5);
    expect(results).toEqual([]);
    global.fetch = origFetch;
  });
});
