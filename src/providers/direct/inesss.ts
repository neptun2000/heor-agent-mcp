import type { LiteratureResult } from "../types.js";

export async function fetchInesss(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `INESSS Quebec HTA Reports: ${query}`,
      abstract: `INESSS (Institut national d'excellence en santé et en services sociaux) is Quebec's HTA agency, advising the Minister of Health on the reimbursement of drugs and health technologies. INESSS produces drug evaluation notices (Avis d'évaluation) that assess clinical value, cost-effectiveness, and budget impact for the Quebec drug formulary (Liste des médicaments). Search "${query}" to find INESSS evaluations relevant to the drug or indication.`,
      url: `https://www.inesss.qc.ca/en/search.html?q=${encodeURIComponent(query)}`,
    },
    {
      title: `INESSS Methodology Framework`,
      abstract: `INESSS publishes methodological guides for drug evaluations and health technology assessments. Covers evidence review methods, pharmacoeconomic evaluation standards, budget impact analysis, and patient/clinical input processes. Key reference for preparing Quebec drug submissions and understanding INESSS evidence requirements.`,
      url: "https://www.inesss.qc.ca/en/publications/publications.html",
    },
    {
      title: `Liste des médicaments (Quebec Drug Formulary)`,
      abstract: `The Liste des médicaments is Quebec's public drug formulary administered by RAMQ (Régie de l'assurance maladie du Québec). It lists all drugs covered under the public prescription drug insurance plan, with reimbursement conditions and special authorization criteria. Essential for understanding the competitive landscape for any indication in Quebec's public payer market.`,
      url: "https://www.ramq.gouv.qc.ca/en/citizens/prescription-drug-insurance/list-medications",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `inesss_${i}`,
    source: "inesss" as const,
    title: e.title,
    authors: ["Institut national d'excellence en santé et en services sociaux (INESSS) — Quebec HTA Agency"],
    date: new Date().getFullYear().toString(),
    study_type: "hta_report",
    abstract: e.abstract,
    url: e.url,
  }));
}
