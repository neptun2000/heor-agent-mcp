import type { LiteratureResult } from "../types.js";

// Citeline TrialTrove API (Informa/Citeline)
const BASE = "https://api.citeline.com/trialtrove/v1/trials";

interface CitelineTrial {
  trialId?: string;
  title?: string;
  sponsors?: string[];
  phase?: string;
  status?: string;
  startDate?: string;
  therapeuticArea?: string;
  primaryOutcome?: string;
  indication?: string;
}

interface CitelineResponse {
  trials?: CitelineTrial[];
}

export async function fetchCiteline(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const apiKey = process.env.CITELINE_API_KEY;
  if (!apiKey) return [];

  try {
    const url = `${BASE}?q=${encodeURIComponent(query)}&limit=${maxResults}`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as CitelineResponse;
    const trials = data.trials ?? [];

    return trials.slice(0, maxResults).map((t, i) => ({
      id: `citeline_${t.trialId ?? i}`,
      source: "citeline" as const,
      title: t.title ?? "Untitled trial",
      authors: t.sponsors ?? [],
      date: t.startDate ?? "",
      study_type: "rct",
      abstract: [
        `Phase: ${t.phase ?? "N/A"}`,
        `Status: ${t.status ?? "N/A"}`,
        `Indication: ${t.indication ?? "N/A"}`,
        `Therapeutic area: ${t.therapeuticArea ?? "N/A"}`,
        t.primaryOutcome ? `Primary outcome: ${t.primaryOutcome}` : null,
      ].filter(Boolean).join(" | "),
      url: `https://citeline.informa.com/trial/${t.trialId ?? ""}`,
    }));
  } catch {
    return [];
  }
}
