import type { LiteratureResult } from "../types.js";

export async function fetchNiceTa(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `NICE Technology Appraisals Search: ${query}`,
      abstract: `NICE Technology Appraisals (TAs) recommend whether NHS England should fund new medicines. Each TA includes: company submission, ERG (evidence review group) report, committee papers, final appraisal determination (FAD), and guidance. Search "${query}" across all published TAs to find precedents for similar indications, comparators, or ICER thresholds. Essential for NICE STA submission benchmarking.`,
      url: `https://www.nice.org.uk/search?q=${encodeURIComponent(query)}&ngt=Guidance&ndt=Guidance#/?ngt=Guidance&ndt=Guidance`,
    },
    {
      title: `NICE Single Technology Appraisal Process Guide`,
      abstract: `NICE's STA methodology guide PMG36 and process guide PMG19. Required reading for company submissions. Covers reference case, time horizon, discount rates (3.5%), perspective (NHS+PSS), ICER threshold (£25–35K/QALY, updated April 2026), end-of-life criteria, and innovation rating.`,
      url: "https://www.nice.org.uk/process/pmg36",
    },
    {
      title: `NICE Committee Papers Archive`,
      abstract: `Archive of NICE Appraisal Committee meeting papers including company submission dossiers, ERG critique reports, patient/clinical expert statements. Useful for understanding committee reasoning and common critiques.`,
      url: `https://www.nice.org.uk/guidance/published?type=ta&ssup=committee-papers`,
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `nice_ta_${i}`,
    source: "nice_ta" as const,
    title: e.title,
    authors: ["National Institute for Health and Care Excellence (NICE)"],
    date: new Date().getFullYear().toString(),
    study_type: "hta_report",
    abstract: e.abstract,
    url: e.url,
  }));
}
