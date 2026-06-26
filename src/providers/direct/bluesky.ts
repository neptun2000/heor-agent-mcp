/**
 * Bluesky (AT Protocol) fetcher for rwe.social_collect (design log #45 Part 2).
 * App-password createSession → app.bsky.feed.searchPosts → normalized, pseudonymized
 * CollectedPost[]. Deterministic, no NLP, graceful degradation. All HTTP via global fetch.
 */
import { pseudonymizeAuthor } from "../../social/pseudonymize.js";
import type {
  CollectedPost,
  SocialCollectInput,
  SocialCollectResult,
} from "../../social/types.js";

const PDS = "https://bsky.social";
let cachedSession: { token: string; expiresAt: number } | null = null;

export function _resetBlueskySessionCache(): void {
  cachedSession = null;
}

export async function getBlueskySession(
  now = Date.now()
): Promise<string | null> {
  const identifier = process.env.BLUESKY_IDENTIFIER;
  const password = process.env.BLUESKY_APP_PASSWORD;
  if (!identifier || !password) return null;
  if (cachedSession && cachedSession.expiresAt > now + 60000)
    return cachedSession.token;
  let data: { accessJwt?: string };
  try {
    const res = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    if (!res.ok) return null;
    data = (await res.json()) as { accessJwt?: string };
  } catch {
    return null;
  }
  if (!data.accessJwt) return null;
  cachedSession = { token: data.accessJwt, expiresAt: now + 100 * 60 * 1000 }; // ~100min (tokens last ~2h)
  return cachedSession.token;
}
