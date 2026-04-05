import type { LiteratureResult } from "../types.js";

export async function fetchPaho(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `PAHO Open Data Portal: ${query}`,
      abstract: `Pan American Health Organization (PAHO) provides regional health statistics across the Americas (North, Central, South, Caribbean). Covers mortality, morbidity, immunization coverage, health expenditure, and health workforce. Primary source for LATAM epidemiology and demographic inputs.`,
      url: `https://opendata.paho.org/en/catalog?q=${encodeURIComponent(query)}`,
    },
    {
      title: `PAHO Core Health Indicators — ${query}`,
      abstract: `PAHO Core Indicators database with 115+ indicators across 49 countries. Includes life expectancy, mortality by cause, DALYs, health system resources, and health expenditure. Compatible with WHO GHO methodology.`,
      url: "https://opendata.paho.org/en/core-indicators",
    },
    {
      title: `PLISA Health Information Platform — ${query}`,
      abstract: `PAHO's Health Information Platform for the Americas (PLISA) provides subnational data, disease-specific dashboards, and health in the Americas regional reports. Key source for Latin American burden-of-illness estimates.`,
      url: "https://www3.paho.org/data/index.php/en/",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `paho_${i}`,
    source: "paho" as const,
    title: e.title,
    authors: ["Pan American Health Organization (PAHO/WHO)"],
    date: new Date().getFullYear().toString(),
    study_type: "registry",
    abstract: e.abstract,
    url: e.url,
  }));
}
