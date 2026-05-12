import { PostHog } from "posthog-node";

/**
 * Map MCP `clientInfo.name` (set by the calling client during initialize)
 * to a canonical surface label so PostHog can distinguish events from
 * Claude Desktop, the Vercel web UI, the ChatGPT Custom GPT adapter, etc.
 *
 * Returns "direct_mcp" for unknown / npx / third-party clients.
 */
export type ClientSurface =
  | "claude_anthropic_web"
  | "chatgpt_adapter"
  | "claude_desktop"
  | "smithery"
  | "glama"
  | "pulsemcp"
  | "direct_mcp";

export function inferSurface(clientName: string | undefined): ClientSurface {
  if (!clientName) return "direct_mcp";
  const n = clientName.toLowerCase();
  if (n.startsWith("heor-web-ui")) return "claude_anthropic_web";
  if (n.startsWith("chatgpt-adapter")) return "chatgpt_adapter";
  if (
    n === "claude" ||
    n.startsWith("claude-ai") ||
    n.startsWith("claude-desktop")
  )
    return "claude_desktop";
  if (n.startsWith("smithery")) return "smithery";
  if (n.startsWith("glama")) return "glama";
  if (n.startsWith("pulsemcp")) return "pulsemcp";
  return "direct_mcp";
}

let client: PostHog | null = null;

function getClient(): PostHog | null {
  if (client) return client;
  const key = process.env.POSTHOG_API_KEY;
  if (!key) return null;
  client = new PostHog(key, {
    host: "https://us.i.posthog.com",
    flushAt: 5,
    flushInterval: 10000,
  });
  return client;
}

export function trackEvent(
  event: string,
  properties: Record<string, unknown> = {},
  sessionId?: string,
) {
  const ph = getClient();
  if (!ph) return;

  ph.capture({
    distinctId: sessionId ?? "anonymous",
    event,
    properties: {
      server_version: process.env.npm_package_version ?? "unknown",
      ...properties,
    },
  });
}

/**
 * Extracts structured analytics properties from a thrown value.
 *
 * Returns THREE fields so callers can pick the right one for each surface:
 *   - `error_class`     — constructor/category name, stable for dashboards
 *   - `error_message`   — FULL message, no truncation. Use this for the
 *                         client-facing response so callers (including the
 *                         ChatGPT Custom GPT) see the complete validation
 *                         feedback and can recover in-conversation.
 *   - `telemetry_message` — same message capped at 500 chars. Use this for
 *                         PostHog `properties.error_message` so we don't
 *                         blow up event payload size on a 50KB ZodError.
 *
 * Why we split these (added v1.10.2): pre-v1.10.2 the capped field doubled
 * as the client response (server.ts:475), so ChatGPT received a JSON
 * ZodError truncated mid-key and could not recover. The 500-char cap was
 * a telemetry-hygiene decision that quietly broke the response surface.
 *
 * - Error subclasses → constructor name + full message
 * - Strings / numbers / null → class="unknown", message=stringified
 * - Circular objects / weird values → class="unknown", message=safe stringify
 */
export function classifyToolError(err: unknown): {
  error_class: string;
  error_message: string;
  telemetry_message: string;
} {
  if (err instanceof Error) {
    const full = err.message ?? "";
    return {
      error_class: err.constructor?.name ?? "Error",
      error_message: full,
      telemetry_message: full.slice(0, 500),
    };
  }
  let message: string;
  try {
    message = err === null ? "null" : String(err);
  } catch {
    message = "(unstringifiable)";
  }
  return {
    error_class: "unknown",
    error_message: message,
    telemetry_message: message.slice(0, 500),
  };
}

export function trackToolCall(
  toolName: string,
  durationMs: number,
  status: "ok" | "error",
  sessionId?: string,
  properties: Record<string, unknown> = {},
) {
  trackEvent(
    "tool_call",
    {
      tool_name: toolName,
      duration_ms: durationMs,
      status,
      ...properties,
    },
    sessionId,
  );
}

export function trackSession(
  event: "session_start" | "session_end",
  sessionId: string,
  properties: Record<string, unknown> = {},
) {
  trackEvent(event, properties, sessionId);
}

export async function shutdownAnalytics() {
  if (client) {
    await client.shutdown();
    client = null;
  }
}
