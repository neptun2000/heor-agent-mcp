import { handleValidateLinks } from "../../src/tools/validateLinks.js";

describe("handleValidateLinks", () => {
  it("rejects empty url array", async () => {
    await expect(handleValidateLinks({ urls: [] })).rejects.toThrow();
  });

  it("rejects invalid urls", async () => {
    await expect(
      handleValidateLinks({ urls: ["not-a-url"] }),
    ).rejects.toThrow();
  });

  it("rejects too many urls", async () => {
    await expect(
      handleValidateLinks({
        urls: Array.from({ length: 51 }, (_, i) => `https://example.com/${i}`),
      }),
    ).rejects.toThrow();
  });

  it(
    "validates working URLs (external — may skip if offline)",
    async () => {
      const result = await handleValidateLinks({
        urls: ["https://www.example.com"],
        timeout_ms: 5000,
      });
      const content = result.content as {
        summary: { total: number };
        results: Array<{ url: string; category: string }>;
      };
      expect(content.summary.total).toBe(1);
      // Allow any result category — we just want to ensure it doesn't crash
      expect(content.results[0]?.url).toBe("https://www.example.com");
    },
    10000,
  );

  it("includes audit record", async () => {
    const result = await handleValidateLinks({
      urls: ["https://example.com"],
      timeout_ms: 3000,
    });
    expect(result.audit).toBeDefined();
    expect(result.audit.tool).toBe("utils.validate_links");
  });

  it("marks known HTA 401/407 bot blocks as browser_only", async () => {
    const originalFetch = global.fetch;
    try {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          status: 401,
          ok: false,
          statusText: "Unauthorized",
          url: "https://www.aifa.gov.it/example",
        })
        .mockResolvedValueOnce({
          status: 407,
          ok: false,
          statusText: "Proxy Authentication Required",
          url: "https://www.tlv.se/example",
        });

      const result = await handleValidateLinks({
        urls: [
          "https://www.aifa.gov.it/example",
          "https://www.tlv.se/example",
        ],
        timeout_ms: 1000,
      });
      const content = result.content as {
        summary: { browser_only: number; broken: number };
        results: Array<{ category: string }>;
      };
      expect(content.summary.browser_only).toBe(2);
      expect(content.summary.broken).toBe(0);
      expect(content.results.map((r) => r.category)).toEqual([
        "browser_only",
        "browser_only",
      ]);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
