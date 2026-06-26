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
  now = Date.now(),
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

interface BskyPostView {
  uri?: string;
  cid?: string;
  author?: { did?: string; handle?: string; displayName?: string };
  record?: { text?: string; createdAt?: string };
  likeCount?: number;
  replyCount?: number;
  repostCount?: number;
  indexedAt?: string;
}
interface BskySearchResponse {
  posts?: BskyPostView[];
}

const GVP_VI_NOTE =
  "Systematic digital-media review triggers EMA GVP Module VI AE handling — " +
  "route posts with adverse events through pv.social_listening_triage.";
const WINDOW_DAYS: Record<string, number | null> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
  all: null,
};

function quote(t: string): string {
  return `"${t.replace(/"/g, "")}"`;
}

/** (drug OR brands) [keywords]. Bluesky full-text; space-joined keywords narrow the match. */
export function buildBlueskyQuery(input: SocialCollectInput): string {
  const terms = [input.drug, ...input.brand_names]
    .map((t) => t.trim())
    .filter(Boolean);
  const drugClause =
    terms.length > 1
      ? `(${terms.map(quote).join(" OR ")})`
      : quote(terms[0] ?? input.drug);
  const kws = input.keywords.map((k) => k.trim()).filter(Boolean);
  return [
    drugClause,
    ...(kws.length ? [`(${kws.map(quote).join(" OR ")})`] : []),
  ].join(" ");
}

/** Web permalink from an at:// post uri + author DID. */
function permalink(uri: string, did: string): string {
  const rkey = uri.split("/").pop() ?? "";
  return `https://bsky.app/profile/${did}/post/${rkey}`;
}

export async function collectBlueskyPosts(
  input: SocialCollectInput,
  now = Date.now(),
): Promise<SocialCollectResult> {
  const query_used = buildBlueskyQuery(input);
  const result: SocialCollectResult = {
    drug: input.drug,
    indication: input.indication,
    platform: "bluesky",
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
  const token = await getBlueskySession(now);
  if (!token) {
    result.warnings.push(
      "Bluesky collection unavailable: set BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD " +
        "(app password at Settings → Privacy and Security → App Passwords).",
    );
    return result;
  }
  const url = new URL(`${PDS}/xrpc/app.bsky.feed.searchPosts`);
  url.searchParams.set("q", query_used);
  url.searchParams.set(
    "sort",
    input.sort === "new"
      ? "latest"
      : input.sort === "relevance"
        ? "top"
        : input.sort,
  );
  url.searchParams.set("limit", String(Math.min(input.max_posts, 100)));
  const days = WINDOW_DAYS[input.time_window];
  if (days != null)
    url.searchParams.set(
      "since",
      new Date(now - days * 86400000).toISOString(),
    );

  let res: { ok: boolean; status?: number; json: () => Promise<unknown> };
  try {
    res = (await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })) as never;
  } catch {
    result.warnings.push("Bluesky search failed (network error).");
    return result;
  }
  if (!res.ok) {
    result.warnings.push(`Bluesky search returned ${res.status ?? "error"}.`);
    return result;
  }
  let data: BskySearchResponse;
  try {
    data = (await res.json()) as BskySearchResponse;
  } catch {
    result.warnings.push("Bluesky response was not valid JSON.");
    return result;
  }

  const seen = new Set<string>();
  for (const p of data?.posts ?? []) {
    if (!p?.uri || seen.has(p.uri)) continue;
    seen.add(p.uri);
    const handle = p.author?.handle ?? "";
    const did = p.author?.did ?? "[unknown]";
    result.posts.push({
      id: p.uri,
      source_url: permalink(p.uri, did),
      channel: undefined,
      author_pseudonym: pseudonymizeAuthor(handle || did),
      created_at:
        p.record?.createdAt ?? p.indexedAt ?? new Date(now).toISOString(),
      title: "",
      body: p.record?.text ?? "",
      score: p.likeCount ?? 0,
      num_comments: p.replyCount ?? 0,
    });
    if (result.posts.length >= input.max_posts) break;
  }
  result.total_collected = result.posts.length;
  return result;
}
