/**
 * DailyMed v2 client — CROSS-CHECK / FALLBACK for US regulatory status.
 *
 * Phase 0 verified 2026-05-07:
 *   Search: GET https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name={X}
 *   Returns: { data: [{spl_version, published_date, title, setid}], metadata }
 *
 * Used in v1 only to cross-check OpenFDA result freshness (compare
 * published_date against OpenFDA's effective_time). Does NOT replace
 * OpenFDA as the primary source.
 *
 * Design log #25.
 */

const BASE_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2";

export interface DailyMedEntry {
  setid: string;
  spl_version: number;
  published_date: string; // YYYY-MM-DD
  title: string;
}

interface DailyMedSearchResponse {
  data: Array<{
    setid: string;
    spl_version: number;
    published_date: string;
    title: string;
  }>;
  metadata?: {
    total_elements?: number;
    total_pages?: number;
    current_page?: number;
  };
}

/**
 * Build the DailyMed search URL.
 */
export function buildDailyMedSearchUrl(drugName: string): string {
  const encoded = encodeURIComponent(drugName);
  return `${BASE_URL}/spls.json?drug_name=${encoded}`;
}

/**
 * Parse DailyMed search response into structured entries.
 */
export function parseDailyMedSearchResponse(
  response: unknown,
): DailyMedEntry[] {
  if (!response || typeof response !== "object") return [];
  const resp = response as DailyMedSearchResponse;
  const data = resp.data;
  if (!Array.isArray(data)) return [];

  return data.map((entry) => ({
    setid: entry.setid ?? "",
    spl_version: entry.spl_version ?? 0,
    published_date: entry.published_date ?? "",
    title: entry.title ?? "",
  }));
}

/**
 * Fetch DailyMed cross-check for a drug name.
 * Returns null on any error (404, network failure, etc.) — DailyMed is
 * non-critical; OpenFDA is the primary source.
 */
export async function fetchDailyMedCrossCheck(
  drugName: string,
): Promise<DailyMedEntry[] | null> {
  try {
    const url = buildDailyMedSearchUrl(drugName);
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;

    const data = (await res.json()) as unknown;
    const entries = parseDailyMedSearchResponse(data);
    if (entries.length === 0) return null;

    return entries;
  } catch {
    return null;
  }
}
