import type { LiteratureResult } from "../types.js";

/**
 * Semantic Scholar — AI citation graph + related-work + TLDRs, free REST API.
 * Strong for finding comparator studies (snowball SLR) for confounder/MAIC work.
 * Design log #43 follow-up (source expansion).
 *
 * API: https://api.semanticscholar.org/api-docs/ (S2_API_KEY raises rate limits).
 */
const BASE = "https://api.semanticscholar.org/graph/v1/paper/search";
const FIELDS = "title,year,authors,abstract,externalIds,publicationTypes,url";

interface S2Paper {
  paperId?: string;
  title?: string | null;
  year?: number | null;
  authors?: Array<{ name?: string }> | null;
  abstract?: string | null;
  externalIds?: { DOI?: string; PubMed?: string } | null;
  publicationTypes?: string[] | null;
  url?: string | null;
}

export async function fetchSemanticScholar(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  // No try/catch — let errors propagate so the dispatcher records status:"failed".
  const url =
    `${BASE}?query=${encodeURIComponent(query)}` +
    `&limit=${Math.min(maxResults, 100)}&fields=${FIELDS}`;
  const headers: Record<string, string> = {
    "User-Agent": "HEORAgent (mailto:support@heor-agent.dev)",
  };
  if (process.env.S2_API_KEY) headers["x-api-key"] = process.env.S2_API_KEY;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`[Semantic Scholar] API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { data?: S2Paper[] };
  return (data.data ?? []).map((p) => {
    const doi = p.externalIds?.DOI;
    return {
      id: `s2_${doi ?? p.paperId ?? "unknown"}`,
      source: "semantic_scholar" as const,
      title: p.title ?? "(untitled)",
      authors: (p.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
      date: p.year ? `${p.year}` : "",
      study_type: p.publicationTypes?.[0] ?? "",
      abstract: p.abstract ?? "",
      url: doi
        ? `https://doi.org/${doi}`
        : (p.url ?? `https://www.semanticscholar.org/paper/${p.paperId ?? ""}`),
    };
  });
}
