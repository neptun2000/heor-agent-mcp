const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

async function oneCount(
  term: string,
  timeoutMs: number,
): Promise<number | undefined> {
  try {
    const url = `${BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retmax=0&retmode=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { esearchresult?: { count?: string } };
    const raw = data.esearchresult?.count;
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchPubmedLineCounts(
  pubmedQueries: string[],
  opts?: { timeoutMs?: number },
): Promise<(number | undefined)[]> {
  const timeoutMs = opts?.timeoutMs ?? 8000;
  const out: (number | undefined)[] = [];
  for (const q of pubmedQueries) {
    out.push(await oneCount(q, timeoutMs));
  }
  return out;
}