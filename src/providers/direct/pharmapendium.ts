import type { LiteratureResult } from "../types.js";
import { fetchViaProxy, getProxyUrl } from "./proxyClient.js";

// Elsevier Pharmapendium API
const BASE = "https://api.elsevier.com/content/pharmapendium/search";

interface PharmapendiumResult {
  id?: string;
  drugName?: string;
  category?: string; // Preclinical, Clinical, Post-marketing, Regulatory
  summary?: string;
  date?: string;
  source?: string;
}

interface PharmapendiumResponse {
  results?: PharmapendiumResult[];
}

export async function fetchPharmapendium(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  // Try proxy first (user has Teva access via proxy)
  if (getProxyUrl()) {
    const proxyResults = await fetchViaProxy(
      "pharmapendium",
      query,
      maxResults,
    );
    if (proxyResults.length > 0) return proxyResults;
  }

  // Fall back to direct API call if key is set
  const apiKey = process.env.PHARMAPENDIUM_API_KEY;
  if (!apiKey) return [];

  try {
    const url = `${BASE}?query=${encodeURIComponent(query)}&count=${maxResults}`;
    const res = await fetch(url, {
      headers: { "X-ELS-APIKey": apiKey, Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as PharmapendiumResponse;
    const results = data.results ?? [];

    return results.slice(0, maxResults).map((r, i) => ({
      id: `pharmapendium_${r.id ?? i}`,
      source: "pharmapendium" as const,
      title: `${r.drugName ?? "Unknown"} — ${r.category ?? "Regulatory data"}`,
      authors: [r.source ?? "Pharmapendium"],
      date: r.date ?? "",
      study_type: "regulatory",
      abstract: r.summary ?? "",
      url: "https://www.pharmapendium.com/",
    }));
  } catch {
    return [];
  }
}
