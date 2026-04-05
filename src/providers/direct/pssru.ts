import type { LiteratureResult } from "../types.js";

// PSSRU Unit Costs: annual publication, no API. Return structured reference links.
export async function fetchPssru(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const currentYear = new Date().getFullYear();
  const latestVolume = currentYear - 1; // published retrospectively

  const entries = [
    {
      title: `PSSRU Unit Costs of Health & Social Care ${latestVolume} — ${query}`,
      abstract: `The definitive UK reference for HEOR cost inputs. Covers: staff costs (consultant, GP, nurse, allied health), hospital services (inpatient/day-case/outpatient per diem), community and primary care, mental health, social care, hotel costs, and capital costs. For query "${query}", consult the latest volume (typically released November). Used by NICE for cost-per-QALY models. Hourly rates, per-contact costs, and per-episode costs are provided with uncertainty ranges.`,
      url: "https://www.pssru.ac.uk/unitcostsreport/",
    },
    {
      title: `PSSRU Historic Unit Costs Archive — ${query}`,
      abstract: `Historic PSSRU volumes (2001-present). Useful for retrospective cost-effectiveness analyses, model validation, and cost inflation calculations. Published annually by University of Kent.`,
      url: "https://www.pssru.ac.uk/research-archive/",
    },
    {
      title: `NICE Reference Case Cost Inputs — use PSSRU + NHS National Cost Collection`,
      abstract: `For a NICE STA/MTA submission, unit costs should be sourced from: (1) PSSRU Unit Costs for staff/care time, (2) NHS National Cost Collection (formerly Reference Costs) for healthcare resource groups (HRGs), (3) BNF for drug costs. All inflated to current price year using HCHS pay & prices index.`,
      url: "https://www.nice.org.uk/process/pmg36/chapter/economic-evaluation",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `pssru_${i}`,
    source: "pssru" as const,
    title: e.title,
    authors: ["Personal Social Services Research Unit (PSSRU), University of Kent"],
    date: String(latestVolume),
    study_type: "cost_reference",
    abstract: e.abstract,
    url: e.url,
  }));
}
