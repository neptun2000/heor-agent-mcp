/**
 * Tests for the analytics error-classification helper. Codifies the
 * contract that tool-call failures emit two structured properties:
 *   - error_class: the Error subclass name (ZodError, TypeError, Error...)
 *   - error_message: the .message text, truncated to a safe length
 *
 * Background. PostHog query 2026-05-05 showed 20 errors in 7 days but
 * every event had error_class:"(none)" and error_message:"(no message)"
 * because the property names emitted by trackToolCall didn't match what
 * the analytics dashboard queries. Behavioural test (per memory rule:
 * never config-shape only) — runs through the helper with realistic
 * Error subclasses and asserts on output shape.
 */
import { classifyToolError } from "../../src/analytics.js";
import { ZodError } from "zod";

describe("classifyToolError — produces error_class + error_message", () => {
  it("plain Error → class=Error, message preserved", () => {
    const props = classifyToolError(new Error("boom"));
    expect(props.error_class).toBe("Error");
    expect(props.error_message).toBe("boom");
  });

  it("TypeError → class=TypeError", () => {
    const props = classifyToolError(new TypeError("not a function"));
    expect(props.error_class).toBe("TypeError");
    expect(props.error_message).toBe("not a function");
  });

  it("ZodError (Zod schema validation) → class=ZodError", () => {
    let zodErr: ZodError | undefined;
    try {
      // synthesise a ZodError by failing a parse
      const { z } = require("zod");
      z.object({ x: z.string() }).parse({});
    } catch (e) {
      zodErr = e as ZodError;
    }
    const props = classifyToolError(zodErr);
    expect(props.error_class).toBe("ZodError");
    expect(typeof props.error_message).toBe("string");
    expect(props.error_message?.length).toBeGreaterThan(0);
  });

  it("non-Error thrown value (string, number) → class=unknown, message=stringified", () => {
    expect(classifyToolError("a string")).toMatchObject({
      error_class: "unknown",
      error_message: "a string",
    });
    expect(classifyToolError(42)).toMatchObject({
      error_class: "unknown",
      error_message: "42",
    });
    expect(classifyToolError(null)).toMatchObject({
      error_class: "unknown",
      error_message: "null",
    });
  });

  it("truncates very long messages to <=500 chars", () => {
    const longMsg = "x".repeat(2000);
    const props = classifyToolError(new Error(longMsg));
    expect(props.error_message?.length).toBeLessThanOrEqual(500);
  });

  it("never throws on circular / weird thrown values", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => classifyToolError(circular)).not.toThrow();
  });
});
