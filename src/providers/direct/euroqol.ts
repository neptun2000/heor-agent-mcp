import type { LiteratureResult } from "../types.js";

export async function fetchEuroqol(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: "EuroQol Group — EQ-5D Instruments and Value Sets",
      abstract: `The EuroQol Group is the international not-for-profit organization responsible for developing, maintaining, and licensing the EQ-5D health-related quality of life instrument. EuroQol manages the EQ-5D-3L, EQ-5D-5L, and EQ-5D-Youth instruments along with value sets from 100+ countries. Access information on instrument modes, value sets, and licensing at https://euroqol.org/eq-5d-instruments/eq-5d-5l-available-modes-of-administration/.`,
      url: "https://euroqol.org/eq-5d-instruments/eq-5d-5l-available-modes-of-administration/",
    },
    {
      title: "EuroQol Value Set Registry",
      abstract: `The EuroQol value set registry catalogs all published EQ-5D value sets by country, year, algorithm, and population. Includes the UK 3L (MVH 1997), UK 5L (new 2026), Japan, Korea, Netherlands, Spain, USA, and 80+ other countries. Essential for selecting the appropriate utility weights for health economic models and HTA submissions.`,
      url: "https://euroqol.org/eq-5d-instruments/eq-5d-5l-value-sets/",
    },
    {
      title: "EuroQol Research and Documentation",
      abstract: `EuroQol publishes scientific papers on instrument development, validation, cross-cultural adaptation, and value set algorithms. Browse research at https://euroqol.org/publications/ to understand the methodological foundation of EQ-5D utilities used in NICE, CADTH, HAS, and other HTA submissions. Cites foundational works like Devlin et al. (2018) for England 5L and Biz et al. (2026) for UK 5L impact analysis.`,
      url: "https://euroqol.org/publications/",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `euroqol_${i}`,
    source: "euroqol" as const,
    title: e.title,
    authors: ["EuroQol Group"],
    date: new Date().getFullYear().toString(),
    study_type: "heor_methods",
    abstract: e.abstract,
    url: e.url,
  }));
}
