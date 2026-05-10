/**
 * Tests for DailyMed v2 cross-check client.
 *
 * DailyMed is used as a cross-check / fallback, not the primary source.
 * Primary source is OpenFDA. All network calls mocked.
 */

import {
  buildDailyMedSearchUrl,
  parseDailyMedSearchResponse,
  fetchDailyMedCrossCheck,
} from "../../../src/providers/regulatory/dailymed.js";

const DAILYMED_SEARCH_FIXTURE = {
  data: [
    {
      setid: "abc123-def456",
      spl_version: 6,
      published_date: "2025-08-08",
      title: "AJOVY- fremanezumab-vfrm injection, solution",
    },
  ],
  metadata: {
    db_published_date: "2025-08-10",
    elements_per_page: 10,
    current_url: "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json",
    next_page_url: null,
    total_elements: 1,
    total_pages: 1,
    current_page: 1,
  },
};

const DAILYMED_EMPTY_FIXTURE = {
  data: [],
  metadata: {
    db_published_date: "2025-08-10",
    elements_per_page: 10,
    current_url: "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json",
    next_page_url: null,
    total_elements: 0,
    total_pages: 0,
    current_page: 1,
  },
};

describe("buildDailyMedSearchUrl — URL construction", () => {
  it("builds correct search URL for a drug name", () => {
    const url = buildDailyMedSearchUrl("fremanezumab");
    expect(url).toContain("dailymed.nlm.nih.gov");
    expect(url).toContain("services/v2/spls.json");
    expect(url).toContain("drug_name=");
    expect(url).toContain("fremanezumab");
  });

  it("URL-encodes drug names with spaces", () => {
    const url = buildDailyMedSearchUrl("drug name");
    expect(url).not.toContain(" ");
  });
});

describe("parseDailyMedSearchResponse — fixture parsing", () => {
  it("returns empty array for empty data", () => {
    const result = parseDailyMedSearchResponse(DAILYMED_EMPTY_FIXTURE);
    expect(result).toEqual([]);
  });

  it("extracts setid and published_date from non-empty fixture", () => {
    const result = parseDailyMedSearchResponse(DAILYMED_SEARCH_FIXTURE);
    expect(result.length).toBe(1);
    expect(result[0].setid).toBe("abc123-def456");
    expect(result[0].published_date).toBe("2025-08-08");
  });

  it("returns the SPL title", () => {
    const result = parseDailyMedSearchResponse(DAILYMED_SEARCH_FIXTURE);
    expect(result[0].title).toBe("AJOVY- fremanezumab-vfrm injection, solution");
  });
});

describe("fetchDailyMedCrossCheck — mocked network", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns null when DailyMed returns no results (404)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
    }) as unknown as typeof fetch;

    const result = await fetchDailyMedCrossCheck("totally-unknown-drug");
    expect(result).toBeNull();
  });

  it("returns structured result on 200 OK", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => DAILYMED_SEARCH_FIXTURE,
      headers: { get: () => null },
    }) as unknown as typeof fetch;

    const result = await fetchDailyMedCrossCheck("fremanezumab");
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(0);
    expect(result![0].setid).toBeDefined();
    expect(result![0].published_date).toBeDefined();
  });

  it("returns null (not throw) on network error", async () => {
    global.fetch = jest.fn().mockRejectedValue(
      new Error("Network error"),
    ) as unknown as typeof fetch;

    const result = await fetchDailyMedCrossCheck("fremanezumab");
    expect(result).toBeNull();
  });
});
