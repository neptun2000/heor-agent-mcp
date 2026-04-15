import type { LiteratureResult } from "../types.js";

export async function fetchTlv(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `TLV Sweden Decisions: ${query}`,
      abstract: `TLV (Tandvårds- och läkemedelsförmånsverket — Dental and Pharmaceutical Benefits Agency) makes reimbursement decisions for drugs in Sweden's pharmaceutical benefits scheme (LFN). Each decision includes clinical assessment, health economic evaluation, and reimbursement conditions. Search "${query}" to find TLV decisions relevant to the drug or indication. Key for Swedish market access and Nordic HTA benchmarking.`,
      url: `https://www.tlv.se/beslut/sok-i-databasen.html?q=${encodeURIComponent(query)}`,
    },
    {
      title: `TLV General Guidelines for Economic Evaluations`,
      abstract: `TLV's guidelines for health economic evaluations submitted in support of reimbursement applications. Covers cost-effectiveness analysis with severity-tiered WTP thresholds: ~SEK 250K/QALY (low severity), ~SEK 500K (medium), ~SEK 750K (high), ~SEK 1M (very high severity). QALY methodology, societal perspective, 3% discount rate, and uncertainty analysis requirements. Required reading for Swedish HTA submissions.`,
      url: "https://www.tlv.se/in-english/medicines/general-guidelines-for-economic-evaluations.html",
    },
    {
      title: `TLV Value-Based Pricing Framework`,
      abstract: `Sweden operates a value-based pricing system administered by TLV. Drug prices are set based on demonstrated cost-effectiveness relative to severity of disease. TLV applies an ethical platform considering severity, need, and equity alongside economic evidence. Overview of the Swedish pharmaceutical reimbursement framework and value assessment principles.`,
      url: "https://www.tlv.se/in-english/about-us.html",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `tlv_${i}`,
    source: "tlv" as const,
    title: e.title,
    authors: [
      "Tandvårds- och läkemedelsförmånsverket (TLV) — Dental and Pharmaceutical Benefits Agency, Sweden",
    ],
    date: new Date().getFullYear().toString(),
    study_type: "hta_report",
    abstract: e.abstract,
    url: e.url,
  }));
}
