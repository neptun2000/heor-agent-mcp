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
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
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
import { handleRiskOfBias, riskOfBiasToolSchema } from "./tools/riskOfBias.js";
import {
  handleValidateLinks,
  validateLinksToolSchema,
} from "./tools/validateLinks.js";
import {
  handleUtilityValueSet,
  utilityValueSetToolSchema,
} from "./tools/utilityValueSet.js";
import {
  handleItcFeasibility,
  itcFeasibilityToolSchema,
} from "./tools/itcFeasibility.js";
import { handleExamples, examplesToolSchema } from "./tools/examples.js";
import {
  handleMaicWorkflow,
  maicWorkflowToolSchema,
} from "./tools/maicWorkflow.js";
import { randomUUID } from "node:crypto";
import {
  trackToolCall,
  trackSession,
  shutdownAnalytics,
  inferSurface,
} from "./analytics.js";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

// Pre-built HEOR workflow prompts for Claude Desktop slash-command discovery
const HEOR_PROMPTS = [
  {
    name: "literature-review",
    description:
      "Systematic literature review with PRISMA audit trail — runs literature.search across 41 sources then screens by PICO criteria.",
    arguments: [
      {
        name: "drug",
        description: "Drug or intervention name",
        required: true,
      },
      { name: "indication", description: "Disease/condition", required: true },
    ],
  },
  {
    name: "cost-effectiveness-analysis",
    description:
      "Full cost-effectiveness analysis: Markov/PartSA model with PSA, OWSA, CEAC, EVPI, EVPPI, and scenario analysis.",
    arguments: [
      { name: "intervention", description: "Drug name", required: true },
      { name: "comparator", description: "Standard of care", required: true },
      { name: "indication", description: "Disease/condition", required: true },
      {
        name: "perspective",
        description: "nhs, us_payer, or societal",
        required: true,
      },
    ],
  },
  {
    name: "hta-dossier",
    description:
      "Generate a complete HTA submission dossier (NICE, EMA, FDA, IQWiG, HAS, EU JCA, or Global Value Dossier) with auto-GRADE evidence quality assessment.",
    arguments: [
      {
        name: "hta_body",
        description: "nice, ema, fda, iqwig, has, jca, or gvd",
        required: true,
      },
      { name: "drug", description: "Drug name", required: true },
      { name: "indication", description: "Disease/condition", required: true },
    ],
  },
  {
    name: "budget-impact",
    description:
      "5-year budget impact analysis with Excel export for localization by market-access teams.",
    arguments: [
      { name: "intervention", description: "Drug name", required: true },
      {
        name: "population",
        description: "Eligible population size",
        required: true,
      },
      {
        name: "perspective",
        description: "nhs, us_payer, or societal",
        required: true,
      },
    ],
  },
  {
    name: "indirect-comparison",
    description:
      "Indirect treatment comparison using Bucher method, Frequentist NMA, or MAIC/STC (population-adjusted).",
    arguments: [
      { name: "intervention", description: "Treatment A", required: true },
      { name: "comparator", description: "Treatment B", required: true },
    ],
  },
];

function createMcpServer(
  surfaceRef: { value: string } = { value: "direct_mcp" },
  sessionIdRef: { value: string } = { value: "" },
): Server {
  const server = new Server(
    { name: "heor-agent-mcp", version: PKG_VERSION },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  // Empty resources list (required by MCP spec for capability declaration)
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [],
  }));

  // List pre-built HEOR workflow prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: HEOR_PROMPTS,
  }));

  // Return a prompt when requested
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = HEOR_PROMPTS.find((p) => p.name === request.params.name);
    if (!prompt) {
      throw new Error(`Prompt not found: ${request.params.name}`);
    }
    const args = request.params.arguments ?? {};
    const argList = Object.entries(args)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");

    return {
      description: prompt.description,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Run a ${prompt.name.replace(/-/g, " ")} workflow using the HEOR Agent tools. Parameters: ${argList}`,
          },
        },
      ],
    };
  });

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
      riskOfBiasToolSchema,
      validateLinksToolSchema,
      utilityValueSetToolSchema,
      itcFeasibilityToolSchema,
      examplesToolSchema,
      maicWorkflowToolSchema,
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const callStart = Date.now();

    try {
      let result;
      switch (name) {
        case "literature.search":
          result = await handleLiteratureSearch(args);
          break;
        case "models.cost_effectiveness":
          result = await handleCostEffectivenessModel(args);
          break;
        case "hta.dossier":
          result = await handleHtaDossierPrep(args);
          break;
        case "knowledge.search":
          result = await handleKnowledgeSearch(args);
          break;
        case "knowledge.read":
          result = await handleKnowledgeRead(args);
          break;
        case "knowledge.write":
          result = await handleKnowledgeWrite(args);
          break;
        case "project.create":
          result = await handleProjectCreate(args);
          break;
        case "evidence.network":
          result = await handleEvidenceNetwork(args);
          break;
        case "evidence.indirect":
          result = await handleIndirectComparison(args);
          break;
        case "models.budget_impact":
          result = await handleBudgetImpactModel(args);
          break;
        case "evidence.population_adjusted":
          result = await handlePopulationAdjustedComparison(args);
          break;
        case "evidence.survival":
          result = await handleSurvivalFitting(args);
          break;
        case "literature.screen":
          result = await handleScreenAbstracts(args);
          break;
        case "evidence.risk_of_bias":
          result = await handleRiskOfBias(args);
          break;
        case "utils.validate_links":
          result = await handleValidateLinks(args);
          break;
        case "hta.utility":
          result = await handleUtilityValueSet(args);
          break;
        case "evidence.itc":
          result = await handleItcFeasibility(args);
          break;
        case "examples":
          result = await handleExamples(args);
          break;
        case "workflow.maic":
          result = await handleMaicWorkflow(args);
          break;
        default:
          trackToolCall(
            name,
            Date.now() - callStart,
            "error",
            sessionIdRef.value || undefined,
            {
              surface: surfaceRef.value,
              error_class: "unknown_tool",
            },
          );
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }

      trackToolCall(
        name,
        Date.now() - callStart,
        "ok",
        sessionIdRef.value || undefined,
        { surface: surfaceRef.value },
      );

      const content =
        typeof result.content === "string"
          ? result.content
          : JSON.stringify(result.content, null, 2);

      return {
        content: [{ type: "text", text: content }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trackToolCall(
        name,
        Date.now() - callStart,
        "error",
        sessionIdRef.value || undefined,
        {
          surface: surfaceRef.value,
          error: message,
        },
      );
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

const MAX_SESSIONS = Math.max(
  1,
  parseInt(process.env.MCP_MAX_SESSIONS ?? "100", 10) || 100,
);
const SESSION_TTL_MS = Math.max(
  60_000,
  parseInt(process.env.MCP_SESSION_TTL_MS ?? String(30 * 60 * 1000), 10) ||
    1_800_000,
); // 30 min default, minimum 60s

const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ManagedSession {
  transport: StreamableHTTPServerTransport;
  surface?: string;
  lastActivity: number;
}

const sessions = new Map<string, ManagedSession>();

function evictStaleSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      session.transport.close?.();
      sessions.delete(id);
      trackSession("session_end", id, {
        reason: "ttl_eviction",
        surface: session.surface ?? "unknown",
      });
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

      const rawSessionId = req.headers["mcp-session-id"] as string | undefined;
      const sessionId =
        rawSessionId && SESSION_ID_RE.test(rawSessionId)
          ? rawSessionId
          : undefined;
      if (rawSessionId && !sessionId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid session ID format" }));
        return;
      }

      if (req.method === "POST") {
        // Parse body with size limit
        const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        for await (const chunk of req) {
          const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          totalBytes += buf.length;
          if (totalBytes > MAX_BODY_BYTES) {
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Request body too large" }));
            req.destroy();
            return;
          }
          chunks.push(buf);
        }

        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString());
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Invalid JSON in request body",
              detail: err instanceof Error ? err.message : String(err),
            }),
          );
          return;
        }

        let transport: StreamableHTTPServerTransport;

        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId)!;
          session.lastActivity = Date.now();
          transport = session.transport;
        } else if (!sessionId && body?.method === "initialize") {
          // Enforce session limit
          evictStaleSessions();
          if (sessions.size >= MAX_SESSIONS) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Too many active sessions. Try again later.",
              }),
            );
            return;
          }

          // New session — capture clientInfo.name from initialize body so
          // every subsequent tool_call event can be tagged with surface
          // (claude_anthropic_web / chatgpt_adapter / claude_desktop / etc.)
          const clientName = body?.params?.clientInfo?.name as
            | string
            | undefined;
          const surface = inferSurface(clientName);
          const surfaceRef = { value: surface };
          // Session ID ref — populated by onsessioninitialized below, read by
          // tool_call telemetry so each event is attributed to the right user.
          // Without this, all tool_call events distinct_id="anonymous" and
          // per-user analytics are blind.
          const sessionIdRef = { value: "" };
          const server = createMcpServer(surfaceRef, sessionIdRef);
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              sessions.set(id, {
                transport,
                lastActivity: Date.now(),
                surface,
              });
              sessionIdRef.value = id;
              trackSession("session_start", id, {
                surface,
                client_name: clientName ?? "unknown",
              });
            },
          });
          transport.onclose = () => {
            for (const [id, s] of sessions) {
              if (s.transport === transport) {
                trackSession("session_end", id, { surface });
                sessions.delete(id);
                break;
              }
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
        if (!sessionId || !sessions.has(sessionId)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid session" }));
          return;
        }
        const session = sessions.get(sessionId)!;
        session.lastActivity = Date.now();
        await session.transport.handleRequest(req, res);
        return;
      }

      if (req.method === "DELETE") {
        if (sessionId && sessions.has(sessionId)) {
          await sessions.get(sessionId)!.transport.close();
          sessions.delete(sessionId);
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
