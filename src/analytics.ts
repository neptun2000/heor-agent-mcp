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
