import { fetchPharmapendium } from "../../../src/providers/direct/pharmapendium.js";

describe("fetchPharmapendium", () => {
  const original = process.env.PHARMAPENDIUM_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.PHARMAPENDIUM_API_KEY;
    else process.env.PHARMAPENDIUM_API_KEY = original;
  });

  it("returns empty array when PHARMAPENDIUM_API_KEY is not set", async () => {
    delete process.env.PHARMAPENDIUM_API_KEY;
    const results = await fetchPharmapendium("semaglutide", 5);
    expect(results).toEqual([]);
  });

  it("throws on direct API errors when key is set", async () => {
    process.env.PHARMAPENDIUM_API_KEY = "test-key";
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "bad request",
    });
    await expect(fetchPharmapendium("semaglutide", 5)).rejects.toThrow(
      /\[Pharmapendium\] API 400/,
    );
    global.fetch = origFetch;
  });
});
