import type { LiteratureResult } from "../types.js";

export async function fetchIcerReports(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  const entries = [
    {
      title: `ICER Evidence Report: ${query}`,
      abstract: `ICER (Institute for Clinical and Economic Review) produces independent evidence reports assessing the clinical and economic value of new drugs and technologies in the US market. Reports include systematic literature reviews, cost-effectiveness analyses, and health-benefit price benchmarks (HBPBs). Search "${query}" to find ICER assessments relevant to the drug or indication. Key for US payer negotiations and value-based contract strategy.`,
      url: `https://icer.org/?s=${encodeURIComponent(query)}`,
    },
    {
      title: `ICER Value Assessment Framework 2023-2026`,
      abstract: `ICER's Value Assessment Framework describes the methods used in all ICER evidence reports. Covers clinical benefit rating, comparative value rating, incremental cost-effectiveness ratios, health-benefit price benchmarks, and budget impact analysis. Essential reading for understanding ICER's standards and preparing for ICER engagement.`,
      url: "https://icer.org/our-approach/methods-process/value-assessment-framework/",
    },
    {
      title: `ICER Health-Benefit Price Benchmarks (HBPB)`,
      abstract: `ICER publishes health-benefit price benchmarks for drugs under review, representing the price at which the drug would achieve acceptable cost-effectiveness at $50K, $100K, and $150K/QALY thresholds. HBPBs are widely referenced in US payer negotiations and value-based contracts. Archive of benchmarks available for previously reviewed drugs.`,
      url: "https://icer.org/our-approach/methods-process/value-based-price-benchmarks/",
    },
  ];

  return entries.slice(0, maxResults).map((e, i) => ({
    id: `icer_reports_${i}`,
    source: "icer_reports" as const,
    title: e.title,
    authors: ["Institute for Clinical and Economic Review (ICER)"],
    date: new Date().getFullYear().toString(),
    study_type: "hta_report",
    abstract: e.abstract,
    url: e.url,
  }));
}
