import type { LiteratureResult } from "../types.js";

export async function fetchCadthReviews(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `CDA-AMC (formerly CADTH) Reimbursement Reviews: ${query}`,
      abstract: `CDA-AMC (Canada's Drug Agency, formerly CADTH) provides independent health technology assessments for reimbursement decisions across Canadian provinces. Includes Common Drug Review (CDR) and pan-Canadian Oncology Drug Review (pCODR) with clinical evidence summaries, pharmacoeconomic reviews, and formulary recommendations. Search "${query}" to find past reimbursement decisions relevant to the drug or indication. Key for benchmarking Canadian market access strategy.`,
      url: `https://www.cda-amc.ca/reimbursement-reviews-search?search_api_fulltext=${encodeURIComponent(query)}`,
    },
    {
      title: `CDA-AMC Pan-Canadian Oncology Drug Review (pCODR)`,
      abstract: `pCODR reviews oncology drugs for reimbursement across Canada. Includes initial and resubmission reviews with clinical and pharmacoeconomic summaries, expert committee recommendations, and pan-Canadian reimbursement conditions. Essential for oncology HTA submissions targeting Canadian payers.`,
      url: "https://www.cda-amc.ca/pcodr",
    },
    {
      title: `CDA-AMC Methods and Guidelines`,
      abstract: `CDA-AMC's methodological guidelines for health technology assessments, including pharmacoeconomic guidelines for Canada. Covers modelling standards, utility values, costs, willingness-to-pay thresholds, and indirect treatment comparisons. Required reference for preparing Canadian HTA submissions.`,
      url: "https://www.cda-amc.ca/methods-and-guidelines",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `cadth_reviews_${i}`,
    source: "cadth_reviews" as const,
    title: e.title,
    authors: ["CDA-AMC — Canada's Drug Agency (formerly CADTH)"],
    date: new Date().getFullYear().toString(),
    study_type: "hta_report",
    abstract: e.abstract,
    url: e.url,
  }));
}
