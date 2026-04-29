import type { LiteratureResult } from "../types.js";

const BASE = "https://serpapi.com/search";

interface SerpApiOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
  publication_info?: { summary?: string; authors?: Array<{ name: string }> };
  inline_links?: {
    cited_by?: { total?: number };
    versions?: { total?: number };
  };
  result_id?: string;
}

interface SerpApiResponse {
  organic_results?: SerpApiOrganicResult[];
  error?: string;
}

export async function fetchGoogleScholar(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return [];

  try {
    const url = `${BASE}?engine=google_scholar&q=${encodeURIComponent(query)}&num=${Math.min(maxResults, 20)}&api_key=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as SerpApiResponse;
    if (data.error || !data.organic_results) return [];

    return data.organic_results.slice(0, maxResults).map((r, i) => {
      const authors = r.publication_info?.authors?.map((a) => a.name) ?? [];
      const pubSummary = r.publication_info?.summary ?? "";
      // pub summary often: "A Smith, B Jones - Journal Name, 2023 - publisher.com"
      const yearMatch = pubSummary.match(/\b(19|20)\d{2}\b/);
      return {
        id: `gscholar_${r.result_id ?? i}`,
        source: "google_scholar" as const,
        title: r.title ?? "Untitled",
        authors,
        date: yearMatch ? yearMatch[0] : "",
        study_type: "unknown",
        abstract: [
          r.snippet ?? "",
          pubSummary ? `Publication: ${pubSummary}` : null,
          r.inline_links?.cited_by?.total
            ? `Cited by: ${r.inline_links.cited_by.total}`
            : null,
        ]
          .filter(Boolean)
          .join(" | "),
        url: r.link ?? "",
      };
    });
  } catch {
    return [];
  }
}
