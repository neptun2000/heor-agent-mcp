import type { LiteratureResult } from "../types.js";

export async function fetchIets(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `IETS Colombia HTA Reports: ${query}`,
      abstract: `IETS (Instituto de Evaluación Tecnológica en Salud) is Colombia's HTA agency. Publishes rapid HTAs, full HTAs, and cost-effectiveness analyses for Colombian public health system (POS). Reports in Spanish. Key resource for Andean region HTA precedents.`,
      url: `https://www.iets.org.co/Paginas/busqueda.aspx?k=${encodeURIComponent(query)}`,
    },
    {
      title: `IETS Methodology Manuals`,
      abstract: `Colombian HTA methodology manuals covering economic evaluation, systematic reviews, and budget impact analyses. Required reading for Colombia-specific HEOR submissions.`,
      url: "https://www.iets.org.co/Paginas/publicaciones.aspx",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `iets_${i}`,
    source: "iets" as const,
    title: e.title,
    authors: ["IETS — Instituto de Evaluación Tecnológica en Salud (Colombia)"],
    date: new Date().getFullYear().toString(),
    study_type: "hta_report",
    abstract: e.abstract,
    url: e.url,
  }));
}
