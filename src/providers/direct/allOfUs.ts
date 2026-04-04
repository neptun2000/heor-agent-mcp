import type { LiteratureResult } from "../types.js";

const BASE = "https://databrowser.researchallofus.org/api/v1/databrowser";

interface AoUConcept {
  conceptId: number;
  conceptName: string;
  domainId: string; // "Condition", "Drug", "Measurement", "Procedure"
  vocabularyId: string; // "SNOMED", "LOINC", "RxNorm", etc
  conceptCode: string;
  countValue: number; // participant count
  prevalence: number; // proportion (0-1)
}

interface AoUSearchResponse {
  items?: AoUConcept[];
  totalCount?: number;
}

export async function fetchAllOfUs(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  try {
    const url = `${BASE}/search?query=${encodeURIComponent(query)}&limit=${maxResults}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];

    const data = (await res.json()) as AoUSearchResponse;
    const items = data.items ?? [];

    return items.slice(0, maxResults).map((item) => ({
      id: `aou_${item.conceptId}`,
      source: "all_of_us" as const,
      title: `${item.conceptName} (${item.domainId})`,
      authors: ["NIH All of Us Research Program"],
      date: new Date().getFullYear().toString(),
      study_type: "registry",
      abstract: [
        `Concept: ${item.conceptName}`,
        `Domain: ${item.domainId}`,
        `Vocabulary: ${item.vocabularyId} (${item.conceptCode})`,
        `Participant count: ${item.countValue.toLocaleString()}`,
        item.prevalence > 0
          ? `Prevalence: ${(item.prevalence * 100).toFixed(2)}%`
          : null,
      ]
        .filter(Boolean)
        .join(" | "),
      url: `https://databrowser.researchallofus.org/survey/${item.conceptId}`,
    }));
  } catch {
    return [];
  }
}
