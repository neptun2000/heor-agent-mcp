/**
 * Reddit fetcher for rwe.social_collect (design log #45).
 *
 * OAuth2 application-only (client_credentials) auth → public search → normalized,
 * pseudonymized CollectedPost[]. Deterministic, no NLP. Graceful degradation when
 * credentials are absent. All HTTP via global fetch (mocked in CI).
 */
import { createHash } from "node:crypto";
import type {
  CollectedPost,
  SocialCollectInput,
  SocialCollectResult,
} from "../../social/types.js";

const USER_AGENT =
  process.env.REDDIT_USER_AGENT ??
  "heor-agent-mcp/1.0 (social-listening; +https://github.com/neptun2000/heor-agent-mcp)";

/** Truncated SHA-256 of a handle. Deterministic + irreversible. */
export function pseudonymizeAuthor(username: string): string {
  return createHash("sha256").update(username).digest("hex").slice(0, 12);
}

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
let cachedToken: { token: string; expiresAt: number } | null = null;

/** Test-only: clear the module-level token cache. */
export function _resetRedditTokenCache(): void {
  cachedToken = null;
}

/** App-only OAuth token. Returns null when creds are missing or the exchange fails. */
export async function getRedditToken(now = Date.now()): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (cachedToken && cachedToken.expiresAt > now + 5000)
    return cachedToken.token;

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  let res: { ok: boolean; json: () => Promise<unknown> };
  try {
    res = (await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: "grant_type=client_credentials",
    })) as unknown as { ok: boolean; json: () => Promise<unknown> };
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) return null;
  cachedToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}
