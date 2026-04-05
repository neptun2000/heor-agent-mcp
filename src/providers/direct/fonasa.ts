import type { LiteratureResult } from "../types.js";

export async function fetchFonasa(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `FONASA Chile Statistics: ${query}`,
      abstract: `FONASA (Fondo Nacional de Salud) is Chile's public health insurance covering ~80% of population. Statistical bulletins cover enrollment, utilization (outpatient, inpatient, emergency, pharmacy), and expenditure. Essential for Chilean HEOR and burden-of-illness studies.`,
      url: `https://www.fonasa.cl/sites/fonasa/institucional/estadisticas`,
    },
    {
      title: `DEIS Chile Epidemiological Data`,
      abstract: `DEIS (Departamento de Estadísticas e Información de Salud, Ministry of Health Chile) publishes mortality, morbidity, and health resource data. Complements FONASA data for Chilean epidemiological inputs.`,
      url: "https://deis.minsal.cl/",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `fonasa_${i}`,
    source: "fonasa" as const,
    title: e.title,
    authors: ["FONASA — Ministerio de Salud de Chile"],
    date: new Date().getFullYear().toString(),
    study_type: "registry",
    abstract: e.abstract,
    url: e.url,
  }));
}
