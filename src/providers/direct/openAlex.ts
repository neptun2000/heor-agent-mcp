import type { LiteratureResult } from "../types.js";

/**
 * OpenAlex — 250M+ scholarly works + citation graph + concepts, free REST API.
 * Broad SLR coverage + dedup for the confounder_identification open_search
 * corpus; complements the Crossref-based verify_citations. Design log #43 follow-up.
 *
 * API: https://docs.openalex.org/
 */
const BASE = "https://api.openalex.org/works";
const MAILTO = process.env.OPENALEX_MAILTO ?? "support@heor-agent.dev";

interface OpenAlexWork {
  id?: string;
  doi?: string | null; // full "https://doi.org/..." URL
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  type?: string | null;
  authorships?: Array<{ author?: { display_name?: string } }>;
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_location?: { landing_page_url?: string | null } | null;
}

function reconstructAbstract(
  inv: Record<string, number[]> | null | undefined,
): string {
  if (!inv) return "";
  const words: string[] = [];
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions) words[p] = word;
  }
  return words.filter((w) => w !== undefined).join(" ");
}

export async function fetchOpenAlex(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  // No try/catch — let errors propagate so the dispatcher records status:"failed".
  const url =
    `${BASE}?search=${encodeURIComponent(query)}` +
    `&per-page=${Math.min(maxResults, 100)}&mailto=${encodeURIComponent(MAILTO)}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": `HEORAgent (mailto:${MAILTO})` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`[OpenAlex] API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { results?: OpenAlexWork[] };
  return (data.results ?? []).map((w) => {
    const bareDoi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, "") : "";
    const openAlexId = (w.id ?? "").replace("https://openalex.org/", "");
    return {
      id: `openalex_${bareDoi || openAlexId || "unknown"}`,
      source: "openalex" as const,
      title: w.display_name ?? w.title ?? "(untitled)",
      authors: (w.authorships ?? [])
        .map((a) => a.author?.display_name ?? "")
        .filter(Boolean),
      date: w.publication_year ? `${w.publication_year}` : "",
      study_type: w.type ?? "",
      abstract: reconstructAbstract(w.abstract_inverted_index),
      url:
        w.doi ??
        w.primary_location?.landing_page_url ??
        `https://openalex.org/${openAlexId}`,
    };
  });
}
