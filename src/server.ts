#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  handleLiteratureSearch,
  literatureSearchToolSchema,
} from "./tools/literatureSearch.js";
import {
  handleCostEffectivenessModel,
  costEffectivenessModelToolSchema,
} from "./tools/costEffectivenessModel.js";
import {
  handleHtaDossierPrep,
  htaDossierPrepToolSchema,
} from "./tools/htaDossierPrep.js";
import {
  handleKnowledgeSearch,
  knowledgeSearchToolSchema,
} from "./tools/knowledgeSearch.js";
import {
  handleKnowledgeRead,
  knowledgeReadToolSchema,
} from "./tools/knowledgeRead.js";
import {
  handleKnowledgeWrite,
  knowledgeWriteToolSchema,
} from "./tools/knowledgeWrite.js";
import {
  handleProjectCreate,
  projectCreateToolSchema,
} from "./tools/projectCreate.js";

const server = new Server(
  { name: "heor-agent-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    literatureSearchToolSchema,
    costEffectivenessModelToolSchema,
    htaDossierPrepToolSchema,
    knowledgeSearchToolSchema,
    knowledgeReadToolSchema,
    knowledgeWriteToolSchema,
    projectCreateToolSchema,
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;
    switch (name) {
      case "literature_search":
        result = await handleLiteratureSearch(args);
        break;
      case "cost_effectiveness_model":
        result = await handleCostEffectivenessModel(args);
        break;
      case "hta_dossier_prep":
        result = await handleHtaDossierPrep(args);
        break;
      case "knowledge_search":
        result = await handleKnowledgeSearch(args);
        break;
      case "knowledge_read":
        result = await handleKnowledgeRead(args);
        break;
      case "knowledge_write":
        result = await handleKnowledgeWrite(args);
        break;
      case "project_create":
        result = await handleProjectCreate(args);
        break;
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    const content =
      typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content, null, 2);

    return {
      content: [{ type: "text", text: content }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("HEORAgent MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
