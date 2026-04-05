import type { LiteratureResult } from "../types.js";

export async function fetchIqwig(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `IQWiG Reports Search: ${query}`,
      abstract: `IQWiG (Institut für Qualität und Wirtschaftlichkeit im Gesundheitswesen — Institute for Quality and Efficiency in Health Care) produces systematic reviews, health technology assessments, and AMNOG dossier assessments commissioned by G-BA. Search "${query}" to find IQWiG reports on clinical benefit, cost-effectiveness, and evidence quality. IQWiG assessments are foundational to G-BA benefit rating decisions under AMNOG.`,
      url: `https://www.iqwig.de/en/projects/?tab=search&query=${encodeURIComponent(query)}`,
    },
    {
      title: `IQWiG General Methods v7.0`,
      abstract: `IQWiG's General Methods document describes its methodological standards for health technology assessments and benefit evaluations. Covers systematic review methodology, GRADE-like evidence rating, indirect comparisons, patient-relevant endpoints, and the efficiency frontier approach for cost-benefit analysis. Key reference for understanding IQWiG's evidence standards.`,
      url: "https://www.iqwig.de/en/about-us/methods/methods-paper/",
    },
    {
      title: `IQWiG Early Benefit Assessment (AMNOG)`,
      abstract: `Under AMNOG, IQWiG assesses manufacturer dossiers submitted to G-BA within 3 months of drug approval. IQWiG evaluates added benefit vs. the appropriate comparator therapy across patient subgroups, assigning probability and extent of added benefit. Published dossier assessments are available for all drugs reviewed since 2011.`,
      url: "https://www.iqwig.de/en/projects/?tab=dossier-assessments",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `iqwig_${i}`,
    source: "iqwig" as const,
    title: e.title,
    authors: ["Institute for Quality and Efficiency in Health Care (IQWiG), Germany"],
    date: new Date().getFullYear().toString(),
    study_type: "hta_report",
    abstract: e.abstract,
    url: e.url,
  }));
}
