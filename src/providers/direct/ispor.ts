import type { LiteratureResult } from "../types.js";

export async function fetchIspor(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `ISPOR Presentations Database: ${query}`,
      abstract: `ISPOR's searchable database of conference abstracts from ISPOR Annual (North America) and ISPOR Europe meetings. Covers cost-effectiveness models, budget impact analyses, real-world evidence studies, patient-reported outcomes, HTA submissions, and methodology papers. Over 30,000 abstracts spanning 20+ years. Primary source for HEOR conference literature and emerging methodology trends.`,
      url: `https://www.ispor.org/heor-resources/presentations-database/search?query=${encodeURIComponent(query)}`,
    },
    {
      title: `ISPOR Good Practices Reports — ${query}`,
      abstract: `ISPOR Good Practices task force reports define consensus methodology standards for HEOR. Topics include modeling, PROs, RWD, budget impact, HTA, value frameworks, and indirect comparisons. Cited by NICE, ICER, and CADTH as authoritative methodology references.`,
      url: `https://www.ispor.org/heor-resources/good-practices`,
    },
    {
      title: `ISPOR Value in Health Journal — ${query}`,
      abstract: `The official ISPOR journal. Peer-reviewed articles on economic evaluation, outcomes research, pricing, HTA, and RWE. High-impact source for HEOR methodology and applied studies.`,
      url: `https://www.valueinhealthjournal.com/action/doSearch?AllField=${encodeURIComponent(query)}`,
    },
    {
      title: `ISPOR Education Center — ${query}`,
      abstract: `Training resources, webinars, short courses, and certification programs. Covers statistical methods, modeling, HTA methodology, and real-world data analysis. Useful for understanding current HEOR methodological standards.`,
      url: "https://www.ispor.org/conferences-education/education-training",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `ispor_${i}`,
    source: "ispor" as const,
    title: e.title,
    authors: ["International Society for Pharmacoeconomics and Outcomes Research (ISPOR)"],
    date: new Date().getFullYear().toString(),
    study_type: "hta_report",
    abstract: e.abstract,
    url: e.url,
  }));
}
