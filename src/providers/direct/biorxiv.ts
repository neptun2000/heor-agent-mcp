import type { LiteratureResult } from "../types.js";

const BASE = "https://api.biorxiv.org/details/medrxiv";

interface BiorxivPaper {
  doi: string;
  title: string;
  authors: string;
  date: string;
  abstract: string;
  category: string;
}

const BIORXIV_QUERY_NOISE = /\b(?:AND|OR|NOT)\b/gi;

export function extractBiorxivKeywords(query: string): string[] {
  return [
    ...new Set(
      query
        .replace(/[(){}[\]:"']/g, " ")
        .replace(BIORXIV_QUERY_NOISE, " ")
        .replace(/[?*]/g, "")
        .toLowerCase()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3),
    ),
  ];
}

export async function fetchBiorxiv(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  const dateFrom = new Date();
  dateFrom.setFullYear(dateFrom.getFullYear() - 2);
  const from = dateFrom.toISOString().split("T")[0];
  const to = new Date().toISOString().split("T")[0];

  // bioRxiv/medRxiv has no true search endpoint. We fetch the first page only
  // (offset 0, roughly 100 records) and keyword-filter locally.
  const url = `${BASE}/${from}/${to}/0/json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`bioRxiv API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { collection: BiorxivPaper[] };
  const keywords = extractBiorxivKeywords(query);
  if (keywords.length === 0) return [];

  return (data.collection ?? [])
    .filter((p) => {
      const haystack = `${p.title} ${p.abstract}`.toLowerCase();
      return keywords.some((term) => haystack.includes(term));
    })
    .slice(0, maxResults)
    .map((p) => ({
      id: `biorxiv_${p.doi.replace(/\//g, "_")}`,
      source: "biorxiv" as const,
      title: p.title,
      authors: p.authors.split(";").map((a) => a.trim()),
      date: p.date,
      study_type: "preprint",
      abstract: p.abstract,
      url: `https://www.medrxiv.org/content/${p.doi}`,
    }));
}
