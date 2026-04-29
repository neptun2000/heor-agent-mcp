import type { LiteratureResult } from "../types.js";

const BASE = "https://api.elsevier.com/content/search/sciencedirect";

interface ElsevierEntry {
  "dc:title"?: string;
  "dc:creator"?: string;
  "prism:coverDate"?: string;
  "dc:description"?: string;
  "prism:url"?: string;
  "prism:doi"?: string;
  pii?: string;
  "prism:publicationName"?: string;
  openaccess?: boolean;
}

interface ElsevierResponse {
  "search-results"?: {
    entry?: ElsevierEntry[];
    "opensearch:totalResults"?: string;
  };
}

export async function fetchScienceDirect(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  const apiKey = process.env.ELSEVIER_API_KEY;
  if (!apiKey) return [];

  try {
    const url = `${BASE}?query=${encodeURIComponent(query)}&count=${maxResults}`;
    const res = await fetch(url, {
      headers: {
        "X-ELS-APIKey": apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as ElsevierResponse;
    const entries = data["search-results"]?.entry ?? [];

    return entries
      .filter((e) => e["dc:title"])
      .map((e, i) => {
        const doi = e["prism:doi"];
        const pii = e["pii"];
        const id = doi ?? pii ?? `sd_${i}`;
        return {
          id: `sciencedirect_${id}`,
          source: "sciencedirect" as const,
          title: e["dc:title"] ?? "",
          authors: e["dc:creator"] ? [e["dc:creator"]] : [],
          date: e["prism:coverDate"] ?? "",
          study_type: "unknown",
          abstract:
            e["dc:description"] ??
            (e["prism:publicationName"]
              ? `Published in ${e["prism:publicationName"]}`
              : ""),
          url: doi ? `https://doi.org/${doi}` : (e["prism:url"] ?? ""),
        };
      });
  } catch {
    return [];
  }
}
