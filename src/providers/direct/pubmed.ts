import type { LiteratureResult } from "../types.js";

const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

function parseAbstractsFromXml(xml: string): Map<string, string> {
  const abstracts = new Map<string, string>();
  // Split by <PubmedArticle> to process each article
  const articles = xml.split(/<PubmedArticle>/);
  for (const article of articles) {
    const pmidMatch = article.match(/<PMID[^>]*>(\d+)<\/PMID>/);
    if (!pmidMatch) continue;
    const pmid = pmidMatch[1];

    // Get all AbstractText elements and concatenate them
    const abstractParts: string[] = [];
    const regex = /<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g;
    let match;
    while ((match = regex.exec(article)) !== null) {
      // Strip any nested XML tags
      const text = match[1].replace(/<[^>]+>/g, "").trim();
      if (text) abstractParts.push(text);
    }
    if (abstractParts.length > 0) {
      abstracts.set(pmid, abstractParts.join(" "));
    }
  }
  return abstracts;
}

export async function fetchPubMed(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  try {
    const searchUrl = `${BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&retmode=json`;
    const searchRes = await fetch(searchUrl, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!searchRes.ok) return [];

    const searchData = (await searchRes.json()) as {
      esearchresult: { idlist: string[] };
    };
    const ids = searchData.esearchresult.idlist;
    if (ids.length === 0) return [];

    const summaryUrl = `${BASE}/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`;
    const summaryRes = await fetch(summaryUrl, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!summaryRes.ok) return [];

    const summaryData = (await summaryRes.json()) as {
      result: { uids: string[]; [key: string]: unknown };
    };

    // Fetch abstracts via efetch; if it fails, proceed with empty abstracts
    let abstracts = new Map<string, string>();
    try {
      const efetchUrl = `${BASE}/efetch.fcgi?db=pubmed&id=${ids.join(",")}&rettype=abstract&retmode=xml`;
      const efetchRes = await fetch(efetchUrl, {
        signal: AbortSignal.timeout(15_000),
      });
      if (efetchRes.ok) {
        const efetchXml = await efetchRes.text();
        abstracts = parseAbstractsFromXml(efetchXml);
      }
    } catch {
      // proceed with empty abstracts
    }

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
        abstract: abstracts.get(uid) ?? "",
        url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
      };
    });
  } catch {
    return [];
  }
}
