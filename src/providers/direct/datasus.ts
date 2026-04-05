import type { LiteratureResult } from "../types.js";

export async function fetchDatasus(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `DATASUS TabNet: ${query}`,
      abstract: `Brazilian Unified Health System (SUS) database. TabNet provides web-based access to aggregated SUS data: hospitalizations (SIH/SUS), outpatient procedures (SIA/SUS), mortality (SIM), births (SINASC), notifiable diseases (SINAN), and population estimates. Essential for Brazilian HEOR studies and CONITEC submissions. Search "${query}" across all modules.`,
      url: `http://tabnet.datasus.gov.br/cgi/tabcgi.exe?sih/cnv/qiuf.def`,
    },
    {
      title: `SIH/SUS Hospital Information System — ${query}`,
      abstract: `SIH/SUS (Sistema de Informações Hospitalares) contains all SUS-funded hospital admissions in Brazil with ICD-10 diagnoses, procedures, length of stay, and reimbursement. ~12M admissions/year. Primary source for Brazilian hospitalization cost data.`,
      url: `http://www2.datasus.gov.br/DATASUS/index.php?area=0202`,
    },
    {
      title: `SIA/SUS Ambulatory Information System`,
      abstract: `SIA/SUS covers outpatient procedures funded by SUS: consultations, exams, specialty appointments, chemotherapy, radiotherapy, dialysis. Used for outpatient cost modeling in Brazilian HEOR submissions.`,
      url: `http://www2.datasus.gov.br/DATASUS/index.php?area=0201`,
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `datasus_${i}`,
    source: "datasus" as const,
    title: e.title,
    authors: ["Brazilian Ministry of Health — DATASUS"],
    date: new Date().getFullYear().toString(),
    study_type: "registry",
    abstract: e.abstract,
    url: e.url,
  }));
}
