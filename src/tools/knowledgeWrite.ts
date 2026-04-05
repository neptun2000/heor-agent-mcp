import { z } from "zod";
import { writeWikiFile } from "../knowledge/wikiStore.js";
import type { ToolResult } from "../providers/types.js";
import { createAuditRecord } from "../audit/builder.js";

const KnowledgeWriteSchema = z.object({
  project: z.string().min(1),
  path: z.string().min(1),
  content: z.string(),
});

export async function handleKnowledgeWrite(rawParams: unknown): Promise<ToolResult> {
  const params = KnowledgeWriteSchema.parse(rawParams);
  const audit = createAuditRecord("knowledge_write", { project: params.project, path: params.path }, "text");

  try {
    const fullPath = await writeWikiFile(params.project, params.path, params.content);
    return {
      content: `✓ Wrote ${params.path} (${params.content.length} chars)\nFull path: ${fullPath}`,
      audit,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: `Error writing ${params.path}: ${msg}`,
      audit,
    };
  }
}

export const knowledgeWriteToolSchema = {
  name: "knowledge_write",
  description: "Write a file to the project's wiki/ tree. Path MUST start with 'wiki/' and end with '.md'. Use this to compile/organize evidence from raw/ files into a structured knowledge base. Supports Obsidian-style [[wikilinks]].",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string", description: "Project ID" },
      path: { type: "string", description: "Relative path starting with 'wiki/', ending with .md (e.g. 'wiki/trials/sustain-6.md')" },
      content: { type: "string", description: "Markdown content. Can include YAML frontmatter and [[wikilinks]]." },
    },
    required: ["project", "path", "content"],
  },
};
