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
  process.env.REDDIT_USER_AGENT ?? "heor-agent-mcp/1.0 (social-listening; +https://github.com/neptun2000/heor-agent-mcp)";

/** Truncated SHA-256 of a handle. Deterministic + irreversible. */
export function pseudonymizeAuthor(username: string): string {
  return createHash("sha256").update(username).digest("hex").slice(0, 12);
}
