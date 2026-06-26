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
  let data: { access_token?: string; expires_in?: number };
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) return null;
    data = (await res.json()) as { access_token?: string; expires_in?: number };
  } catch {
    return null;
  }
  if (!data.access_token) return null;
  cachedToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

interface RedditChild {
  data?: {
    name?: string;
    permalink?: string;
    subreddit?: string;
    author?: string;
    created_utc?: number;
    title?: string;
    selftext?: string;
    score?: number;
    num_comments?: number;
  };
}
interface RedditListing {
  data?: { children?: RedditChild[] };
}

const GVP_VI_NOTE =
  "Systematic digital-media review triggers EMA GVP Module VI AE handling — " +
  "route posts with adverse events through pv.social_listening_triage.";

function quote(term: string): string {
  return `"${term.replace(/"/g, "")}"`;
}

/** Build a Reddit search query: (drug OR brands) [AND (kw OR kw)]. */
export function buildRedditQuery(input: SocialCollectInput): string {
  const drugTerms = [input.drug, ...input.brand_names]
    .map((t) => t.trim())
    .filter(Boolean);
  const drugClause =
    drugTerms.length > 1
      ? `(${drugTerms.map(quote).join(" OR ")})`
      : quote(drugTerms[0] ?? input.drug);
  const parts = [drugClause];
  const kws = input.keywords.map((k) => k.trim()).filter(Boolean);
  if (kws.length) parts.push(`(${kws.map(quote).join(" OR ")})`);
  return parts.join(" ");
}

/** Pull public Reddit posts. Deterministic, pseudonymized, degrades on missing creds. */
export async function collectRedditPosts(
  input: SocialCollectInput,
  now = Date.now(),
): Promise<SocialCollectResult> {
  const query_used = buildRedditQuery(input);
  const result: SocialCollectResult = {
    drug: input.drug,
    indication: input.indication,
    platform: "reddit",
    query_used,
    fetched_at: new Date(now).toISOString(),
    total_collected: 0,
    posts: [],
    governance: {
      public_data_only: true,
      pseudonymized: true,
      persisted: false,
      gvp_module_vi: GVP_VI_NOTE,
    },
    warnings: [],
  };

  const token = await getRedditToken(now);
  if (!token) {
    result.warnings.push(
      "Reddit collection unavailable: set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET " +
        "(free app at reddit.com/prefs/apps).",
    );
    return result;
  }

  const targets: (string | null)[] = input.subreddits.length
    ? input.subreddits
    : [null];
  const seen = new Set<string>();
  for (const sub of targets) {
    if (result.posts.length >= input.max_posts) break;
    const url = new URL(
      sub
        ? `https://oauth.reddit.com/r/${encodeURIComponent(sub)}/search`
        : "https://oauth.reddit.com/search",
    );
    url.searchParams.set("q", query_used);
    url.searchParams.set("sort", input.sort);
    url.searchParams.set("t", input.time_window);
    url.searchParams.set("limit", String(Math.min(input.max_posts, 100)));
    url.searchParams.set("type", "link");
    if (sub) url.searchParams.set("restrict_sr", "true");

    let res: { ok: boolean; status?: number; json: () => Promise<unknown> };
    try {
      res = (await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT },
      })) as unknown as {
        ok: boolean;
        status?: number;
        json: () => Promise<unknown>;
      };
    } catch {
      result.warnings.push(
        `Reddit search failed for ${sub ?? "site-wide"} (network error).`,
      );
      continue;
    }
    if (!res.ok) {
      result.warnings.push(
        `Reddit search returned ${res.status ?? "error"} for ${sub ?? "site-wide"}.`,
      );
      continue;
    }
    let data: RedditListing;
    try {
      data = (await res.json()) as RedditListing;
    } catch {
      result.warnings.push(
        `Reddit response for ${sub ?? "site-wide"} was not valid JSON.`,
      );
      continue;
    }
    for (const child of data?.data?.children ?? []) {
      const d = child.data;
      if (!d?.name || seen.has(d.name)) continue;
      seen.add(d.name);
      result.posts.push({
        id: d.name,
        source_url: `https://www.reddit.com${d.permalink ?? ""}`,
        subreddit: d.subreddit ?? sub ?? "",
        author_pseudonym: pseudonymizeAuthor(d.author ?? "[deleted]"),
        created_at: new Date((d.created_utc ?? 0) * 1000).toISOString(),
        title: d.title ?? "",
        body: d.selftext ?? "",
        score: d.score ?? 0,
        num_comments: d.num_comments ?? 0,
      });
      if (result.posts.length >= input.max_posts) break;
    }
  }
  result.total_collected = result.posts.length;
  return result;
}
