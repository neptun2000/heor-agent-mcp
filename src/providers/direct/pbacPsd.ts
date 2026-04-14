import type { LiteratureResult } from "../types.js";

export async function fetchPbacPsd(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `PBAC Public Summary Documents: ${query}`,
      abstract: `PBAC (Pharmaceutical Benefits Advisory Committee) Public Summary Documents (PSDs) summarise the committee's assessment of drug submissions for PBS listing in Australia. Each PSD covers the basis of submission, clinical claim, clinical evidence, economic evaluation, budget impact, and committee recommendation. Search "${query}" to find PBAC decisions relevant to the drug or indication. Essential for Australian PBS submissions and Asia-Pacific HTA benchmarking.`,
      url: `https://www.pbs.gov.au/info/industry/listing/elements/pbac-meetings/psd?search=${encodeURIComponent(query)}`,
    },
    {
      title: `PBAC Guidelines 5.0 (2016)`,
      abstract: `PBAC guidelines for preparing drug submissions, covering cost-minimisation, cost-effectiveness, and cost-utility analyses. Describes PBAC's preferred methods: incremental analysis, QALYs, discount rate (5%), perspective (health system). PBAC has no formal WTP threshold but the implicit threshold is approximately AUD 50K/QALY. Required reference for PBS submissions.`,
      url: "https://pbac.pbs.gov.au/",
    },
    {
      title: `PBAC Meeting Outcomes Archive`,
      abstract: `Archive of PBAC meeting outcomes listing all recommendations (positive, negative, deferred) from each quarterly meeting. Includes summary of basis for positive and negative recommendations. Useful for tracking PBAC decision trends and understanding committee priorities.`,
      url: "https://www.pbs.gov.au/info/industry/listing/elements/pbac-meetings/pbac-outcomes",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `pbac_psd_${i}`,
    source: "pbac_psd" as const,
    title: e.title,
    authors: ["Pharmaceutical Benefits Advisory Committee (PBAC), Australia"],
    date: new Date().getFullYear().toString(),
    study_type: "hta_report",
    abstract: e.abstract,
    url: e.url,
  }));
}
