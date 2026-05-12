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

  // v1.10.2 SPLIT: error_message is full (for the client response);
  // telemetry_message is capped at 500 (for PostHog event hygiene).
  // Pre-v1.10.2 the cap was applied to a single field that doubled as
  // the client surface, which truncated multi-issue ZodError dumps
  // mid-key and broke ChatGPT recovery.
  it("error_message preserves full text, telemetry_message capped at 500", () => {
    const longMsg = "x".repeat(2000);
    const props = classifyToolError(new Error(longMsg));
    expect(props.error_message?.length).toBe(2000);
    expect(props.telemetry_message?.length).toBeLessThanOrEqual(500);
    // For short messages the two fields match.
    const shortProps = classifyToolError(new Error("boom"));
    expect(shortProps.error_message).toBe(shortProps.telemetry_message);
  });

  it("ZodError full-text is preserved on error_message (regression for the 2026-05-12 hta.dossier incident)", () => {
    let zodErr: unknown;
    try {
      const { z } = require("zod");
      // Schema with many required fields → forces a long multi-issue message.
      z.object({
        hta_body: z.enum(["nice", "ema", "fda", "iqwig", "has", "jca", "gvd"]),
        submission_type: z.enum([
          "sta",
          "mta",
          "early_access",
          "initial",
          "renewal",
          "variation",
        ]),
        drug_name: z.string(),
        indication: z.string(),
        evidence_summary: z.string(),
        comparator: z.string(),
        target_population: z.string(),
        primary_outcome: z.string(),
      }).parse({});
    } catch (e) {
      zodErr = e;
    }
    const props = classifyToolError(zodErr);
    expect(props.error_class).toBe("ZodError");
    // The full ZodError dump is well over 500 chars for an 8-field
    // schema. Pre-v1.10.2 it would have been sliced mid-issue.
    expect(props.error_message.length).toBeGreaterThan(500);
    expect(props.telemetry_message.length).toBeLessThanOrEqual(500);
  });

  it("never throws on circular / weird thrown values", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => classifyToolError(circular)).not.toThrow();
  });

  it("non-Error long values: error_message full, telemetry_message capped", () => {
    const longStr = "y".repeat(2000);
    const props = classifyToolError(longStr);
    expect(props.error_message).toBe(longStr);
    expect(props.telemetry_message.length).toBeLessThanOrEqual(500);
  });
});
