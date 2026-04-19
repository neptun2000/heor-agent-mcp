import type { LiteratureResult } from "../types.js";

const CROSSREF_BASE = "https://api.crossref.org/works";

// Wiley HEOR journal ISSNs (print and electronic)
const WILEY_HEOR_ISSNS = [
  "1170-7690", // Pharmacoeconomics
  "1179-2027", // Pharmacoeconomics (online)
  "1057-9230", // Health Economics
  "1099-1050", // Health Economics (online)
  "1369-6998", // Journal of Medical Economics
  "1941-837X", // Journal of Medical Economics (online)
  "1524-4733", // Value in Health (Wiley/ISPOR)
  "1098-3015", // Value in Health (online)
];

interface CrossrefItem {
  DOI: string;
  title?: string[];
  author?: Array<{ given?: string; family?: string }>;
  "published-print"?: { "date-parts": number[][] };
  "published-online"?: { "date-parts": number[][] };
  abstract?: string;
  type?: string;
  "container-title"?: string[];
  URL?: string;
}

function extractYear(item: CrossrefItem): string {
  const parts =
    item["published-print"]?.["date-parts"]?.[0] ??
    item["published-online"]?.["date-parts"]?.[0];
  return parts?.[0]?.toString() ?? new Date().getFullYear().toString();
}

function stripJatsXml(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferStudyType(title: string, abstract: string): string {
  const t = (title + " " + abstract).toLowerCase();
  if (t.includes("systematic review") || t.includes("meta-analysis"))
    return "systematic_review";
  if (
    t.includes("randomized") ||
    t.includes("randomised") ||
    t.includes(" rct")
  )
    return "RCT";
  if (
    t.includes("markov") ||
    t.includes("cost-effectiveness") ||
    t.includes("decision model")
  )
    return "economic_model";
  if (
    t.includes("cohort") ||
    t.includes("observational") ||
    t.includes("real-world")
  )
    return "observational";
  if (t.includes("budget impact")) return "economic_model";
  return "review";
}

export async function fetchWiley(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  try {
    const issnFilter = WILEY_HEOR_ISSNS.map((i) => `issn:${i}`).join(",");
    const url = new URL(CROSSREF_BASE);
    url.searchParams.set("query", query);
    url.searchParams.set("filter", issnFilter);
    url.searchParams.set("rows", String(Math.min(maxResults * 2, 40)));
    url.searchParams.set(
      "select",
      "DOI,title,author,published-print,published-online,abstract,type,container-title,URL",
    );
    url.searchParams.set("mailto", "heor-agent-mcp@example.com");

    const res = await fetch(url.toString());
    if (!res.ok) return [];

    const data = (await res.json()) as { message: { items: CrossrefItem[] } };
    const items: CrossrefItem[] = data.message?.items ?? [];

    return items
      .filter(
        (item) =>
          item.title?.[0] && (item.abstract || item["container-title"]?.[0]),
      )
      .slice(0, maxResults)
      .map((item, i) => {
        const title = item.title?.[0] ?? "Untitled";
        const abstract = item.abstract
          ? stripJatsXml(item.abstract)
          : `Article from ${item["container-title"]?.[0] ?? "Wiley HEOR journal"}. Abstract not available — click URL for full record.`;
        const authors = (item.author ?? []).map((a) =>
          [a.given, a.family].filter(Boolean).join(" "),
        );
        return {
          id: `wiley_${item.DOI.replace(/\//g, "_") ?? i}`,
          source: "wiley" as const,
          title,
          authors: authors.length ? authors : ["Wiley"],
          date: extractYear(item),
          study_type: inferStudyType(title, abstract),
          abstract,
          url: item.URL ?? `https://doi.org/${item.DOI}`,
        };
      });
  } catch {
    return [];
  }
}
