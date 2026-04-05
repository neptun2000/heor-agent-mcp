import type { LiteratureResult } from "../types.js";

/**
 * Validate that a proxy URL is safe to use (localhost only).
 * Returns validated URL or null if invalid.
 * Logs a warning to stderr if an invalid URL was provided.
 */
export function validateProxyUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    console.error(
      `[HEOR] Invalid HEOR_PROXY_URL (not a valid URL): ${rawUrl}. Proxy disabled.`,
    );
    return null;
  }

  // Must be http (localhost doesn't need https)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    console.error(
      `[HEOR] HEOR_PROXY_URL must use http:// or https://, got ${parsed.protocol}. Proxy disabled.`,
    );
    return null;
  }

  // MUST be localhost — reject anything else to prevent query exfiltration
  const hostname = parsed.hostname.toLowerCase();
  const allowedHosts = ["localhost", "127.0.0.1", "::1", "[::1]"];
  if (!allowedHosts.includes(hostname)) {
    console.error(
      `[HEOR] SECURITY: HEOR_PROXY_URL must be localhost/127.0.0.1 only. ` +
        `Got: ${hostname}. Proxy disabled to prevent query exfiltration. ` +
        `If you need a remote proxy, wrap it with an SSH tunnel to localhost.`,
    );
    return null;
  }

  // Strip trailing slash for consistent URL building
  return rawUrl.replace(/\/+$/, "");
}

export function getProxyUrl(): string | null {
  return validateProxyUrl(process.env.HEOR_PROXY_URL);
}

/**
 * Fetch literature results through the local proxy.
 * Expected proxy endpoint: {PROXY_URL}/{source}?query=X&max=N
 * Expected proxy response: { results: LiteratureResult[] } OR LiteratureResult[]
 */
export async function fetchViaProxy(
  source: string,
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return [];

  try {
    const url = `${proxyUrl}/${source}?query=${encodeURIComponent(query)}&max=${maxResults}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      // Short timeout — local proxy should be fast
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;

    // Accept both formats: { results: [...] } or [...]
    const results = Array.isArray(data)
      ? data
      : (data as Record<string, unknown>).results;
    if (!Array.isArray(results)) return [];

    // Basic validation of each result
    return results.filter((r: unknown): r is LiteratureResult => {
      if (typeof r !== "object" || r === null) return false;
      const obj = r as Record<string, unknown>;
      return (
        typeof obj.id === "string" &&
        typeof obj.title === "string" &&
        typeof obj.source === "string"
      );
    });
  } catch {
    return [];
  }
}
