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
    expect(result.audit.tool).toBe("validate_links");
  });
});
