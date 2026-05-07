/**
 * Case-insensitive Zod enum helper.
 *
 * LLM callers naturally pass enum values in their "natural" branding
 * casing — `"NICE"`, `"ICER"`, `"Nice"` — because that's how the names
 * appear everywhere except our internal canonical lowercase tokens.
 * Vanilla `z.enum(["nice", "icer"])` rejects any of these; this helper
 * normalises the input to the canonical case BEFORE validation so a
 * caller's `"NICE"` becomes `"nice"` and passes through.
 *
 * Truly unknown values still fail with the standard Zod
 * `invalid_enum_value` issue, preserving the did-you-mean suggestions
 * each tool's handler builds via `suggestForEnum`.
 *
 * History: PostHog showed 5 production `project.create` failures on
 * 2026-05-04 with `hta_targets: ["NICE", "ICER"]` — schema rejected,
 * "did you mean nice/icer" hint fired, but the user already gave the
 * semantically correct answer. This helper closes that class of bug.
 */
import { z } from "zod";

export function caseInsensitiveEnum<T extends readonly [string, ...string[]]>(
  values: T,
) {
  // Build a lowercase → canonical map once at schema construction time so
  // the preprocess callback is a constant-time lookup.
  const lookup = new Map<string, T[number]>(
    values.map((v) => [v.toLowerCase(), v as T[number]]),
  );
  return z.preprocess((val) => {
    if (typeof val !== "string") return val;
    return lookup.get(val.toLowerCase()) ?? val;
  }, z.enum(values));
}
