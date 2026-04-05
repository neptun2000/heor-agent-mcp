import type { LiteratureResult } from "../types.js";

export async function fetchAifa(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `AIFA HTA Reports: ${query}`,
      abstract: `AIFA (Agenzia Italiana del Farmaco — Italian Medicines Agency) evaluates medicines for reimbursement and pricing in Italy through its Technical Scientific Commission (CTS) and Pricing and Reimbursement Committee (CPR). AIFA assessments consider clinical value, budget impact, and therapeutic alternatives. Search "${query}" to find AIFA reimbursement decisions and HTA reports relevant to the drug or indication.`,
      url: `https://www.aifa.gov.it/en/web/guest/ricerca?inheritRedirect=true&redirect=%2Fen%2Fweb%2Fguest%2Fhome&q=${encodeURIComponent(query)}`,
    },
    {
      title: `AIFA Reimbursement and Pricing Framework`,
      abstract: `AIFA manages drug classification for reimbursement (Class A — fully reimbursed, Class C — non-reimbursed) and negotiates prices with manufacturers. The reimbursement dossier must include clinical evidence, pharmacoeconomic evaluation, and budget impact analysis. Key reference for Italian market access strategy and dossier preparation requirements.`,
      url: "https://www.aifa.gov.it/en/prezzi-e-rimborso",
    },
    {
      title: `Italian National Pharmaceutical Formulary (PT Nazionale)`,
      abstract: `The Prontuario Farmaceutico Nazionale (PFN) lists all medicines reimbursed by Italy's National Health Service (SSN), classified by reimbursement status and prescribing restrictions. Essential for understanding the competitive landscape and existing treatment algorithms for any indication in the Italian market.`,
      url: "https://www.aifa.gov.it/prontuario-farmaceutico-nazionale",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `aifa_${i}`,
    source: "aifa" as const,
    title: e.title,
    authors: ["Agenzia Italiana del Farmaco (AIFA) — Italian Medicines Agency"],
    date: new Date().getFullYear().toString(),
    study_type: "hta_report",
    abstract: e.abstract,
    url: e.url,
  }));
}
