import type { LiteratureResult } from "../types.js";

export async function fetchOhe(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `OHE Publications Search: ${query}`,
      abstract: `Office of Health Economics (OHE) publications catalogue — contract reports, working papers, briefings, and journal articles from the world's oldest independent health economics research organisation. Covers HTA methodology, value assessment, pharmaceutical pricing, and health policy. Search "${query}" to find OHE's analysis relevant to this topic.`,
      url: `https://www.ohe.org/research-and-publications/?search=${encodeURIComponent(query)}`,
    },
    {
      title: `OHE Research — Measuring and Valuing Outcomes`,
      abstract: `OHE's Measuring and Valuing Outcomes (MVO) research theme leads work on EQ-5D value sets, QALY methodology, carer quality of life, and preference-based measures. Key publications on the UK EQ-5D-5L value set (2026), bolt-ons, and child/adolescent health valuation.`,
      url: "https://www.ohe.org/themes/measuring-and-valuing-outcomes/",
    },
    {
      title: `OHE HTA Policy and Methods`,
      abstract: `Independent analyses of HTA agency decisions including NICE, EMA, and international HTA bodies. Includes the "NICE Enough?" series examining how NICE decisions impact international HTA decision-making.`,
      url: "https://www.ohe.org/themes/health-technology-assessment/",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `ohe_${i}`,
    source: "ohe" as const,
    title: e.title,
    authors: ["Office of Health Economics (OHE)"],
    date: new Date().getFullYear().toString(),
    study_type: "heor_research_report",
    abstract: e.abstract,
    url: e.url,
  }));
}
