import type { LiteratureResult } from "../types.js";

// Clarivate Cortellis Competitive Intelligence API
const BASE = "https://api.cortellis.com/v2/search/ci";

interface CortellisDrug {
  id?: string;
  name?: string;
  sponsor?: string;
  phase?: string;
  indications?: string[];
  mechanismOfAction?: string;
  updatedDate?: string;
  consensusForecast?: string;
}

interface CortellisResponse {
  results?: CortellisDrug[];
}

export async function fetchCortellis(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const apiKey = process.env.CORTELLIS_API_KEY;
  if (!apiKey) return [];

  try {
    const url = `${BASE}?q=${encodeURIComponent(query)}&limit=${maxResults}`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as CortellisResponse;
    const drugs = data.results ?? [];

    return drugs.slice(0, maxResults).map((d, i) => ({
      id: `cortellis_${d.id ?? i}`,
      source: "cortellis" as const,
      title: `${d.name ?? "Unknown"} (${d.phase ?? "N/A"}) — ${d.sponsor ?? "Unknown sponsor"}`,
      authors: [d.sponsor ?? "Clarivate"],
      date: d.updatedDate ?? "",
      study_type: "pipeline",
      abstract: [
        `Phase: ${d.phase ?? "N/A"}`,
        `Sponsor: ${d.sponsor ?? "N/A"}`,
        `Indications: ${(d.indications ?? []).join(", ") || "N/A"}`,
        `MoA: ${d.mechanismOfAction ?? "N/A"}`,
        d.consensusForecast ? `Consensus forecast: ${d.consensusForecast}` : null,
      ].filter(Boolean).join(" | "),
      url: `https://www.cortellis.com/`,
    }));
  } catch {
    return [];
  }
}
