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

  it("returns empty array on fetch error when key is set", async () => {
    process.env.CORTELLIS_API_KEY = "test-key";
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error("fail"));
    const results = await fetchCortellis("semaglutide", 5);
    expect(results).toEqual([]);
    global.fetch = origFetch;
  });
});
