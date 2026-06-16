import { fetchCortellis } from "../../../src/providers/direct/cortellis.js";

describe("fetchCortellis", () => {
  const original = process.env.CORTELLIS_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.CORTELLIS_API_KEY;
    else process.env.CORTELLIS_API_KEY = original;
  });

  it("returns empty array when CORTELLIS_API_KEY is not set", async () => {
    delete process.env.CORTELLIS_API_KEY;
    const results = await fetchCortellis("semaglutide", 5);
    expect(results).toEqual([]);
  });

  it("throws on direct API errors when key is set", async () => {
    process.env.CORTELLIS_API_KEY = "test-key";
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "error",
    });
    await expect(fetchCortellis("semaglutide", 5)).rejects.toThrow(
      /\[Cortellis\] API 500/,
    );
    global.fetch = origFetch;
  });
});
