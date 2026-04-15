import type { LiteratureResult } from "../types.js";

const NICE_SEARCH_URL = "https://www.nice.org.uk/search";

/**
 * Fetch NICE Technology Appraisals by scraping the NICE search page.
 * Extracts guidance links (TA numbers) and titles from search results HTML.
 */
export async function fetchNiceTa(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  const url = `${NICE_SEARCH_URL}?q=${encodeURIComponent(query)}&ps=${Math.min(maxResults, 20)}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return fallbackResults(query, maxResults);
    }

    const html = await res.text();

    // Extract guidance links and titles from search results
    const results: LiteratureResult[] = [];
    const guidancePattern = /href="(\/guidance\/(ta\d+))"[^>]*>([^<]+)/gi;
    let match;

    while (
      (match = guidancePattern.exec(html)) !== null &&
      results.length < maxResults
    ) {
      const path = match[1]!;
      const taId = match[2]!.toUpperCase();
      const title = match[3]!.trim();

      if (results.some((r) => r.id === taId)) continue;

      results.push({
        id: taId,
        source: "nice_ta" as const,
        title: `[${taId}] ${title}`,
        authors: ["National Institute for Health and Care Excellence (NICE)"],
        date: new Date().getFullYear().toString(),
        study_type: "hta_report",
        abstract: `NICE Technology Appraisal ${taId}. Search query: "${query}". This guidance recommends whether NHS England should fund this treatment. View for full appraisal determination, committee papers, and evidence review.`,
        url: `https://www.nice.org.uk${path}`,
      });
    }

    // Also look for in-development appraisals
    const indevelopPattern =
      /href="(\/guidance\/indevelopment\/(gid-[^"]+))"[^>]*>([^<]+)/gi;
    while (
      (match = indevelopPattern.exec(html)) !== null &&
      results.length < maxResults
    ) {
      const path = match[1]!;
      const gid = match[2]!;
      const title = match[3]!.trim();

      if (results.some((r) => r.id === gid)) continue;

      results.push({
        id: gid,
        source: "nice_ta" as const,
        title: `[In Development] ${title}`,
        authors: ["National Institute for Health and Care Excellence (NICE)"],
        date: new Date().getFullYear().toString(),
        study_type: "hta_report",
        abstract: `NICE appraisal in development (${gid}). Search query: "${query}".`,
        url: `https://www.nice.org.uk${path}`,
      });
    }

    if (results.length > 0) return results;
    return fallbackResults(query, maxResults);
  } catch {
    return fallbackResults(query, maxResults);
  }
}

function fallbackResults(
  query: string,
  maxResults: number,
): LiteratureResult[] {
  return [
    {
      id: "nice_ta_search",
      source: "nice_ta" as const,
      title: `NICE Guidance Search: ${query}`,
      authors: ["National Institute for Health and Care Excellence (NICE)"],
      date: new Date().getFullYear().toString(),
      study_type: "hta_report",
      abstract: `No specific NICE Technology Appraisals found for "${query}". This may mean no TA has been published yet. Check the NICE website directly.`,
      url: `https://www.nice.org.uk/search?q=${encodeURIComponent(query)}`,
    },
  ].slice(0, maxResults);
}
