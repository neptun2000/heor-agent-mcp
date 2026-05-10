/**
 * regulatory.status_check — primary-source regulatory lookup tool.
 *
 * Design log #25. Tool #27. Target: v1.7.0.
 *
 * CRITICAL INVARIANT: current_status NEVER equals "not_approved".
 * Primary-source absence ≠ proof of non-approval → use "unknown".
 *
 * Triggered by: real user incident 2026-05-07 — fremanezumab/pediatric-migraine
 * dossier falsely asserted "CGRP mAbs have no approved pediatric indication"
 * because LLM training data predated the August 2025 FDA sBLA approval.
 *
 * Data sources (v1.7.0):
 * - US: OpenFDA (primary), DailyMed (cross-check)
 * - EU: EMA EPI FHIR API
 * - UK: deferred to v1.7.1 (no public eMC API)
 */

import { z } from "zod";
import type { ToolResult } from "../providers/types.js";
import type {
  RegulatoryStatusResult,
  RegulatoryApiError,
} from "../providers/regulatory/types.js";
import { RegulatoryCache } from "../providers/regulatory/cache.js";
import {
  normaliseDrugName,
  getBrandNames,
} from "../providers/regulatory/drugNameNormaliser.js";
import { fetchOpenFdaLabel } from "../providers/regulatory/openfda.js";
import { fetchEmaEpiLabel } from "../providers/regulatory/emaEpi.js";
import { parseAgeRange } from "../providers/regulatory/ageRangeParser.js";
import { createAuditRecord, addSource } from "../audit/builder.js";

// Module-level cache shared across calls (24h TTL)
const cache = new RegulatoryCache<RegulatoryStatusResult>();

// ── Zod schema ────────────────────────────────────────────────────────────

const RegulatoryStatusCheckSchema = z.object({
  drug: z.string().min(1, "drug is required"),
  region: z.enum(["us", "eu", "uk", "global"]),
  indication: z.string().optional(),
  force_refresh: z.boolean().default(false),
  include_label_history: z.boolean().default(false),
});

type RegulatoryStatusCheckInput = z.infer<typeof RegulatoryStatusCheckSchema>;

// ── Cache key ─────────────────────────────────────────────────────────────

function makeCacheKey(drug: string, region: string): string {
  return `${drug.toLowerCase().trim()}:${region}`;
}

// ── UK deferral response ──────────────────────────────────────────────────

function makeUkDeferralResult(
  drug: string,
  region: string,
): RegulatoryStatusResult {
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
      source: "UK eMC",
      message:
        "UK eMC API not available in v1.7.0 — deferred to v1.7.1. The UK eMC has no publicly documented API (Phase 0 verification 2026-05-07). For UK regulatory status, consult https://www.medicines.org.uk/emc directly.",
      retry_after_seconds: 0,
    },
  };
}

// ── US handler (OpenFDA primary) ──────────────────────────────────────────

async function fetchUsStatus(
  drug: string,
  normalised: string,
  brandNames: string[],
  indication?: string,
): Promise<
  Omit<
    RegulatoryStatusResult,
    | "schema_version"
    | "drug"
    | "region"
    | "data_fetched_at"
    | "data_age_hours"
    | "cache_hit"
  >
> {
  const fetchedAt = new Date().toISOString();

  try {
    // Try canonical INN first, then the original drug name if different
    let parsed = await fetchOpenFdaLabel(normalised);
    if (!parsed && normalised !== drug.toLowerCase()) {
      parsed = await fetchOpenFdaLabel(drug);
    }

    if (!parsed) {
      // No results — return unknown (NEVER "not_approved")
      const didYouMean = normaliseDrugName(drug).did_you_mean;
      return {
        drug_normalised_inn: normalised || drug.toLowerCase(),
        drug_brand_names: brandNames,
        indication_filter: indication,
        current_status: "unknown",
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
        did_you_mean: didYouMean,
      };
    }

    // Apply indication filter if specified
    let indications = parsed.approved_indications;
    if (indication && indication.trim().length > 0) {
      const lower = indication.toLowerCase();
      const filtered = indications.filter(
        (ind) =>
          ind.indication_text_verbatim.toLowerCase().includes(lower) ||
          ind.population.toLowerCase().includes(lower),
      );
      // Only filter if we actually found matches — don't return empty
      if (filtered.length > 0) {
        indications = filtered;
      }
    }

    const openFdaUrl = `https://api.fda.gov/drug/label.json?search=openfda.generic_name%3A%22${encodeURIComponent(normalised)}%22&limit=5`;

    return {
      drug_normalised_inn: parsed.drug_normalised_inn || normalised,
      drug_brand_names:
        parsed.drug_brand_names.length > 0
          ? parsed.drug_brand_names
          : brandNames,
      indication_filter: indication,
      current_status: parsed.current_status,
      approved_indications: indications,
      black_box_warnings: parsed.black_box_warnings,
      rems_required: parsed.rems_required,
      contraindications: parsed.contraindications,
      recent_label_changes: parsed.recent_label_changes,
      source_urls: [
        {
          source: "OpenFDA",
          url: openFdaUrl,
          fetched_at: fetchedAt,
        },
      ],
    };
  } catch (e) {
    const err = e as Partial<RegulatoryApiError>;
    const didYouMean = normaliseDrugName(drug).did_you_mean;
    return {
      drug_normalised_inn: normalised || drug.toLowerCase(),
      drug_brand_names: brandNames,
      indication_filter: indication,
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
      did_you_mean: didYouMean,
      api_error: {
        source: "OpenFDA",
        message: err.message ?? "Unknown error from OpenFDA",
        retry_after_seconds: err.retry_after_seconds ?? 60,
      },
    };
  }
}

// ── EU handler (EMA EPI FHIR) ─────────────────────────────────────────────

async function fetchEuStatus(
  drug: string,
  normalised: string,
  brandNames: string[],
  indication?: string,
): Promise<
  Omit<
    RegulatoryStatusResult,
    | "schema_version"
    | "drug"
    | "region"
    | "data_fetched_at"
    | "data_age_hours"
    | "cache_hit"
  >
> {
  try {
    // Try canonical INN first
    let emaResult = await fetchEmaEpiLabel(normalised);
    if (!emaResult && normalised !== drug.toLowerCase()) {
      emaResult = await fetchEmaEpiLabel(drug);
    }

    if (!emaResult) {
      const didYouMean = normaliseDrugName(drug).did_you_mean;
      return {
        drug_normalised_inn: normalised || drug.toLowerCase(),
        drug_brand_names: brandNames,
        indication_filter: indication,
        current_status: "unknown",
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
        did_you_mean: didYouMean,
      };
    }

    // Build an approved indication from EMA result (v1: single chunk)
    const indicationText = emaResult.indication_text;
    const populationParsed = parseAgeRange(indicationText);
    const hasPopulationData =
      populationParsed.age_min_years !== null ||
      populationParsed.age_max_years !== null ||
      populationParsed.weight_constraint_kg !== null ||
      populationParsed.sex_constraint !== null;

    let indications = [
      {
        indication_text_verbatim: indicationText,
        population: indicationText.slice(0, 200),
        population_parsed: hasPopulationData ? populationParsed : null,
        approval_date: null,
        label_revision: null,
        region_specific: false,
      },
    ];

    // Apply indication filter
    if (indication && indication.trim().length > 0) {
      const lower = indication.toLowerCase();
      const filtered = indications.filter((ind) =>
        ind.indication_text_verbatim.toLowerCase().includes(lower),
      );
      if (filtered.length > 0) {
        indications = filtered;
      }
    }

    return {
      drug_normalised_inn: normalised || drug.toLowerCase(),
      drug_brand_names: brandNames,
      indication_filter: indication,
      current_status: "approved",
      approved_indications: indications,
      black_box_warnings: [],
      rems_required: false,
      contraindications: [],
      recent_label_changes: {
        count_12_months: 0,
        last_revision_date: null,
        last_revision_summary: null,
      },
      source_urls: [
        {
          source: "EMA EPI",
          url: emaResult.url,
          fetched_at: emaResult.fetched_at,
        },
      ],
    };
  } catch (e) {
    const err = e as Partial<RegulatoryApiError>;
    return {
      drug_normalised_inn: normalised || drug.toLowerCase(),
      drug_brand_names: brandNames,
      indication_filter: indication,
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
      api_error: {
        source: "EMA EPI",
        message: err.message ?? "Unknown EMA EPI error",
        retry_after_seconds: err.retry_after_seconds ?? 60,
      },
    };
  }
}

// ── Main handler ──────────────────────────────────────────────────────────

export async function handleRegulatoryStatusCheck(
  rawInput: unknown,
): Promise<ToolResult> {
  const parsed = RegulatoryStatusCheckSchema.safeParse(rawInput);
  if (!parsed.success) {
    const messages = parsed.error.issues.map(
      (i) => `${i.path.join(".") || "input"}: ${i.message}`,
    );
    throw new Error(messages.join("\n"));
  }
  const input: RegulatoryStatusCheckInput = parsed.data;

  const audit = createAuditRecord(
    "regulatory.status_check",
    rawInput as Record<string, unknown>,
    "json",
    "OpenFDA /drug/label.json (primary US); EMA EPI FHIR API (EU); DailyMed v2 (cross-check). Design log #25.",
  );

  // UK is deferred to v1.7.1
  if (input.region === "uk") {
    const ukResult = makeUkDeferralResult(input.drug, input.region);
    return { content: JSON.stringify(ukResult, null, 2), audit };
  }

  // Normalise drug name
  const normaliseResult = normaliseDrugName(input.drug);
  const normalised =
    normaliseResult.inn ?? input.drug.toLowerCase().replace(/-[a-z]{4}$/, "");
  const brandNames = normaliseResult.inn
    ? getBrandNames(normaliseResult.inn)
    : [];

  const cacheKey = makeCacheKey(normalised, input.region);

  // Check cache (skip if force_refresh)
  if (!input.force_refresh) {
    const hit = cache.get(cacheKey);
    if (hit) {
      const cached: RegulatoryStatusResult = {
        ...hit.value,
        cache_hit: true,
        data_age_hours: hit.data_age_hours,
      };
      // Apply indication filter on cached result
      if (input.indication && cached.approved_indications.length > 0) {
        const lower = input.indication.toLowerCase();
        const filtered = cached.approved_indications.filter(
          (ind) =>
            ind.indication_text_verbatim.toLowerCase().includes(lower) ||
            ind.population.toLowerCase().includes(lower),
        );
        if (filtered.length > 0) {
          cached.approved_indications = filtered;
        }
      }
      return { content: JSON.stringify(cached, null, 2), audit };
    }
  } else {
    // force_refresh: delete cache entry
    cache.delete(cacheKey);
  }

  // Fetch fresh data
  const fetchStart = Date.now();
  let statusData: Omit<
    RegulatoryStatusResult,
    | "schema_version"
    | "drug"
    | "region"
    | "data_fetched_at"
    | "data_age_hours"
    | "cache_hit"
  >;

  if (input.region === "us" || input.region === "global") {
    statusData = await fetchUsStatus(
      input.drug,
      normalised,
      brandNames,
      input.indication,
    );
  } else if (input.region === "eu") {
    statusData = await fetchEuStatus(
      input.drug,
      normalised,
      brandNames,
      input.indication,
    );
  } else {
    // Should not reach here given Zod validation, but defensive
    statusData = {
      drug_normalised_inn: normalised,
      drug_brand_names: brandNames,
      current_status: "api_error" as const,
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
      api_error: {
        source: "router",
        message: `Unsupported region: ${input.region}`,
        retry_after_seconds: 0,
      },
    };
  }

  const data_age_hours = (Date.now() - fetchStart) / (1000 * 60 * 60);

  const result: RegulatoryStatusResult = {
    schema_version: "1.0",
    drug: input.drug,
    drug_normalised_inn: statusData.drug_normalised_inn,
    drug_brand_names: statusData.drug_brand_names,
    region: input.region,
    indication_filter: input.indication,
    current_status: statusData.current_status,
    approved_indications: statusData.approved_indications,
    black_box_warnings: statusData.black_box_warnings,
    rems_required: statusData.rems_required,
    contraindications: statusData.contraindications,
    recent_label_changes: statusData.recent_label_changes,
    source_urls: statusData.source_urls,
    data_fetched_at: new Date().toISOString(),
    data_age_hours,
    cache_hit: false,
    ...(statusData.did_you_mean
      ? { did_you_mean: statusData.did_you_mean }
      : {}),
    ...(statusData.api_error ? { api_error: statusData.api_error } : {}),
  };

  // Store in cache (only if not an api_error — don't cache failures)
  if (result.current_status !== "api_error") {
    cache.set(cacheKey, result);
  }

  // Add source to audit record for tracking
  if (result.source_urls.length > 0) {
    addSource(audit, {
      source: result.source_urls[0].source,
      query_sent: input.drug,
      results_returned: result.approved_indications.length,
      results_included: result.approved_indications.length,
      latency_ms: Math.round(data_age_hours * 60 * 60 * 1000),
      status: result.current_status === "approved" ? "ok" : "partial",
    });
  }

  return { content: JSON.stringify(result, null, 2), audit };
}

// ── Tool schema ────────────────────────────────────────────────────────────

export const regulatoryStatusCheckToolSchema = {
  name: "regulatory.status_check",
  description:
    "Look up current regulatory approval status for a drug from primary sources (OpenFDA for US, EMA EPI for EU). Returns approved indications, label text verbatim, age/weight/sex constraints, black-box warnings, REMS status, contraindications, source URLs, and fetch timestamp. Refuses to assert 'not approved' on database absence — emits 'unknown' instead. 24h cache with force_refresh flag. Use BEFORE any claim about approval status, pediatric indication, or regulatory restrictions. Design log #25.",
  annotations: {
    title: "Regulatory Status Check",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      drug: {
        type: "string",
        description:
          "Drug name: INN (fremanezumab), INN+suffix (fremanezumab-vfrm), or brand (Ajovy, case-insensitive).",
      },
      region: {
        type: "string",
        enum: ["us", "eu", "uk", "global"],
        description:
          "Regulatory region. 'uk' deferred to v1.7.1 (no public eMC API). 'global' queries US.",
      },
      indication: {
        type: "string",
        description:
          "Optional: narrow results to indications containing this text (e.g., 'pediatric', 'migraine').",
      },
      force_refresh: {
        type: "boolean",
        default: false,
        description:
          "Bypass 24h cache and re-fetch from primary source. Use for same-day label changes.",
      },
      include_label_history: {
        type: "boolean",
        default: false,
        description: "Reserved for v1.7.2 — ignored in v1.7.0.",
      },
    },
    required: ["drug", "region"],
  },
} as const;
