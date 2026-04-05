import type { LiteratureResult } from "../types.js";

export async function fetchHasTc(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `HAS Transparency Committee Opinions: ${query}`,
      abstract: `HAS (Haute Autorité de Santé) Transparency Committee evaluates medicines for reimbursement in France. Each opinion assigns SMR (Service Médical Rendu — medical benefit level) and ASMR (Amélioration du Service Médical Rendu — improvement in medical benefit, rated I–V) ratings. ASMR rating directly affects the negotiated price with CEPS. Search "${query}" to find CT opinions relevant to the drug or indication. Critical for French market access strategy.`,
      url: `https://www.has-sante.fr/jcms/fc_2875208/en/transparency-committee?text=${encodeURIComponent(query)}`,
    },
    {
      title: `HAS Methodology Guide for Economic Evaluation (2020)`,
      abstract: `HAS's reference guide for economic evaluations submitted to support reimbursement and pricing decisions in France. Covers study design, perspective (collective), discount rates (4%), comparator selection, QALY methodology, and willingness-to-pay thresholds. Required reading for French HTA dossier preparation.`,
      url: "https://www.has-sante.fr/jcms/r_1499251/en/choices-in-methods-for-economic-evaluation",
    },
    {
      title: `CEPS Drug Pricing Framework (France)`,
      abstract: `CEPS (Comité Économique des Produits de Santé) negotiates drug prices with manufacturers based on HAS Transparency Committee ASMR ratings. Drugs with ASMR I–III receive premium pricing; ASMR IV/V are priced at or below comparators. Reference for understanding French pricing framework and negotiation leverage.`,
      url: "https://solidarites-sante.gouv.fr/ministere/acteurs/instances-rattachees/comite-economique-des-produits-de-sante-ceps/",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `has_tc_${i}`,
    source: "has_tc" as const,
    title: e.title,
    authors: ["Haute Autorité de Santé (HAS) — French National Authority for Health"],
    date: new Date().getFullYear().toString(),
    study_type: "hta_report",
    abstract: e.abstract,
    url: e.url,
  }));
}
