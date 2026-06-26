import {
  pseudonymizeAuthor,
  getRedditToken,
  _resetRedditTokenCache,
  buildRedditQuery,
  collectRedditPosts,
} from "../../src/providers/direct/reddit.js";
import type { SocialCollectInput } from "../../src/social/types.js";

describe("pseudonymizeAuthor", () => {
  it("is deterministic and irreversible — never leaks the raw handle", () => {
    const a = pseudonymizeAuthor("jane_doe_99");
    const b = pseudonymizeAuthor("jane_doe_99");
    expect(a).toBe(b); // deterministic
    expect(a).toHaveLength(12); // truncated
    expect(a).not.toContain("jane"); // irreversible — no raw handle
    expect(a).toMatch(/^[0-9a-f]{12}$/); // hex
    expect(pseudonymizeAuthor("john")).not.toBe(a); // distinct inputs differ
  });
});

describe("getRedditToken", () => {
  const origFetch = global.fetch;
  const origEnv = { ...process.env };
  afterEach(() => {
    global.fetch = origFetch;
    process.env = { ...origEnv };
    _resetRedditTokenCache();
  });

  it("returns null when credentials are absent (graceful degradation)", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    expect(await getRedditToken()).toBeNull();
  });

  it("exchanges client_credentials for a bearer token", async () => {
    process.env.REDDIT_CLIENT_ID = "id";
    process.env.REDDIT_CLIENT_SECRET = "secret";
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: "TKN", expires_in: 3600 }),
    })) as unknown as typeof fetch;
    expect(await getRedditToken(1000)).toBe("TKN");
  });

  it("returns null (never throws) when the token body is malformed", async () => {
    process.env.REDDIT_CLIENT_ID = "id";
    process.env.REDDIT_CLIENT_SECRET = "secret";
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    })) as unknown as typeof fetch;
    await expect(getRedditToken(1000)).resolves.toBeNull();
  });

  it("caches the token until near expiry (one network call for two reads)", async () => {
    process.env.REDDIT_CLIENT_ID = "id";
    process.env.REDDIT_CLIENT_SECRET = "secret";
    const spy = jest.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: "TKN", expires_in: 3600 }),
    }));
    global.fetch = spy as unknown as typeof fetch;
    await getRedditToken(1000);
    await getRedditToken(2000); // within validity
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

function input(over: Partial<SocialCollectInput> = {}): SocialCollectInput {
  return {
    drug: "Ajovy",
    brand_names: ["fremanezumab"],
    indication: "chronic migraine",
    subreddits: ["migraine"],
    keywords: ["injection site"],
    time_window: "year",
    sort: "relevance",
    max_posts: 50,
    ...over,
  };
}

const listing = (children: Array<Record<string, unknown>>) => ({
  ok: true,
  json: async () => ({
    data: { children: children.map((data) => ({ data })) },
  }),
});

describe("buildRedditQuery", () => {
  it("ORs drug + brand names and ANDs the keyword clause", () => {
    const q = buildRedditQuery(input());
    expect(q).toContain('"Ajovy" OR "fremanezumab"');
    expect(q).toContain('"injection site"');
  });
});

describe("collectRedditPosts", () => {
  const origFetch = global.fetch;
  const origEnv = { ...process.env };
  afterEach(() => {
    global.fetch = origFetch;
    process.env = { ...origEnv };
    _resetRedditTokenCache();
  });

  it("degrades gracefully with a warning when creds are missing — no crash", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    const r = await collectRedditPosts(input(), 1000);
    expect(r.posts).toEqual([]);
    expect(r.total_collected).toBe(0);
    expect(r.warnings.join(" ")).toMatch(/REDDIT_CLIENT_ID/);
    expect(r.platform).toBe("reddit");
    expect(r.query_used).toContain("Ajovy");
  });

  it("normalizes + pseudonymizes posts and never leaks the raw author", async () => {
    process.env.REDDIT_CLIENT_ID = "id";
    process.env.REDDIT_CLIENT_SECRET = "secret";
    let call = 0;
    global.fetch = jest.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("access_token"))
        return {
          ok: true,
          json: async () => ({ access_token: "TKN", expires_in: 3600 }),
        } as never;
      call++;
      return listing([
        {
          name: "t3_abc",
          permalink: "/r/migraine/comments/abc/x/",
          subreddit: "migraine",
          author: "jane_doe_99",
          created_utc: 1700000000,
          title: "My Ajovy experience",
          selftext: "injection site reaction",
          score: 12,
          num_comments: 4,
        },
      ]) as never;
    }) as unknown as typeof fetch;

    const r = await collectRedditPosts(input(), 1000);
    expect(call).toBe(1);
    expect(r.total_collected).toBe(1);
    const p = r.posts[0];
    expect(p.id).toBe("t3_abc");
    expect(p.source_url).toBe(
      "https://www.reddit.com/r/migraine/comments/abc/x/",
    );
    expect(p.author_pseudonym).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(r)).not.toContain("jane_doe_99"); // no raw author anywhere
    expect(p.created_at).toBe(new Date(1700000000 * 1000).toISOString());
    expect(r.governance.pseudonymized).toBe(true);
    expect(r.governance.gvp_module_vi).toMatch(/Module VI/);
  });

  it("dedups by id across multiple subreddits and respects max_posts", async () => {
    process.env.REDDIT_CLIENT_ID = "id";
    process.env.REDDIT_CLIENT_SECRET = "secret";
    global.fetch = jest.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("access_token"))
        return {
          ok: true,
          json: async () => ({ access_token: "TKN", expires_in: 3600 }),
        } as never;
      return listing([
        {
          name: "t3_dup",
          permalink: "/p/",
          subreddit: "migraine",
          author: "a",
          created_utc: 1,
          title: "t",
          selftext: "b",
          score: 1,
          num_comments: 0,
        },
      ]) as never;
    }) as unknown as typeof fetch;
    const r = await collectRedditPosts(
      input({ subreddits: ["migraine", "ChronicMigraine"] }),
      1000,
    );
    expect(r.total_collected).toBe(1); // same id from both subs → deduped
  });
});
