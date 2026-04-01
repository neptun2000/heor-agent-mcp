import type { LiteratureResult } from "../types.js";

const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export async function fetchPubMed(query: string, maxResults: number): Promise<LiteratureResult[]> {
  try {
    const searchUrl = `${BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&retmode=json`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) return [];

    const searchData = (await searchRes.json()) as { esearchresult: { idlist: string[] } };
    const ids = searchData.esearchresult.idlist;
    if (ids.length === 0) return [];

    const summaryUrl = `${BASE}/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`;
    const summaryRes = await fetch(summaryUrl);
    if (!summaryRes.ok) return [];

    const summaryData = (await summaryRes.json()) as {
      result: { uids: string[]; [key: string]: unknown };
    };

    return summaryData.result.uids.map((uid) => {
      const doc = summaryData.result[uid] as {
        title: string;
        authors: { name: string }[];
        pubdate: string;
        elocationid: string;
      };
      return {
        id: `pubmed_${uid}`,
        source: "pubmed" as const,
        title: doc.title ?? "",
        authors: (doc.authors ?? []).map((a) => a.name),
        date: doc.pubdate ?? "",
        study_type: "unknown",
        abstract: "",
        url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
      };
    });
  } catch {
    return [];
  }
}
