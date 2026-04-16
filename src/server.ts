#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __pkgDir = dirname(fileURLToPath(import.meta.url));
const PKG_VERSION = JSON.parse(
  readFileSync(join(__pkgDir, "..", "package.json"), "utf-8"),
).version as string;

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
import {
  handleEvidenceNetwork,
  evidenceNetworkToolSchema,
} from "./tools/evidenceNetwork.js";
import {
  handleIndirectComparison,
  indirectComparisonToolSchema,
} from "./tools/indirectComparison.js";
import {
  handleBudgetImpactModel,
  budgetImpactModelToolSchema,
} from "./tools/budgetImpactModel.js";
import {
  handlePopulationAdjustedComparison,
  populationAdjustedComparisonToolSchema,
} from "./tools/populationAdjustedComparison.js";
import {
  handleSurvivalFitting,
  survivalFittingToolSchema,
} from "./tools/survivalFitting.js";
import {
  handleScreenAbstracts,
  screenAbstractsToolSchema,
} from "./tools/screenAbstracts.js";
import {
  handleValidateLinks,
  validateLinksToolSchema,
} from "./tools/validateLinks.js";
import { randomUUID } from "node:crypto";
import { trackToolCall, trackSession, shutdownAnalytics } from "./analytics.js";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

function createMcpServer(): Server {
  const server = new Server(
    { name: "heor-agent-mcp", version: PKG_VERSION },
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
      evidenceNetworkToolSchema,
      indirectComparisonToolSchema,
      budgetImpactModelToolSchema,
      populationAdjustedComparisonToolSchema,
      survivalFittingToolSchema,
      screenAbstractsToolSchema,
      validateLinksToolSchema,
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const callStart = Date.now();

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
        case "evidence_network":
          result = await handleEvidenceNetwork(args);
          break;
        case "indirect_comparison":
          result = await handleIndirectComparison(args);
          break;
        case "budget_impact_model":
          result = await handleBudgetImpactModel(args);
          break;
        case "population_adjusted_comparison":
          result = await handlePopulationAdjustedComparison(args);
          break;
        case "survival_fitting":
          result = await handleSurvivalFitting(args);
          break;
        case "screen_abstracts":
          result = await handleScreenAbstracts(args);
          break;
        case "validate_links":
          result = await handleValidateLinks(args);
          break;
        default:
          trackToolCall(name, Date.now() - callStart, "error");
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }

      trackToolCall(name, Date.now() - callStart, "ok");

      const content =
        typeof result.content === "string"
          ? result.content
          : JSON.stringify(result.content, null, 2);

      return {
        content: [{ type: "text", text: content }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trackToolCall(name, Date.now() - callStart, "error", undefined, {
        error: message,
      });
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

// --- Session management with TTL and limits ---

const MAX_SESSIONS = parseInt(process.env.MCP_MAX_SESSIONS ?? "100", 10);
const SESSION_TTL_MS = parseInt(
  process.env.MCP_SESSION_TTL_MS ?? String(30 * 60 * 1000),
  10,
); // 30 min default

interface ManagedSession {
  transport: StreamableHTTPServerTransport;
  lastActivity: number;
}

const sessions: Record<string, ManagedSession> = {};

function evictStaleSessions(): void {
  const now = Date.now();
  for (const [id, session] of Object.entries(sessions)) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      session.transport.close?.();
      delete sessions[id];
      trackSession("session_end", id, { reason: "ttl_eviction" });
    }
  }
}

// Periodic eviction every 5 minutes
const evictionInterval = setInterval(evictStaleSessions, 5 * 60 * 1000);
evictionInterval.unref(); // don't prevent process exit

async function runHttp(port: number) {
  const __dirname = dirname(fileURLToPath(import.meta.url));

  // Allowed CORS origins (comma-separated env var, or "*" for dev)
  const allowedOrigins = (process.env.MCP_CORS_ORIGINS ?? "*")
    .split(",")
    .map((s) => s.trim());

  // Optional bearer token for authentication
  const authToken = process.env.MCP_AUTH_TOKEN;

  const httpServer = createServer(async (req, res) => {
    // CORS headers — restrict to allowed origins
    const origin = req.headers.origin ?? "";
    const corsOrigin = allowedOrigins.includes("*")
      ? "*"
      : allowedOrigins.includes(origin)
        ? origin
        : "";
    if (corsOrigin) {
      res.setHeader("Access-Control-Allow-Origin", corsOrigin);
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, mcp-session-id, Authorization",
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
        JSON.stringify({
          status: "ok",
          server: "heor-agent-mcp",
          version: PKG_VERSION,
        }),
      );
      return;
    }

    // MCP endpoint
    if (req.url === "/mcp") {
      // Auth check (if MCP_AUTH_TOKEN is set)
      if (authToken) {
        const authHeader = req.headers.authorization ?? "";
        if (authHeader !== `Bearer ${authToken}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
      }

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
          sessions[sessionId].lastActivity = Date.now();
          transport = sessions[sessionId].transport;
        } else if (!sessionId && body?.method === "initialize") {
          // Enforce session limit
          evictStaleSessions();
          if (Object.keys(sessions).length >= MAX_SESSIONS) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Too many active sessions. Try again later.",
              }),
            );
            return;
          }

          // New session
          const server = createMcpServer();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              sessions[id] = { transport, lastActivity: Date.now() };
              trackSession("session_start", id);
            },
          });
          transport.onclose = () => {
            const id = Object.entries(sessions).find(
              ([, s]) => s.transport === transport,
            )?.[0];
            if (id) {
              trackSession("session_end", id);
              delete sessions[id];
            }
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
        sessions[sessionId].lastActivity = Date.now();
        await sessions[sessionId].transport.handleRequest(req, res);
        return;
      }

      if (req.method === "DELETE") {
        if (sessionId && sessions[sessionId]) {
          await sessions[sessionId].transport.close();
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

process.on("SIGTERM", async () => {
  await shutdownAnalytics();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await shutdownAnalytics();
  process.exit(0);
});
