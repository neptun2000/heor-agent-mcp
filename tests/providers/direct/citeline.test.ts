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

  it("throws on direct API errors when key is set", async () => {
    process.env.CITELINE_API_KEY = "test-key";
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "forbidden",
    });
    await expect(fetchCiteline("semaglutide", 5)).rejects.toThrow(
      /\[Citeline\] API 403/,
    );
    global.fetch = origFetch;
  });
});
