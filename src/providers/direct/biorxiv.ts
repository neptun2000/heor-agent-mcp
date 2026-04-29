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

export async function fetchBiorxiv(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  try {
    const dateFrom = new Date();
    dateFrom.setFullYear(dateFrom.getFullYear() - 2);
    const from = dateFrom.toISOString().split("T")[0];
    const to = new Date().toISOString().split("T")[0];

    const url = `${BASE}/${from}/${to}/0/json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];

    const data = (await res.json()) as { collection: BiorxivPaper[] };
    const queryLower = query.toLowerCase();

    return (data.collection ?? [])
      .filter(
        (p) =>
          p.title.toLowerCase().includes(queryLower) ||
          p.abstract.toLowerCase().includes(queryLower),
      )
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
  } catch {
    return [];
  }
}
