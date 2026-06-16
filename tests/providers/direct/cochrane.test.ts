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

  it("throws on direct API errors when key is set", async () => {
    process.env.COCHRANE_API_KEY = "test-key";
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });
    await expect(fetchCochrane("semaglutide", 5)).rejects.toThrow(
      /\[Cochrane\] API 401/,
    );
    global.fetch = origFetch;
  });
});
