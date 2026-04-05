import type { LiteratureResult } from "../types.js";

// PBS data is published via data.gov.au. The actual searchable dataset is at pbs.gov.au,
// but doesn't have a clean REST API. Return structured reference + attempted search.
export async function fetchPbsSchedule(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `PBS Schedule Search: ${query}`,
      abstract: `Australian Pharmaceutical Benefits Scheme (PBS) — the government-subsidized drug scheme covering most prescription medicines in Australia. Search the PBS Schedule for "${query}" to find PBS item codes, max quantities, restrictions, and Approved Ex-Manufacturer Price (AEMP). Used as the primary drug cost input for Australian HEOR studies submitted to PBAC.`,
      url: `https://www.pbs.gov.au/search/search?q=${encodeURIComponent(query)}`,
    },
    {
      title: `PBAC Public Summary Documents — ${query}`,
      abstract: `Pharmaceutical Benefits Advisory Committee (PBAC) Public Summary Documents (PSDs) detail the economic evidence and recommendations for drugs considered for PBS listing. Reviews include indication, comparator, cost-effectiveness, budget impact, and PBAC decision. Key resource for Australian HTA precedents.`,
      url: `https://www.pbs.gov.au/info/industry/listing/elements/pbac-meetings/psd`,
    },
    {
      title: `MBS Online — Medicare Benefits Schedule: ${query}`,
      abstract: `Australian Medicare Benefits Schedule (MBS) lists all medical services with government-funded fee rebates. Search for item numbers, scheduled fees, and benefit amounts. Essential for costing outpatient and specialist services in Australian CE models.`,
      url: `http://www9.health.gov.au/mbs/search.cfm?q=${encodeURIComponent(query)}&sopt=S`,
    },
    {
      title: `AIHW Health Expenditure Data`,
      abstract: `Australian Institute of Health and Welfare publishes health expenditure data annually, including recurrent health expenditure by source and area. Useful for Australian burden-of-illness and budget impact analyses.`,
      url: "https://www.aihw.gov.au/reports-data/health-welfare-expenditure/health-expenditure",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `pbs_schedule_${i}`,
    source: "pbs_schedule" as const,
    title: e.title,
    authors: ["Australian Government Department of Health and Aged Care"],
    date: new Date().getFullYear().toString(),
    study_type: "pricing",
    abstract: e.abstract,
    url: e.url,
  }));
}
