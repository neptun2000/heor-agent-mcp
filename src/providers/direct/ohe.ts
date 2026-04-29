import type { LiteratureResult } from "../types.js";

export async function fetchOhe(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: "OHE EQ-5D value set research and analysis",
      abstract: `OHE publishes research on EQ-5D value sets for NICE appraisals, including the UK 3L value set, England 5L (Devlin 2018), NICE DSU 3L→5L mapping (2022), and the new UK EQ-5D-5L consultation (2026). Essential reference for understanding utility weighting algorithms and ICER impact under different value sets.`,
      url: "https://www.ohe.org/publications?search=EQ-5D",
    },
    {
      title: "OHE — Health Economics Resources and Guidelines",
      abstract: `OHE provides authoritative guidance on HTA methodology, NICE reference case implementation, EQ-5D value set transitions, ICER estimation, and probabilistic sensitivity analysis. OHE researchers contribute to NICE, Cochrane, and international HTA standards. Access free downloadable reports on economic evaluation methodology and healthcare system analysis.`,
      url: "https://www.ohe.org/",
    },
    {
      title: "OHE Research Reports and Publications",
      abstract: `The Office of Health Economics (OHE) is an independent research organization specializing in health economics and outcomes research. OHE publications cover HEOR methodology, economic evaluation, health technology assessment, and healthcare policy. Browse publications at https://www.ohe.org/publications to find peer-reviewed reports and guidance on pharmacoeconomics, cost-effectiveness analysis, and health policy relevant to "${query}".`,
      url: `https://www.ohe.org/publications?search=${encodeURIComponent(query)}`,
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `ohe_${i}`,
    source: "ohe" as const,
    title: e.title,
    authors: ["Office of Health Economics (OHE)"],
    date: new Date().getFullYear().toString(),
    study_type: "heor_methods",
    abstract: e.abstract,
    url: e.url,
  }));
}
