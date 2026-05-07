/**
 * Tests for caseInsensitiveEnum — the shared Zod-enum case-normaliser.
 *
 * Covers the LLM-input-shape class of bug: callers pass "NICE", "Nice",
 * "icer ", or " EMA" (with whitespace) instead of canonical "nice"/"ema".
 */
import { caseInsensitiveEnum } from "../../src/util/caseInsensitive.js";

const HTA = caseInsensitiveEnum(["nice", "ema", "fda", "icer"] as const);

describe("caseInsensitiveEnum — canonical case", () => {
  it("accepts canonical lowercase", () => {
    expect(HTA.parse("nice")).toBe("nice");
    expect(HTA.parse("icer")).toBe("icer");
  });
});

describe("caseInsensitiveEnum — case-insensitivity", () => {
  it("normalises ALL CAPS to canonical lowercase", () => {
    expect(HTA.parse("NICE")).toBe("nice");
    expect(HTA.parse("ICER")).toBe("icer");
  });

  it("normalises Title Case", () => {
    expect(HTA.parse("Nice")).toBe("nice");
    expect(HTA.parse("Icer")).toBe("icer");
  });

  it("normalises sNakE_cAsE / mIxed", () => {
    expect(HTA.parse("nIcE")).toBe("nice");
    expect(HTA.parse("eMa")).toBe("ema");
  });
});

describe("caseInsensitiveEnum — unknown values still fail with Zod issue", () => {
  it("rejects truly unknown values regardless of casing", () => {
    expect(() => HTA.parse("BFARM")).toThrow();
    expect(() => HTA.parse("bfarm")).toThrow();
  });

  it("preserves invalid_enum_value issue type for did-you-mean hints", () => {
    const result = HTA.safeParse("BFARM");
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.code).toBe("invalid_enum_value");
      // The handler can call suggestForEnum on issue.received.
      // After preprocess, received is whatever passed through — for an
      // unknown value, that's the original (lowercase form via .toLowerCase()
      // would still be unknown). We accept either form here as long as the
      // handler can build a useful suggestion from it.
      expect(typeof (issue as { received?: unknown }).received).toBe("string");
    }
  });
});

describe("caseInsensitiveEnum — whitespace tolerance (v1.6.3)", () => {
  it("trims leading whitespace: '  NICE'", () => {
    expect(HTA.parse("  NICE")).toBe("nice");
  });

  it("trims trailing whitespace: 'icer '", () => {
    expect(HTA.parse("icer ")).toBe("icer");
  });

  it("trims both sides + mixed case: '  Ema  '", () => {
    expect(HTA.parse("  Ema  ")).toBe("ema");
  });

  it("rejects whitespace-only inputs", () => {
    const r = HTA.safeParse("   ");
    expect(r.success).toBe(false);
  });
});

describe("caseInsensitiveEnum — non-string inputs", () => {
  it("passes non-string inputs through unchanged so Zod produces a normal type error", () => {
    const r = HTA.safeParse(42);
    expect(r.success).toBe(false);
  });

  it("passes null through unchanged", () => {
    const r = HTA.safeParse(null);
    expect(r.success).toBe(false);
  });
});

describe("caseInsensitiveEnum — works inside arrays + objects", () => {
  it("works as item type in z.array()", async () => {
    const { z } = await import("zod");
    const Schema = z.object({
      targets: z.array(caseInsensitiveEnum(["nice", "icer"] as const)),
    });
    const r = Schema.safeParse({ targets: ["NICE", "ICER", "Nice"] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.targets).toEqual(["nice", "icer", "nice"]);
    }
  });
});
