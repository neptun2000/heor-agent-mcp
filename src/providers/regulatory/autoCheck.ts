/**
 * Fan-out helper for auto-wiring regulatory.status_check into other tools.
 *
 * Design log #26. Used by evidence.unmet_need and hta_workflow Phase 3.6.
 *
 * Concurrency: up to 8 parallel calls (OpenFDA rate-limit guard).
 * Cache: uses the shared 24h module-level cache inside regulatoryStatusCheck.ts.
 * Never throws: each call is wrapped — one failure never aborts the batch.
 *
 * CRITICAL CYCLE-SAFETY: This module MUST NOT import from
 * tools/evidenceUnmetNeed.ts or tools/htaWorkflow.ts (would create a cycle).
 * Only imports from tools/regulatoryStatusCheck.ts (which owns no upstream deps).
 */

import { handleRegulatoryStatusCheck } from "../../tools/regulatoryStatusCheck.js";
import type { RegulatoryStatusResult } from "./types.js";

// ── Public types ───────────────────────────────────────────────────────────

export interface AutoCheckRequest {
  drug: string;
  region: "us" | "eu" | "uk" | "global";
  indication?: string;
}

export interface AutoCheckResult {
  drug: string;
  region: string;
  result: RegulatoryStatusResult; // includes status="api_error"/"unknown" — never throws
}

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_AUTO_REGULATORY_CALLS_PER_REQUEST = 8;
const CONCURRENCY_LIMIT = 8;

// ── Helper: build a graceful api_error result on exception ────────────────

function makeErrorResult(drug: string, region: string, message: string): RegulatoryStatusResult {
  return {
    schema_version: "1.0",
    drug,
    drug_normalised_inn: drug.toLowerCase(),
    drug_brand_names: [],
    region,
    current_status: "api_error",
    approved_indications: [],
    black_box_warnings: [],
    rems_required: false,
    contraindications: [],
    recent_label_changes: {
      count_12_months: 0,
      last_revision_date: null,
      last_revision_summary: null,
    },
    source_urls: [],
    data_fetched_at: new Date().toISOString(),
    data_age_hours: 0,
    cache_hit: false,
    api_error: {
      source: "autoCheck",
      message,
      retry_after_seconds: 60,
    },
  };
}

// ── Fan-out with concurrency limit ─────────────────────────────────────────

/**
 * Fan-out helper for auto-wiring regulatory.status_check into other tools.
 * Concurrency 8 to avoid OpenFDA rate-limit. Cache hits are free.
 * Never throws — wraps each call so one failure doesn't kill the batch.
 */
export async function autoCheckRegulatory(
  requests: AutoCheckRequest[],
): Promise<AutoCheckResult[]> {
  if (requests.length === 0) return [];

  // Cap at MAX to prevent fan-out explosion
  const capped = requests.slice(0, MAX_AUTO_REGULATORY_CALLS_PER_REQUEST);

  // Process in batches of CONCURRENCY_LIMIT
  const results: AutoCheckResult[] = [];

  for (let i = 0; i < capped.length; i += CONCURRENCY_LIMIT) {
    const batch = capped.slice(i, i + CONCURRENCY_LIMIT);
    const batchResults = await Promise.all(
      batch.map(async (req) => {
        try {
          const toolResult = await handleRegulatoryStatusCheck({
            drug: req.drug,
            region: req.region,
            indication: req.indication,
          });
          // handleRegulatoryStatusCheck returns { content: string, audit }
          const parsed: RegulatoryStatusResult = JSON.parse(
            typeof toolResult.content === "string"
              ? toolResult.content
              : JSON.stringify(toolResult.content),
          );
          return {
            drug: req.drug,
            region: req.region,
            result: parsed,
          } satisfies AutoCheckResult;
        } catch (e) {
          // Never throw — return graceful api_error
          const message = e instanceof Error ? e.message : String(e);
          return {
            drug: req.drug,
            region: req.region,
            result: makeErrorResult(req.drug, req.region, message),
          } satisfies AutoCheckResult;
        }
      }),
    );
    results.push(...batchResults);
  }

  return results;
}
