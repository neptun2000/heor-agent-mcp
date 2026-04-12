#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function createMcpServer(): Server {
  const server = new Server(
    { name: "heor-agent-mcp", version: "0.1.3" },
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

  return server;
}

// --- Stdio mode (default) ---

async function runStdio() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("HEORAgent MCP server running on stdio");
}

// --- HTTP mode (--http flag or MCP_HTTP_PORT env) ---

async function runHttp(port: number) {
  const sessions: Record<string, StreamableHTTPServerTransport> = {};

  const __dirname = dirname(fileURLToPath(import.meta.url));

  const httpServer = createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, mcp-session-id",
    );
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Serve server-card.json for Smithery discovery
    if (
      req.method === "GET" &&
      req.url === "/.well-known/mcp/server-card.json"
    ) {
      try {
        const cardPath = join(
          __dirname,
          "..",
          ".well-known",
          "mcp",
          "server-card.json",
        );
        const card = await readFile(cardPath, "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(card);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }

    // Health check
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ status: "ok", server: "heor-agent-mcp", version: "0.1.3" }),
      );
      return;
    }

    // MCP endpoint
    if (req.url === "/mcp") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (req.method === "POST") {
        // Parse body
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString());

        let transport: StreamableHTTPServerTransport;

        if (sessionId && sessions[sessionId]) {
          transport = sessions[sessionId];
        } else if (!sessionId && body?.method === "initialize") {
          // New session
          const server = createMcpServer();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              sessions[id] = transport;
            },
          });
          transport.onclose = () => {
            const id = Object.entries(sessions).find(
              ([, t]) => t === transport,
            )?.[0];
            if (id) delete sessions[id];
          };
          await server.connect(transport);
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid or missing session" }));
          return;
        }

        await transport.handleRequest(req, res, body);
        return;
      }

      if (req.method === "GET") {
        if (!sessionId || !sessions[sessionId]) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid session" }));
          return;
        }
        await sessions[sessionId].handleRequest(req, res);
        return;
      }

      if (req.method === "DELETE") {
        if (sessionId && sessions[sessionId]) {
          await sessions[sessionId].close();
          delete sessions[sessionId];
        }
        res.writeHead(200);
        res.end();
        return;
      }
    }

    res.writeHead(404);
    res.end("Not found");
  });

  httpServer.listen(port, "0.0.0.0", () => {
    console.error(`HEORAgent MCP server running on HTTP port ${port}`);
    console.error(`  MCP endpoint: http://localhost:${port}/mcp`);
    console.error(`  Health check: http://localhost:${port}/health`);
    console.error(
      `  Server card:  http://localhost:${port}/.well-known/mcp/server-card.json`,
    );
  });
}

// --- Entrypoint ---

async function main() {
  const args = process.argv.slice(2);
  const httpFlag = args.includes("--http");
  const portEnv = process.env.MCP_HTTP_PORT;

  if (httpFlag || portEnv) {
    const port = parseInt(portEnv || "8787", 10);
    await runHttp(port);
  } else {
    await runStdio();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
