import { z } from "zod";
import type { ToolResult } from "../providers/types.js";
import {
  extractComparatorPairs,
  buildEvidenceNetwork,
} from "../network/index.js";
import { networkToMarkdown } from "../formatters/networkMarkdown.js";
import { createAuditRecord, setMethodology } from "../audit/builder.js";
import type { LiteratureResult } from "../providers/types.js";

const EvidenceNetworkSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.string(),
        source: z.string(),
        title: z.string(),
        authors: z.array(z.string()),
        date: z.string(),
        study_type: z.string(),
        abstract: z.string(),
        url: z.string(),
      }),
    )
    .max(500)
    .describe(
      "Array of LiteratureResult objects from a prior literature.search call",
    ),
  query: z.string().optional().describe("Original search query (for context)"),
});

export async function handleEvidenceNetwork(
  rawParams: unknown,
): Promise<ToolResult> {
  const params = EvidenceNetworkSchema.parse(rawParams);
  const results = params.results as LiteratureResult[];

  let audit = createAuditRecord(
    "evidence.network",
    { query: params.query, resultCount: results.length },
    "text",
  );
  audit = setMethodology(
    audit,
    "Automated comparator extraction with NMA feasibility assessment",
  );

  // Extract comparator pairs
  const pairs = extractComparatorPairs(results);

  // Build network
  const network = buildEvidenceNetwork(pairs);

  // Format output
  const markdown = networkToMarkdown(network);

  const summary = [
    markdown,
    "",
    "---",
    `*Analyzed ${results.length} studies. Extracted ${pairs.length} comparator pairs.*`,
  ].join("\n");

  return { content: summary, audit };
}

export const evidenceNetworkToolSchema = {
  name: "evidence.network",
  description:
    "Analyze literature search results to build an evidence network map. Extracts intervention-comparator pairs from titles and abstracts, constructs a treatment comparison network, and assesses NMA (network meta-analysis) feasibility. Pass the results array from a prior literature.search call.",
  annotations: {
    title: "Evidence Network Analysis",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            source: { type: "string" },
            title: { type: "string" },
            authors: { type: "array", items: { type: "string" } },
            date: { type: "string" },
            study_type: { type: "string" },
            abstract: { type: "string" },
            url: { type: "string" },
          },
          required: [
            "id",
            "source",
            "title",
            "authors",
            "date",
            "study_type",
            "abstract",
            "url",
          ],
        },
        description:
          "Array of LiteratureResult objects from a prior literature.search call (use output_format='json')",
      },
      query: {
        type: "string",
        description: "Original search query (optional, for context)",
      },
    },
    required: ["results"],
  },
};
