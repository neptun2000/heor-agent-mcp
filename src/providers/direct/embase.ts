import type { LiteratureResult } from "../types.js";

const BASE = "https://api.elsevier.com/content/search/embase";

interface ElsevierEntry {
  "dc:title"?: string;
  "dc:creator"?: string;
  "prism:coverDate"?: string;
  "dc:description"?: string;
  "prism:url"?: string;
  "prism:doi"?: string;
  pii?: string;
  subtypeDescription?: string;
}

interface ElsevierResponse {
  "search-results"?: {
    entry?: ElsevierEntry[];
    "opensearch:totalResults"?: string;
  };
}

export async function fetchEmbase(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  const apiKey = process.env.ELSEVIER_API_KEY;
  if (!apiKey) return [];

  try {
    const url = `${BASE}?query=${encodeURIComponent(query)}&count=${maxResults}&field=title,creator,coverDate,description,url,doi,pii,subtypeDescription`;
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
        const id = doi ?? pii ?? `embase_${i}`;
        return {
          id: `embase_${id}`,
          source: "embase" as const,
          title: e["dc:title"] ?? "",
          authors: e["dc:creator"] ? [e["dc:creator"]] : [],
          date: e["prism:coverDate"] ?? "",
          study_type: mapSubtype(e["subtypeDescription"]),
          abstract: e["dc:description"] ?? "",
          url: doi ? `https://doi.org/${doi}` : (e["prism:url"] ?? ""),
        };
      });
  } catch {
    return [];
  }
}

function mapSubtype(subtype?: string): string {
  if (!subtype) return "unknown";
  const s = subtype.toLowerCase();
  if (s.includes("review") || s.includes("meta")) return "review";
  if (s.includes("randomized") || s.includes("controlled")) return "rct";
  if (s.includes("observational") || s.includes("cohort"))
    return "observational";
  return "unknown";
}
