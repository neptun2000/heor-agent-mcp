import type { LiteratureResult } from "../types.js";

export async function fetchAnvisa(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `ANVISA Drug Pricing (CMED): ${query}`,
      abstract: `ANVISA (Agência Nacional de Vigilância Sanitária) through CMED (Câmara de Regulação do Mercado de Medicamentos) sets maximum drug prices in Brazil. The CMED price list is the reference for public sector drug procurement. Essential for Brazilian HEOR drug cost inputs.`,
      url: `https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/cmed/precos`,
    },
    {
      title: `ANVISA Drug Registry — ${query}`,
      abstract: `ANVISA registry of registered medicinal products in Brazil. Search for registration status, active ingredients, therapeutic class, and marketing authorization holder. Prerequisite check before including drugs in Brazilian CE models.`,
      url: `https://consultas.anvisa.gov.br/#/medicamentos/?search_text=${encodeURIComponent(query)}`,
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `anvisa_${i}`,
    source: "anvisa" as const,
    title: e.title,
    authors: ["ANVISA — Agência Nacional de Vigilância Sanitária (Brazil)"],
    date: new Date().getFullYear().toString(),
    study_type: "regulatory",
    abstract: e.abstract,
    url: e.url,
  }));
}
