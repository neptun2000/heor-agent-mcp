import type { LiteratureResult } from "../types.js";

export async function fetchGbaDecisions(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `G-BA Benefit Assessment Search: ${query}`,
      abstract: `G-BA (Gemeinsamer Bundesausschuss — Federal Joint Committee) conducts early benefit assessments of new medicines under the AMNOG process in Germany. Each assessment determines added benefit vs. the appropriate comparator therapy, which directly influences price negotiations with GKV-Spitzenverband. Search "${query}" to find G-BA decisions relevant to the drug or indication. Critical for German market access and pricing strategy.`,
      url: `https://www.g-ba.de/bewertungsverfahren/nutzenbewertung/?from=${encodeURIComponent(query)}`,
    },
    {
      title: `G-BA AMNOG Process Guide`,
      abstract: `AMNOG (Arzneimittelmarktneuordnungsgesetz) is Germany's early benefit assessment process requiring manufacturers to submit dossiers within 3 months of launch. G-BA assesses added benefit in up to 6 months; IQWiG may conduct the assessment. Outcome determines negotiated price or arbitration. Key reference for planning German market access strategy.`,
      url: "https://www.g-ba.de/english/",
    },
    {
      title: `IQWiG Dossier Assessments`,
      abstract: `IQWiG (Institut für Qualität und Wirtschaftlichkeit im Gesundheitswesen) conducts dossier assessments commissioned by G-BA under AMNOG. IQWiG reviews the manufacturer's evidence dossier and issues a preliminary assessment of added benefit. Archive of published assessments is searchable by drug name and indication.`,
      url: "https://www.iqwig.de/en/projects/?tab=dossier-assessments",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `gba_decisions_${i}`,
    source: "gba_decisions" as const,
    title: e.title,
    authors: ["Gemeinsamer Bundesausschuss (G-BA) — Federal Joint Committee, Germany"],
    date: new Date().getFullYear().toString(),
    study_type: "hta_report",
    abstract: e.abstract,
    url: e.url,
  }));
}
