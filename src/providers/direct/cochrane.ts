import type { LiteratureResult } from "../types.js";
import { fetchViaProxy, getProxyUrl } from "./proxyClient.js";

// Wiley Online Library API — Cochrane Library is published by Wiley
const BASE = "https://api.wiley.com/onlinelibrary/tdm/v1/articles";

interface CochraneArticle {
  doi?: string;
  title?: string;
  authors?: string[];
  publicationDate?: string;
  abstract?: string;
  reviewType?: string;
}

interface CochraneResponse {
  items?: CochraneArticle[];
}

export async function fetchCochrane(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  if (getProxyUrl()) {
    try {
      const proxyResults = await fetchViaProxy("cochrane", query, maxResults);
      if (proxyResults.length > 0) return proxyResults;
    } catch {
      // Proxy unreachable — fall through to direct API when key is set.
    }
  }

  const apiKey = process.env.COCHRANE_API_KEY;
  if (!apiKey) return [];

  // No try/catch on direct API — let errors propagate so the dispatcher records status:"failed".
  const url = `${BASE}?q=${encodeURIComponent(query)}&rows=${maxResults}&filter=publication:cochrane`;
  const res = await fetch(url, {
    headers: {
      "Wiley-TDM-Client-Token": apiKey,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`[Cochrane] API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as CochraneResponse;
  const items = data.items ?? [];

  return items.slice(0, maxResults).map((item, i) => ({
    id: `cochrane_${item.doi ?? i}`,
    source: "cochrane" as const,
    title: item.title ?? "Untitled Cochrane Review",
    authors: item.authors ?? [],
    date: item.publicationDate ?? "",
    study_type: item.reviewType?.toLowerCase().includes("meta")
      ? "meta_analysis"
      : "review",
    abstract: item.abstract ?? "",
    url: item.doi
      ? `https://doi.org/${item.doi}`
      : "https://www.cochranelibrary.com/",
  }));
}