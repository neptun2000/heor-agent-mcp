import type { LiteratureResult } from "../types.js";

// CMS publishes NADAC data via data.cms.gov. The dataset UUID can be found at:
// https://data.cms.gov/dataset/nadac
// We use the data.cms.gov Resources API which returns JSON.
const BASE = "https://data.cms.gov/data-api/v1/dataset";
// NADAC dataset UUID (stable since 2022)
const NADAC_DATASET_ID = "dfa2ab14-06c2-4b99-9f0e-215a6713b5f2";

interface NadacRow {
  "NDC Description"?: string;
  "NDC"?: string;
  "NADAC Per Unit"?: string;
  "Effective Date"?: string;
  "Pricing Unit"?: string;
  "Pharmacy Type Indicator"?: string;
  "OTC"?: string;
  "Classification for Rate Setting"?: string;
}

export async function fetchCmsNadac(query: string, maxResults: number): Promise<LiteratureResult[]> {
  try {
    // The CMS data-api supports filter syntax
    const url = `${BASE}/${NADAC_DATASET_ID}/data?filter[NDC Description][condition][path]=NDC Description&filter[NDC Description][condition][operator]=CONTAINS&filter[NDC Description][condition][value]=${encodeURIComponent(query.toUpperCase())}&size=${Math.min(maxResults, 100)}`;
    const res = await fetch(url);
    if (!res.ok) return getFallback(query, maxResults);

    const data = (await res.json()) as NadacRow[];
    if (!Array.isArray(data) || data.length === 0) return getFallback(query, maxResults);

    return data.slice(0, maxResults).map((row, i) => ({
      id: `cms_nadac_${row["NDC"] ?? i}`,
      source: "cms_nadac" as const,
      title: `${row["NDC Description"] ?? "Unknown drug"} — NADAC $${row["NADAC Per Unit"] ?? "N/A"}/${row["Pricing Unit"] ?? "unit"}`,
      authors: ["Centers for Medicare & Medicaid Services"],
      date: row["Effective Date"] ?? "",
      study_type: "pricing",
      abstract: [
        `NDC: ${row["NDC"] ?? "N/A"}`,
        `NADAC per unit: $${row["NADAC Per Unit"] ?? "N/A"}`,
        `Pricing unit: ${row["Pricing Unit"] ?? "N/A"}`,
        `Classification: ${row["Classification for Rate Setting"] ?? "N/A"}`,
        `Pharmacy type: ${row["Pharmacy Type Indicator"] ?? "N/A"}`,
        `OTC: ${row["OTC"] ?? "N"}`,
        `Effective: ${row["Effective Date"] ?? ""}`,
      ].join(" | "),
      url: `https://data.cms.gov/dataset/dfa2ab14-06c2-4b99-9f0e-215a6713b5f2/data?filter[NDC]=${row["NDC"] ?? ""}`,
    }));
  } catch {
    return getFallback(query, maxResults);
  }
}

function getFallback(query: string, maxResults: number): LiteratureResult[] {
  return [{
    id: "cms_nadac_search",
    source: "cms_nadac" as const,
    title: `CMS NADAC Search: ${query}`,
    authors: ["Centers for Medicare & Medicaid Services"],
    date: new Date().getFullYear().toString(),
    study_type: "pricing",
    abstract: `Search the CMS National Average Drug Acquisition Cost (NADAC) dataset for "${query}". NADAC provides weekly updated average acquisition costs for all covered outpatient drugs, based on a monthly survey of retail community pharmacies. Used as a reference benchmark for Medicaid pharmacy reimbursement.`,
    url: `https://data.cms.gov/dataset/nadac?query=${encodeURIComponent(query)}`,
  }].slice(0, maxResults);
}
