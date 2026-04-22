import type { LiteratureResult } from "../types.js";

export async function fetchEuroqol(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `EuroQol Research Foundation — EQ-5D resources: ${query}`,
      abstract: `Official home of the EQ-5D instrument (EQ-5D-3L, EQ-5D-5L, EQ-5D-Y). Provides access to the instrument, value sets, valuation protocols (EQ-VT v2.1), crosswalk tables, and methods documentation relevant to "${query}".`,
      url: `https://euroqol.org/information-and-support/`,
    },
    {
      title: `EQ-5D-5L Value Sets — Country Registry`,
      abstract: `EuroQol maintains the authoritative registry of country-specific EQ-5D-5L value sets (25+ published, more in development). Includes valuation year, protocol, methods, worst-state utility, and citation for each set. The UK 5L value set (2026) is listed here once formally adopted by NICE.`,
      url: "https://euroqol.org/information-and-support/resources/value-sets/",
    },
    {
      title: `EQ-5D-Y (Child/Adolescent) Resources`,
      abstract: `The youth version EQ-5D-Y-3L (ages 4-7 via proxy) and EQ-5D-Y-5L (ages 8-15 self-complete). Value sets are under development including the UK (OHE involvement). Relevant for paediatric HTA submissions where adult EQ-5D is not appropriate.`,
      url: "https://euroqol.org/eq-5d-instruments/eq-5d-y-3l/",
    },
    {
      title: `EuroQol homepage — instrument and publications catalogue`,
      abstract: `Entry point to EuroQol's catalogue of publications, instruments, valuation protocols, and research programmes (including EQ-5D bolt-on development for cognition, hearing, vision, sleep).`,
      url: "https://euroqol.org/",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `euroqol_${i}`,
    source: "euroqol" as const,
    title: e.title,
    authors: ["EuroQol Research Foundation"],
    date: new Date().getFullYear().toString(),
    study_type: "methodology_reference",
    abstract: e.abstract,
    url: e.url,
  }));
}
