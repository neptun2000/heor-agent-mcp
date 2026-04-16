import { z } from "zod";
import { readKnowledgeFile } from "../knowledge/wikiStore.js";
import type { ToolResult } from "../providers/types.js";
import { createAuditRecord } from "../audit/builder.js";

const KnowledgeReadSchema = z.object({
  project: z.string().min(1),
  path: z.string().min(1),
});

export async function handleKnowledgeRead(
  rawParams: unknown,
): Promise<ToolResult> {
  const params = KnowledgeReadSchema.parse(rawParams);
  const audit = createAuditRecord(
    "knowledge_read",
    params as unknown as Record<string, unknown>,
    "text",
  );

  try {
    const content = await readKnowledgeFile(params.project, params.path);
    return {
      content: `## ${params.path}\n\n${content}`,
      audit,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: `Error reading ${params.path}: ${msg}`,
      audit,
    };
  }
}

export const knowledgeReadToolSchema = {
  name: "knowledge_read",
  description:
    "Read a file from a project's raw/ or wiki/ tree. Path is relative to project root. Only raw/ and wiki/ subtrees accessible.",
  annotations: {
    title: "Knowledge Base Read",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string", description: "Project ID" },
      path: {
        type: "string",
        description:
          "Relative path (e.g. 'wiki/trials/sustain-6.md' or 'raw/literature/pubmed_12345.md')",
      },
    },
    required: ["project", "path"],
  },
};
