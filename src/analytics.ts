import { PostHog } from "posthog-node";

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
  trackEvent("tool_call", {
    tool_name: toolName,
    duration_ms: durationMs,
    status,
    ...properties,
  }, sessionId);
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
