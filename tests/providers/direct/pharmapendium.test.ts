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

  it("returns empty array on fetch error when key is set", async () => {
    process.env.PHARMAPENDIUM_API_KEY = "test-key";
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error("fail"));
    const results = await fetchPharmapendium("semaglutide", 5);
    expect(results).toEqual([]);
    global.fetch = origFetch;
  });
});
