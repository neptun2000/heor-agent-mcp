import type { LiteratureResult } from "../types.js";

export async function fetchHitap(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `HITAP Thailand HTA Database: ${query}`,
      abstract: `HITAP (Health Intervention and Technology Assessment Program) is Thailand's HTA agency and a regional APAC leader. Publishes cost-effectiveness analyses, budget impact studies, and policy briefs. Reports in Thai and English. Key resource for APAC HTA methodology and precedents.`,
      url: `https://www.hitap.net/en/?s=${encodeURIComponent(query)}`,
    },
    {
      title: `HITAP Reference Case (Thai Working Group on HTA)`,
      abstract: `Thailand's reference case methodology for economic evaluation, similar to NICE reference case. Covers perspective, time horizon, discount rate (3% for Thailand), utility measurement, and uncertainty analysis. Standard for Thai CE model submissions.`,
      url: "https://www.hitap.net/en/research/reference-case",
    },
    {
      title: `iDSI International Decision Support Initiative`,
      abstract: `HITAP co-leads iDSI — a global network supporting HTA capacity in LMICs. Useful for understanding APAC/LATAM/Africa HTA methodology harmonization and finding regional HEOR collaborators.`,
      url: "https://idsihealth.org/",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `hitap_${i}`,
    source: "hitap" as const,
    title: e.title,
    authors: ["HITAP — Health Intervention and Technology Assessment Program (Thailand)"],
    date: new Date().getFullYear().toString(),
    study_type: "hta_report",
    abstract: e.abstract,
    url: e.url,
  }));
}
