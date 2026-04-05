import type { LiteratureResult } from "../types.js";

export async function fetchNhsCosts(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const currentYear = new Date().getFullYear();
  const latestYear = currentYear - 2; // typically 2 years lag

  const entries = [
    {
      title: `NHS National Cost Collection ${latestYear}/${(latestYear + 1).toString().slice(2)} — ${query}`,
      abstract: `Annual NHS England publication detailing the unit cost of providing healthcare services in England. Covers ~17M patient records across NHS trusts. Reports mean costs per HRG (Healthcare Resource Group) for inpatient admissions, outpatient attendances, A&E, critical care, mental health, community services, and ambulance. Used as the primary source for secondary care costs in NICE economic evaluations. For "${query}", search the published CSV files by HRG code or description.`,
      url: "https://www.england.nhs.uk/costing-in-the-nhs/national-cost-collection/",
    },
    {
      title: `NHS Data Dictionary — HRG Codes`,
      abstract: `Reference for NHS Healthcare Resource Group (HRG) classifications. HRGs group clinically similar and resource-similar treatments for costing purposes. Required for matching diagnosis/procedure codes to NHS reference costs.`,
      url: "https://www.datadictionary.nhs.uk/supporting_information/healthcare_resource_group_hrg.html",
    },
    {
      title: `NHS Payment Scheme (2025/26)`,
      abstract: `The NHS Payment Scheme (formerly National Tariff) sets the prices paid by commissioners for most NHS services. Complementary to reference costs — provides planned rather than actual costs. Used by payers and for budget impact models.`,
      url: "https://www.england.nhs.uk/pay-syst/nhs-payment-scheme/",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `nhs_costs_${i}`,
    source: "nhs_costs" as const,
    title: e.title,
    authors: ["NHS England"],
    date: String(latestYear),
    study_type: "cost_reference",
    abstract: e.abstract,
    url: e.url,
  }));
}
