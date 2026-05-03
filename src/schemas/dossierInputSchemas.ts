/**
 * Zod schemas for inputs that htaDossierPrep accepts from upstream tools.
 *
 * Previously these were `z.any()` — which silently accepted garbage and let
 * malformed shapes crash deep inside `generateGradeTable`. With proper
 * schemas, the tool boundary rejects bad input with a field-level error
 * message that's actionable for the caller (Claude, ChatGPT, or a human).
 *
 * `passthrough()` is used so unknown fields are preserved (forward-compat
 * for adding new fields without breaking older callers).
 */

import { z } from "zod";

/**
 * Single literature search result. Accepts the canonical shape produced by
 * literature_search; in practice many fields may be absent (e.g., user pastes
 * a cherry-picked subset), so only title + abstract are required.
 */
export const LiteratureResultSchema = z
  .object({
    id: z.string().optional(),
    source: z.string().optional(),
    title: z.string().min(1),
    authors: z.array(z.string()).optional(),
    date: z.string().optional(),
    study_type: z.string().optional(),
    abstract: z.string(),
    url: z.string().optional(),
  })
  .passthrough();

export type LiteratureResultInput = z.infer<typeof LiteratureResultSchema>;

/**
 * Output of the risk_of_bias tool, intended to be passed back into
 * hta_dossier so the GRADE table uses structured RoB judgments instead of
 * the heuristic fallback.
 *
 * PostHog 2026-05-03 showed real-world failures where Claude/ChatGPT
 * constructed rob_results inline (rather than passing through actual
 * risk_of_bias output) and omitted summary.downgrade or rationale. Only
 * rob_judgment is load-bearing for the GRADE table — the others get
 * sensible defaults so real input shapes are accepted.
 */
const lenientBool = z.preprocess((v) => {
  if (typeof v === "string") {
    if (v.toLowerCase() === "true") return true;
    if (v.toLowerCase() === "false") return false;
  }
  return v;
}, z.boolean().default(false));

export const RobResultsSchema = z
  .object({
    summary: z
      .object({
        rob_judgment: z.string().min(1),
        downgrade: lenientBool,
        rationale: z.string().default(""),
      })
      .passthrough(),
    overall_certainty_start: z.enum(["High", "Low"]),
  })
  .passthrough();

export type RobResultsInput = z.infer<typeof RobResultsSchema>;

/**
 * Output of cost_effectiveness_model, optionally passed for
 * downstream sensitivity narrative. Kept loose (passthrough) because the CEA
 * output is large and we don't need to validate every nested PSA bin.
 */
export const CEModelResultSchema = z
  .object({
    icer: z.number().optional(),
    incremental_costs: z.number().optional(),
    incremental_qalys: z.number().optional(),
  })
  .passthrough();

export type CEModelResultInput = z.infer<typeof CEModelResultSchema>;
