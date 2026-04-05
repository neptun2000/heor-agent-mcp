import type { LiteratureResult } from "../types.js";

// GBD doesn't have a clean REST API — provide structured reference results
// pointing users to the right GBD tools
function getFallbackGbdResults(
  query: string,
  maxResults: number,
): LiteratureResult[] {
  const gbd_tools = [
    {
      title: `GBD Results Tool — ${query}`,
      abstract: `Search the Global Burden of Disease interactive results tool for DALYs, YLLs, YLDs, prevalence, incidence, and mortality estimates related to "${query}". Filter by location, age, sex, year (1990-2021). Data available for 369 diseases and injuries across 204 countries.`,
      url: `https://vizhub.healthdata.org/gbd-results/?params=gbd-api-2021-permalink/${encodeURIComponent(query)}`,
    },
    {
      title: `GBD Compare Visualization — ${query}`,
      abstract: `Interactive treemap and heatmap visualization of disease burden for "${query}". Compare across countries, ages, and time periods. Includes DALYs, deaths, prevalence.`,
      url: `https://vizhub.healthdata.org/gbd-compare/`,
    },
    {
      title: `Global Health Data Exchange — ${query}`,
      abstract: `Search the IHME Global Health Data Exchange catalog for datasets, surveys, and data sources related to "${query}". Includes census data, survey microdata, and vital registration.`,
      url: `https://ghdx.healthdata.org/keyword/${encodeURIComponent(query)}`,
    },
  ];

  return gbd_tools.slice(0, maxResults).map((tool, i) => ({
    id: `ihme_gbd_${i}`,
    source: "ihme_gbd" as const,
    title: tool.title,
    authors: ["Institute for Health Metrics and Evaluation (IHME)"],
    date: "2024",
    study_type: "registry",
    abstract: tool.abstract,
    url: tool.url,
  }));
}

export async function fetchIhmeGbd(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  try {
    // Use the GHDx search API for GBD-related records
    const url = `https://ghdx.healthdata.org/search/site/${encodeURIComponent(query)}?f[0]=field_record_type%3A3&json=true`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    // If the search API doesn't return JSON, fall back to providing reference links
    if (!res.ok) {
      return getFallbackGbdResults(query, maxResults);
    }

    const text = await res.text();
    // Try to parse as JSON
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      if (data.results && Array.isArray(data.results)) {
        return (data.results as Array<Record<string, unknown>>)
          .slice(0, maxResults)
          .map((r, i) => ({
            id: `ihme_gbd_${i}`,
            source: "ihme_gbd" as const,
            title: (r.title as string) ?? `GBD Result: ${query}`,
            authors: ["Institute for Health Metrics and Evaluation"],
            date:
              (r.year as string) ?? new Date().getFullYear().toString(),
            study_type: "registry",
            abstract:
              (r.snippet as string) ??
              (r.description as string) ??
              `Global Burden of Disease estimate for: ${query}`,
            url:
              (r.link as string) ??
              `https://vizhub.healthdata.org/gbd-results/`,
          }));
      }
    } catch {
      // Not JSON, use fallback
    }

    return getFallbackGbdResults(query, maxResults);
  } catch {
    return getFallbackGbdResults(query, maxResults);
  }
}
