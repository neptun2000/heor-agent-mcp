import {
  getBlueskySession,
  _resetBlueskySessionCache,
  buildBlueskyQuery,
  collectBlueskyPosts,
} from "../../src/providers/direct/bluesky.js";
import type { SocialCollectInput } from "../../src/social/types.js";

describe("getBlueskySession", () => {
  const f = global.fetch;
  const e = { ...process.env };

  afterEach(() => {
    global.fetch = f;
    process.env = { ...e };
    _resetBlueskySessionCache();
  });

  it("returns null with no creds", async () => {
    delete process.env.BLUESKY_IDENTIFIER;
    delete process.env.BLUESKY_APP_PASSWORD;
    expect(await getBlueskySession()).toBeNull();
  });

  it("exchanges app password for accessJwt", async () => {
    process.env.BLUESKY_IDENTIFIER = "u.bsky.social";
    process.env.BLUESKY_APP_PASSWORD = "pw";
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ accessJwt: "JWT", did: "did:x", handle: "u" }),
    })) as never;
    expect(await getBlueskySession(1000)).toBe("JWT");
  });

  it("caches the session token", async () => {
    process.env.BLUESKY_IDENTIFIER = "u";
    process.env.BLUESKY_APP_PASSWORD = "pw";
    const spy = jest.fn(async () => ({
      ok: true,
      json: async () => ({ accessJwt: "JWT" }),
    }));
    global.fetch = spy as never;
    await getBlueskySession(1000);
    await getBlueskySession(2000);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("returns null (never throws) on malformed body", async () => {
    process.env.BLUESKY_IDENTIFIER = "u";
    process.env.BLUESKY_APP_PASSWORD = "pw";
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("x");
      },
    })) as never;
    await expect(getBlueskySession(1000)).resolves.toBeNull();
  });
});

describe("buildBlueskyQuery", () => {
  const input = (o: Partial<SocialCollectInput> = {}): SocialCollectInput => ({
    drug: "Ajovy",
    brand_names: ["fremanezumab"],
    indication: "migraine",
    subreddits: [],
    keywords: ["side effect"],
    time_window: "year",
    sort: "top",
    max_posts: 25,
    platform: "bluesky",
    ...o,
  });

  it('contains "(drug OR brands)" and keywords', () => {
    const q = buildBlueskyQuery(input());
    expect(q).toContain("Ajovy");
    expect(q).toContain("fremanezumab");
    expect(q).toMatch(/\(.*OR.*\)/);
    expect(q).toContain("side effect");
  });

  it("quotes terms with spaces", () => {
    const q = buildBlueskyQuery(input({ drug: "drug with spaces" }));
    expect(q).toContain('"drug with spaces"');
  });
});

describe("collectBlueskyPosts", () => {
  const f = global.fetch;
  const e = { ...process.env };

  afterEach(() => {
    global.fetch = f;
    process.env = { ...e };
    _resetBlueskySessionCache();
  });

  const input = (o: Partial<SocialCollectInput> = {}): SocialCollectInput => ({
    drug: "Ajovy",
    brand_names: ["fremanezumab"],
    indication: "migraine",
    subreddits: [],
    keywords: ["side effect"],
    time_window: "year",
    sort: "top",
    max_posts: 25,
    platform: "bluesky",
    ...o,
  });

  const postView = (over: Record<string, unknown> = {}) => ({
    uri: "at://did:plc:abc/app.bsky.feed.post/xyz",
    cid: "cid1",
    author: {
      did: "did:plc:abc",
      handle: "patient.bsky.social",
      displayName: "P",
    },
    record: { text: "My Ajovy side effect", createdAt: "2026-01-01T00:00:00Z" },
    likeCount: 5,
    replyCount: 2,
    repostCount: 1,
    indexedAt: "2026-01-02T00:00:00Z",
    ...over,
  });

  it("returns warning with no creds", async () => {
    delete process.env.BLUESKY_IDENTIFIER;
    delete process.env.BLUESKY_APP_PASSWORD;
    const r = await collectBlueskyPosts(input());
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0]).toMatch(/BLUESKY_IDENTIFIER/);
    expect(r.posts).toHaveLength(0);
  });

  it("collects and normalizes posts", async () => {
    process.env.BLUESKY_IDENTIFIER = "u";
    process.env.BLUESKY_APP_PASSWORD = "pw";
    global.fetch = jest.fn(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("createSession"))
        return { ok: true, json: async () => ({ accessJwt: "JWT" }) } as never;
      return {
        ok: true,
        json: async () => ({ posts: [postView()] }),
      } as never;
    });
    const r = await collectBlueskyPosts(input(), 1000);
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]?.id).toBe("at://did:plc:abc/app.bsky.feed.post/xyz");
    expect(r.posts[0]?.channel).toBeUndefined();
    expect(r.posts[0]?.score).toBe(5);
    expect(r.posts[0]?.num_comments).toBe(2);
    expect(r.posts[0]?.author_pseudonym).toMatch(/^[0-9a-f]{12}$/);
    expect(r.posts[0]?.source_url).toBe(
      "https://bsky.app/profile/did:plc:abc/post/xyz",
    );
  });

  it("excludes raw handle from JSON.stringify", async () => {
    process.env.BLUESKY_IDENTIFIER = "u";
    process.env.BLUESKY_APP_PASSWORD = "pw";
    global.fetch = jest.fn(async (input_) => {
      const url = input_ instanceof Request ? input_.url : String(input_);
      if (url.includes("createSession"))
        return { ok: true, json: async () => ({ accessJwt: "JWT" }) } as never;
      return {
        ok: true,
        json: async () => ({ posts: [postView()] }),
      } as never;
    });
    const r = await collectBlueskyPosts(input());
    const str = JSON.stringify(r);
    expect(str).not.toContain("patient.bsky.social");
  });

  it("dedups by uri", async () => {
    process.env.BLUESKY_IDENTIFIER = "u";
    process.env.BLUESKY_APP_PASSWORD = "pw";
    global.fetch = jest.fn(async (input_) => {
      const url = input_ instanceof Request ? input_.url : String(input_);
      if (url.includes("createSession"))
        return { ok: true, json: async () => ({ accessJwt: "JWT" }) } as never;
      return {
        ok: true,
        json: async () => ({ posts: [postView(), postView()] }),
      } as never;
    });
    const r = await collectBlueskyPosts(input());
    expect(r.posts).toHaveLength(1);
  });

  it("returns warning on malformed search response", async () => {
    process.env.BLUESKY_IDENTIFIER = "u";
    process.env.BLUESKY_APP_PASSWORD = "pw";
    global.fetch = jest.fn(async (input_) => {
      const url = input_ instanceof Request ? input_.url : String(input_);
      if (url.includes("createSession"))
        return { ok: true, json: async () => ({ accessJwt: "JWT" }) } as never;
      return {
        ok: true,
        json: async () => {
          throw new SyntaxError("not valid JSON");
        },
      } as never;
    });
    const r = await collectBlueskyPosts(input());
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings.some((w: string) => w.includes("not valid JSON"))).toBe(
      true,
    );
    expect(r.posts).toHaveLength(0);
  });
});
