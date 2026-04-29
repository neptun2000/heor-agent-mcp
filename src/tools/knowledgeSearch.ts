import { z } from "zod";
import { searchProject } from "../knowledge/search.js";
import type { ToolResult } from "../providers/types.js";
import { createAuditRecord } from "../audit/builder.js";

const KnowledgeSearchSchema = z.object({
  project: z.string().min(1),
  query: z.string().min(1),
  paths: z.array(z.enum(["raw", "wiki"])).optional(),
  max_results: z.number().int().min(1).max(100).optional(),
  case_sensitive: z.boolean().optional(),
});

export async function handleKnowledgeSearch(
  rawParams: unknown,
): Promise<ToolResult> {
  const params = KnowledgeSearchSchema.parse(rawParams);
  const audit = createAuditRecord(
    "knowledge.search",
    params as unknown as Record<string, unknown>,
    "text",
  );

  const matches = await searchProject(params.project, params.query, {
    paths: params.paths,
    max_results: params.max_results,
    case_sensitive: params.case_sensitive,
  });

  const lines: string[] = [];
  lines.push(`## Knowledge Search: "${params.query}"`);
  lines.push(`Project: ${params.project} | Matches: ${matches.length}\n`);

  if (matches.length === 0) {
    lines.push(
      "No matches found. Try broader search terms or check that the project has been populated (run literature.search with `project` param first).",
    );
  } else {
    for (const m of matches) {
      lines.push(`### ${m.file}${m.title ? ` — ${m.title}` : ""}`);
      if (m.source) lines.push(`*Source: ${m.source}*`);
      lines.push(`Line ${m.line_number}: \`${m.snippet}\``);
      lines.push("");
    }
  }

  return { content: lines.join("\n"), audit };
}

export const knowledgeSearchToolSchema = {
  name: "knowledge.search",
  description:
    "Search a project's knowledge base (raw/ and wiki/) for text matches. Returns file paths with line numbers and snippets. Use this to find previously-retrieved literature, model runs, and compiled wiki content without re-querying external APIs.",
  annotations: {
    title: "Knowledge Base Search",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string", description: "Project ID (must exist)" },
      query: {
        type: "string",
        description: "Search query — multi-term searches match ANY term (OR)",
      },
      paths: {
        type: "array",
        items: { type: "string", enum: ["raw", "wiki"] },
        description: "Which subtrees to search. Default: both.",
      },
      max_results: {
        type: "number",
        description: "Max matches to return (default 20, max 100)",
      },
      case_sensitive: {
        type: "boolean",
        description: "Case-sensitive search (default false)",
      },
    },
    required: ["project", "query"],
  },
};
