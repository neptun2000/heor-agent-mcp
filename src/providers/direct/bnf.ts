import type { LiteratureResult } from "../types.js";

export async function fetchBnf(query: string, maxResults: number): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `BNF Drug Pricing: ${query}`,
      abstract: `The British National Formulary (BNF) is the authoritative UK drug reference, including prices, dosing, indications, and contraindications. For "${query}", search the NICE BNF website. NHS list prices are used as the primary drug cost input in NICE economic models. Prices are updated monthly.`,
      url: `https://bnf.nice.org.uk/search/?q=${encodeURIComponent(query)}`,
    },
    {
      title: `NHS Drug Tariff — Community Pharmacy Prices`,
      abstract: `NHS Business Services Authority publishes the monthly Drug Tariff with reimbursement prices paid to community pharmacies for drugs dispensed in primary care. Complementary to BNF for understanding community prescribing costs.`,
      url: "https://www.nhsbsa.nhs.uk/pharmacies-gp-practices-and-appliance-contractors/drug-tariff",
    },
    {
      title: `Electronic Medicines Compendium (emc)`,
      abstract: `Free access to Summary of Product Characteristics (SmPC) and Patient Information Leaflets (PILs) for UK-licensed medicines. Required for confirming indications and dosing when building cost models.`,
      url: `https://www.medicines.org.uk/emc/search?q=${encodeURIComponent(query)}`,
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `bnf_${i}`,
    source: "bnf" as const,
    title: e.title,
    authors: ["Joint Formulary Committee (BMJ Group & Royal Pharmaceutical Society)"],
    date: new Date().getFullYear().toString(),
    study_type: "drug_pricing",
    abstract: e.abstract,
    url: e.url,
  }));
}
