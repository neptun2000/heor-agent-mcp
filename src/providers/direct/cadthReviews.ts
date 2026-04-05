import type { LiteratureResult } from "../types.js";

export async function fetchCadthReviews(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `CADTH CDR (Common Drug Review) Reports: ${query}`,
      abstract: `CADTH's Common Drug Review (CDR) and pan-Canadian Oncology Drug Review (pCODR) provide independent health technology assessments for reimbursement decisions across Canadian provinces. Each review includes clinical evidence summary, pharmacoeconomic review, and formulary recommendations. Search "${query}" to find past CDR/pCODR decisions relevant to the drug or indication. Key for benchmarking Canadian market access strategy and understanding CADTH's evidence standards.`,
      url: `https://www.cadth.ca/reimbursement-reviews-search?search_api_fulltext=${encodeURIComponent(query)}`,
    },
    {
      title: `CADTH Pan-Canadian Oncology Drug Review (pCODR)`,
      abstract: `pCODR reviews oncology drugs for reimbursement across Canada. Includes initial and resubmission reviews with clinical and pharmacoeconomic summaries, expert committee recommendations, and pan-Canadian reimbursement conditions. Essential for oncology HTA submissions targeting Canadian payers.`,
      url: "https://www.cadth.ca/pcodr",
    },
    {
      title: `CADTH Methods and Guidelines`,
      abstract: `CADTH's methodological guidelines for health technology assessments, including pharmacoeconomic guidelines for Canada. Covers modelling standards, utility values, costs, willingness-to-pay thresholds, and indirect treatment comparisons. Required reference for preparing Canadian HTA submissions.`,
      url: "https://www.cadth.ca/methods-and-guidelines",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `cadth_reviews_${i}`,
    source: "cadth_reviews" as const,
    title: e.title,
    authors: ["CADTH — Canadian Agency for Drugs and Technologies in Health"],
    date: new Date().getFullYear().toString(),
    study_type: "hta_report",
    abstract: e.abstract,
    url: e.url,
  }));
}
