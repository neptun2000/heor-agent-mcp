import { fetchEmbase } from "../../../src/providers/direct/embase.js";

describe("fetchEmbase", () => {
  const originalKey = process.env.ELSEVIER_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ELSEVIER_API_KEY;
    } else {
      process.env.ELSEVIER_API_KEY = originalKey;
    }
  });

  it("returns empty array when ELSEVIER_API_KEY is not set", async () => {
    delete process.env.ELSEVIER_API_KEY;
    const results = await fetchEmbase("semaglutide", 5);
    expect(results).toEqual([]);
  });

  it("returns empty array on fetch error when key is set", async () => {
    process.env.ELSEVIER_API_KEY = "invalid-test-key";
    // fetch will fail or return non-ok — should return [] gracefully
    const results = await fetchEmbase("semaglutide", 5);
    expect(results).toEqual([]);
  });
});
