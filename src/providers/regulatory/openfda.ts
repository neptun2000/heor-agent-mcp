/**
 * OpenFDA /drug/label.json client — PRIMARY source for US regulatory status.
 *
 * Phase 0 verified 2026-05-07: returns full structured label sections in JSON.
 * No API key required for ≤240 calls/min/IP. Optional OPENFDA_API_KEY env var.
 *
 * Design log #25.
 */

import type {
  RegulatoryStatusResult,
  ApprovedIndication,
  BlackBoxWarning,
  RegulatoryApiError,
} from "./types.js";
import { parseAgeRange } from "./ageRangeParser.js";

const BASE_URL = "https://api.fda.gov/drug/label.json";
const DEFAULT_LIMIT = 5;

// OpenFDA result shape (relevant fields only)
interface OpenFdaResult {
  effective_time?: string; // YYYYMMDD
  indications_and_usage?: string[];
  contraindications?: string[];
  warnings_and_cautions?: string[];
  boxed_warning?: string[];
  pediatric_use?: string[];
  openfda?: {
    generic_name?: string[];
    brand_name?: string[];
    substance_name?: string[];
    application_number?: string[];
    product_type?: string[];
    route?: string[];
    manufacturer_name?: string[];
  };
}

interface OpenFdaResponse {
  meta?: { results?: { total?: number } };
  results?: OpenFdaResult[];
}

export type SearchField = "generic_name" | "brand_name" | "substance_name";

/**
 * Build the OpenFDA query URL.
 */
export function buildOpenFdaUrl(drug: string, field: SearchField): string {
  const encoded = encodeURIComponent(`"${drug}"`);
  const apiKey = process.env.OPENFDA_API_KEY;
  const keyParam = apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : "";
  return `${BASE_URL}?search=openfda.${field}:${encoded}&limit=${DEFAULT_LIMIT}${keyParam}`;
}

/**
 * Converts YYYYMMDD → YYYY-MM-DD.
 */
function formatDate(raw: string | undefined): string | null {
  if (!raw || raw.length < 8) return null;
  const y = raw.slice(0, 4);
  const m = raw.slice(4, 6);
  const d = raw.slice(6, 8);
  return `${y}-${m}-${d}`;
}

/**
 * Split an indications_and_usage paragraph into individual indication chunks.
 * Splits on "1.1", "1.2", "1.3" etc. SPL section numbering patterns.
 */
function splitIndications(text: string): string[] {
  // Split on patterns like "\n1.1 " or "\n1.2 "
  const chunks = text.split(/\n\d+\.\d+\s+/);
  // Filter out any that are too short (preamble)
  return chunks
    .map((c) => c.trim())
    .filter((c) => c.length > 20);
}

/**
 * Parse an OpenFDA API response into a RegulatoryStatusResult-like object.
 * Returns status="unknown" when results is empty.
 */
export function parseOpenFdaResult(
  response: OpenFdaResponse,
): Pick<
  RegulatoryStatusResult,
  | "current_status"
  | "approved_indications"
  | "black_box_warnings"
  | "rems_required"
  | "contraindications"
  | "recent_label_changes"
  | "drug_brand_names"
  | "drug_normalised_inn"
> {
  const results = response.results ?? [];
  if (results.length === 0) {
    return {
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
      drug_brand_names: [],
      drug_normalised_inn: "",
    };
  }

  const primary = results[0];
  const openfda = primary.openfda ?? {};

  // Drug name extraction
  const brandNames = openfda.brand_name ?? [];
  const genericNames = openfda.generic_name ?? [];
  const substanceNames = openfda.substance_name ?? [];
  // Best INN: generic_name stripped of suffix, else substance_name
  const rawInn = genericNames[0] ?? substanceNames[0] ?? "";
  const drug_normalised_inn = rawInn
    .toLowerCase()
    .replace(/-[a-z]{4}$/, "") // strip biosimilar suffix if present
    .trim();

  // Parse indications
  const rawIndications = primary.indications_and_usage ?? [];
  const approved_indications: ApprovedIndication[] = [];

  for (const rawText of rawIndications) {
    const chunks = splitIndications(rawText);
    // If splitting produced 1 chunk (no section numbers), use the whole text
    const indicationChunks = chunks.length > 0 ? chunks : [rawText.trim()];

    for (const chunk of indicationChunks) {
      if (chunk.length < 20) continue;
      // Look for population markers
      const populationPatterns = [
        /adult(?:s)?\s+and\s+pediatric\s+patients?\s+[^.]+/i,
        /pediatric\s+patients?\s+[^.]+/i,
        /adult\s+(?:patients?|population)\s*[^.]*(?:18\s+years?)?[^.]*/i,
        /children\s+[^.]+/i,
        /patients?\s+\d+\s+years?\s+(?:of\s+age\s+)?(?:and|or)\s+(?:older|above)[^.]*/i,
        /females?\s+of\s+reproductive[^.]*/i,
      ];

      let populationText = "";
      for (const pattern of populationPatterns) {
        const m = chunk.match(pattern);
        if (m) {
          populationText = m[0];
          break;
        }
      }
      // Fallback: use first sentence as population context
      if (!populationText) {
        const firstSentence = chunk.split(".")[0];
        populationText = firstSentence.length > 10 ? firstSentence : chunk.slice(0, 100);
      }

      const population_parsed = parseAgeRange(populationText);

      approved_indications.push({
        indication_text_verbatim: chunk,
        population: populationText || chunk.slice(0, 150),
        population_parsed:
          population_parsed.age_min_years !== null ||
          population_parsed.age_max_years !== null ||
          population_parsed.weight_constraint_kg !== null ||
          population_parsed.sex_constraint !== null
            ? population_parsed
            : null,
        approval_date: formatDate(primary.effective_time),
        label_revision: null,
        region_specific: false,
      });
    }
  }

  // Black box warnings
  const black_box_warnings: BlackBoxWarning[] = [];
  for (const bbw of primary.boxed_warning ?? []) {
    if (!bbw || bbw.trim().length === 0) continue;
    const lines = bbw.split("\n").filter((l) => l.trim().length > 0);
    const heading =
      lines[0]?.startsWith("WARNING") ? lines[0] : "BLACK BOX WARNING";
    const bodyLines = heading === lines[0] ? lines.slice(1) : lines;
    black_box_warnings.push({
      heading: heading.trim(),
      text_verbatim: bodyLines.join("\n").trim() || bbw.trim(),
    });
  }

  // REMS detection
  const warningsText = (primary.warnings_and_cautions ?? []).join(" ").toUpperCase();
  const rems_required = warningsText.includes("REMS") ||
    warningsText.includes("RISK EVALUATION AND MITIGATION");

  // Contraindications
  const contraindications = (primary.contraindications ?? [])
    .flatMap((c) =>
      c.split("\n").filter((l) => l.trim().length > 10),
    )
    .slice(0, 10); // Cap at 10

  // Recent label changes
  const now = new Date();
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const count_12_months = results.filter((r) => {
    if (!r.effective_time) return false;
    const d = formatDate(r.effective_time);
    if (!d) return false;
    return new Date(d) >= twelveMonthsAgo;
  }).length;

  return {
    current_status: approved_indications.length > 0 ? "approved" : "unknown",
    approved_indications,
    black_box_warnings,
    rems_required,
    contraindications,
    recent_label_changes: {
      count_12_months,
      last_revision_date: formatDate(primary.effective_time),
      last_revision_summary: null,
    },
    drug_brand_names: brandNames,
    drug_normalised_inn,
  };
}

/**
 * Fetch drug label from OpenFDA. Tries generic_name, then brand_name,
 * then substance_name as fallbacks.
 *
 * Returns null when drug is not found (404 or empty results).
 * Throws RegulatoryApiError on 429 or 5xx.
 */
export async function fetchOpenFdaLabel(
  drug: string,
): Promise<ReturnType<typeof parseOpenFdaResult> | null> {
  const fields: SearchField[] = ["generic_name", "brand_name", "substance_name"];

  for (const field of fields) {
    const url = buildOpenFdaUrl(drug, field);
    let res: Response;

    try {
      res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      // Network error — re-throw as RegulatoryApiError
      const err = Object.assign(
        new Error(`OpenFDA network error: ${String(e)}`),
        { retry_after_seconds: 30 },
      ) as RegulatoryApiError;
      throw err;
    }

    if (res.status === 404) {
      // Try next field
      continue;
    }

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10);
      const err = Object.assign(
        new Error("OpenFDA rate limit exceeded"),
        { retry_after_seconds: isNaN(retryAfter) ? 60 : retryAfter },
      ) as RegulatoryApiError;
      throw err;
    }

    if (!res.ok) {
      const err = Object.assign(
        new Error(`OpenFDA server error: ${res.status}`),
        { retry_after_seconds: 60 },
      ) as RegulatoryApiError;
      throw err;
    }

    const data = (await res.json()) as OpenFdaResponse;
    const parsed = parseOpenFdaResult(data);

    // If we found indications, return. Otherwise try next field.
    if (parsed.current_status === "approved") {
      return parsed;
    }
  }

  // All fields exhausted, no results
  return null;
}
