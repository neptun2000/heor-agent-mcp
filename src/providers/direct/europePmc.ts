import type { LiteratureResult } from "../types.js";

/**
 * Europe PMC — 40M+ abstracts + full text + preprints + guidelines, free REST API.
 * Richer full-text coverage than PubMed (better for confounder extraction from
 * methods/baseline tables). Design log #43 follow-up (source expansion).
 *
 * API: https://europepmc.org/RestfulWebService
 */
const BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

interface EuropePmcResult {
  id?: string;
  source?: string; // MED, PMC, PPR, etc.
  pmid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  pubYear?: string;
  pubType?: string;
  abstractText?: string;
}

export async function fetchEuropePmc(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  // No try/catch — let errors propagate so the dispatcher records status:"failed".
  const url =
    `${BASE}?query=${encodeURIComponent(query)}` +
    `&format=json&resultType=core&pageSize=${Math.min(maxResults, 100)}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "HEORAgent (mailto:support@heor-agent.dev)" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`[Europe PMC] API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    resultList?: { result?: EuropePmcResult[] };
  };
  const results = data.resultList?.result ?? [];
  return results.map((r) => {
    const authors = (r.authorString ?? "")
      .replace(/\.$/, "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const url = r.doi
      ? `https://doi.org/${r.doi}`
      : r.pmid
        ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`
        : `https://europepmc.org/article/${r.source ?? "MED"}/${r.id ?? ""}`;
    return {
      id: `europe_pmc_${r.doi ?? r.pmid ?? r.id ?? "unknown"}`,
      source: "europe_pmc" as const,
      title: r.title ?? "(untitled)",
      authors,
      date: r.pubYear ?? "",
      study_type: r.pubType ?? "",
      abstract: r.abstractText ?? "",
      url,
    };
  });
}
