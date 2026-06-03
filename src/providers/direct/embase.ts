import type { LiteratureResult } from "../types.js";

// EMBASE records are indexed in Scopus and accessed via the Scopus Search API
// with dbId=embase. The standalone /content/search/embase endpoint returns 404.
const BASE = "https://api.elsevier.com/content/search/scopus";

interface ScopusEntry {
  "dc:title"?: string;
  "dc:creator"?: string;
  "prism:publicationName"?: string;
  "prism:coverDate"?: string;
  "dc:description"?: string;
  "prism:doi"?: string;
  subtypeDescription?: string;
  link?: Array<{ "@ref": string; "@href": string }>;
}

interface ScopusResponse {
  "search-results"?: {
    entry?: ScopusEntry[];
    "opensearch:totalResults"?: string;
  };
}

export async function fetchEmbase(
  query: string,
  maxResults: number,
  injectedApiKey?: string,
): Promise<LiteratureResult[]> {
  const apiKey = injectedApiKey ?? process.env.ELSEVIER_API_KEY;
  if (!apiKey) return [];

  const instToken = process.env.ELSEVIER_INST_TOKEN;
  const headers: Record<string, string> = {
    "X-ELS-APIKey": apiKey,
    Accept: "application/json",
  };
  if (instToken) headers["X-ELS-Insttoken"] = instToken;

  try {
    const params = new URLSearchParams({
      query,
      count: String(maxResults),
      dbId: "embase",
      field:
        "title,creator,publicationName,coverDate,description,doi,subtypeDescription,link",
    });
    const res = await fetch(`${BASE}?${params}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Scopus API ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as ScopusResponse;
    const entries = data["search-results"]?.entry ?? [];

    return entries
      .filter((e) => e["dc:title"])
      .map((e, i) => {
        const doi = e["prism:doi"];
        const scopusLink = e.link?.find((l) => l["@ref"] === "scopus")?.[
          "@href"
        ];
        const url = doi ? `https://doi.org/${doi}` : (scopusLink ?? "");
        return {
          id: `embase_${doi ?? scopusLink ?? i}`,
          source: "embase" as const,
          title: e["dc:title"] ?? "",
          authors: e["dc:creator"] ? [e["dc:creator"]] : [],
          date: e["prism:coverDate"] ?? "",
          study_type: mapSubtype(e["subtypeDescription"]),
          abstract: e["dc:description"] ?? "",
          url,
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
