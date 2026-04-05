import type { LiteratureResult } from "../types.js";

export async function fetchConitec(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `CONITEC Reports: ${query}`,
      abstract: `CONITEC (Comissão Nacional de Incorporação de Tecnologias no SUS) is Brazil's HTA agency. Published reports include cost-effectiveness analyses, budget impact analyses, and incorporation recommendations for SUS. Search "${query}" for relevant Brazilian HTA precedents. Decisions published in Portuguese.`,
      url: `https://www.gov.br/conitec/pt-br/assuntos/tecnologias-avaliadas/busca?search_api_fulltext=${encodeURIComponent(query)}`,
    },
    {
      title: `CONITEC Methodology Guidelines`,
      abstract: `CONITEC's methodology guidelines for economic evaluation of health technologies in Brazil. Covers cost-effectiveness analysis, budget impact analysis, and recommendations structure for SUS submissions.`,
      url: "https://www.gov.br/conitec/pt-br/assuntos/diretrizes-metodologicas",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `conitec_${i}`,
    source: "conitec" as const,
    title: e.title,
    authors: ["CONITEC — Brazilian Ministry of Health"],
    date: new Date().getFullYear().toString(),
    study_type: "hta_report",
    abstract: e.abstract,
    url: e.url,
  }));
}
