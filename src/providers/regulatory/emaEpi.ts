/**
 * EMA EPI FHIR client — EU regulatory status source.
 *
 * Phase 0 verified 2026-05-07:
 *   Base: https://epi.developer.ema.europa.eu/api-details
 *   4 endpoints: ListBySearchParameter, BundleBySearchParameter, ListById, BundleById
 *   Format: FHIR JSON (Bundle resource containing Composition resources)
 *   Auth: none
 *
 * v1 approach: search by drug name → parse FHIR Bundle → extract
 * Composition.section[] for "Therapeutic indications" section.
 *
 * Design log #25.
 */

const EMA_BASE = "https://epi.developer.ema.europa.eu";

// ── FHIR types (minimal, only what we need) ───────────────────────────────

interface FhirCompositionSection {
  title?: string;
  text?: {
    status?: string;
    div?: string; // HTML-tagged text
  };
  section?: FhirCompositionSection[];
}

interface FhirComposition {
  resourceType: "Composition";
  id?: string;
  status?: string;
  title?: string;
  section?: FhirCompositionSection[];
}

interface FhirBundleEntry {
  resource?: {
    resourceType?: string;
    [key: string]: unknown;
  };
}

interface FhirBundle {
  resourceType?: string;
  type?: string;
  total?: number;
  entry?: FhirBundleEntry[];
}

// ── HTML stripping ────────────────────────────────────────────────────────

/** Strip HTML tags from FHIR div text to extract plain text. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── Result type ────────────────────────────────────────────────────────────

export interface EmaEpiResult {
  indication_text: string;
  source: "EMA EPI";
  url: string;
  fetched_at: string; // ISO timestamp
}

// ── Parser ─────────────────────────────────────────────────────────────────

export interface ParsedFhirBundle {
  compositions: FhirComposition[];
  indication_text: string;
}

/**
 * Parse a FHIR Bundle response and extract Composition resources +
 * the "Therapeutic indications" section text.
 *
 * FHIR path: Bundle.entry[].resource (resourceType=Composition)
 *            → Composition.section[].title ~= "4.1 Therapeutic indications"
 *            → Composition.section[].text.div (HTML) → strip tags
 */
export function parseFhirBundle(bundle: unknown): ParsedFhirBundle {
  const empty: ParsedFhirBundle = { compositions: [], indication_text: "" };

  if (!bundle || typeof bundle !== "object") return empty;

  const b = bundle as FhirBundle;
  if (!Array.isArray(b.entry)) return empty;

  const compositions: FhirComposition[] = [];
  for (const entry of b.entry) {
    const resource = entry?.resource;
    if (resource?.resourceType === "Composition") {
      compositions.push(resource as unknown as FhirComposition);
    }
  }

  // Extract indication text from first Composition found
  let indication_text = "";
  for (const comp of compositions) {
    const sections = comp.section ?? [];
    for (const section of sections) {
      const title = (section.title ?? "").toLowerCase();
      if (title.includes("therapeutic indication") || title.includes("4.1")) {
        const div = section.text?.div ?? "";
        indication_text = div ? stripHtml(div) : "";
        break;
      }
    }
    if (indication_text) break;
  }

  return { compositions, indication_text };
}

// ── Fetcher ────────────────────────────────────────────────────────────────

/**
 * Fetch EMA EPI FHIR data for a drug.
 * Returns null on any error or when no match found.
 *
 * v1 uses the BundleBySearchParameter endpoint with name search.
 * FHIR path: GET /api/v1/Bundle?name={drug}
 */
export async function fetchEmaEpiLabel(
  drug: string,
): Promise<EmaEpiResult | null> {
  try {
    // EMA EPI API: search for SmPC documents by drug name
    // Using the publicly documented BundleBySearchParameter endpoint
    const encoded = encodeURIComponent(drug);
    const url = `${EMA_BASE}/fhir/v1/Bundle?name=${encoded}&_count=5`;

    const res = await fetch(url, {
      headers: {
        Accept: "application/fhir+json, application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as unknown;
    const parsed = parseFhirBundle(data);

    if (parsed.compositions.length === 0 || !parsed.indication_text) {
      return null;
    }

    return {
      indication_text: parsed.indication_text,
      source: "EMA EPI",
      url: `${EMA_BASE}/fhir/v1/Bundle?name=${encoded}`,
      fetched_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
