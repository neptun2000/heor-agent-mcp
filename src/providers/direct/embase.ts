import type { LiteratureResult } from "../types.js";

// EMBASE records are indexed in Scopus and accessed via the Scopus Search API
// with dbId=embase. The standalone /content/search/embase endpoint returns 404.
const BASE = "https://api.elsevier.com/content/search/scopus";

// Database names that users/models sometimes append to queries but which kill
// Scopus results (Scopus treats all terms as mandatory AND — "EMBASE" in the
// query means the paper must contain the word "EMBASE").
const DB_NAME_PATTERN =
  /\b(embase|pubmed|scopus|medline|cinahl|cochrane|sciencedirect|web\s+of\s+science)\b/gi;

/**
 * Sanitise a raw search query before sending it to the Scopus free-text
 * search endpoint.  The Scopus translator returns 400 "Error translating
 * query" when it encounters:
 *   - parentheses / curly- / square-brackets (grouping syntax it can't parse
 *     in free-text mode), e.g. `tirzepatide (obesity OR overweight)`
 *   - bare boolean operators adjacent to terms
 *   - field-prefix punctuation such as TITLE:"…"
 *
 * Reduction to a flat space-separated term list — which Scopus treats as
 * implicit AND — is the most reliable strategy.  Wildcards (* ?) are
 * intentionally preserved.
 */
export function cleanScopusQuery(raw: string): {
  cleaned: string;
  stripped: string[];
} {
  const stripped: string[] = [];
  const cleaned = raw
    .replace(DB_NAME_PATTERN, (match) => {
      stripped.push(match.toLowerCase());
      return "";
    })
    .replace(/[(){}[\]:"']/g, " ") // grouping / field-prefix / quote chars
    .replace(/\b(?:AND|OR|NOT)\b/gi, " ") // bare boolean operators
    .replace(/\s{2,}/g, " ")
    .trim();
  return { cleaned, stripped: [...new Set(stripped)] };
}

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

  // Sanitise the query before sending to Scopus.  Parentheses, bare boolean
  // operators, and field-prefix punctuation cause Scopus to return
  // 400 "Error translating query".  Reduce to a flat term list so errors
  // are never silently swallowed by the outer catch in the dispatcher.
  const { cleaned: cleanedQuery } = cleanScopusQuery(query);

  const instToken = process.env.ELSEVIER_INST_TOKEN;
  const headers: Record<string, string> = {
    "X-ELS-APIKey": apiKey,
    Accept: "application/json",
  };
  if (instToken) headers["X-ELS-Insttoken"] = instToken;

  // No try/catch here — let errors propagate so the dispatcher
  // (src/providers/direct/index.ts) can record status:"failed" + error
  // message in the audit trail instead of silently returning [].
  const params = new URLSearchParams({
    query: cleanedQuery,
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
      const scopusLink = e.link?.find((l) => l["@ref"] === "scopus")?.["@href"];
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
