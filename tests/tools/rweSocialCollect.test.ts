import { handleRweSocialCollect, rweSocialCollectToolSchema } from "../../src/tools/rweSocialCollect.js";
import { _resetRedditTokenCache } from "../../src/providers/direct/reddit.js";

type Out = Awaited<ReturnType<typeof handleRweSocialCollect>>;

describe("rwe.social_collect", () => {
  const origFetch = global.fetch;
  const origEnv = { ...process.env };
  afterEach(() => {
    global.fetch = origFetch;
    process.env = { ...origEnv };
    _resetRedditTokenCache();
  });

  it("schema is registered with the dot name and readOnly/openWorld hints", () => {
    expect(rweSocialCollectToolSchema.name).toBe("rwe.social_collect");
    expect(rweSocialCollectToolSchema.annotations.readOnlyHint).toBe(true);
    expect(rweSocialCollectToolSchema.annotations.openWorldHint).toBe(true); // makes external calls
    expect(rweSocialCollectToolSchema.inputSchema.required).toContain("drug");
  });

  it("rejects input with no drug", async () => {
    await expect(handleRweSocialCollect({ indication: "x" })).rejects.toThrow(/drug/);
  });

  it("returns a degraded result + governance markdown when creds are absent", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    const r = (await handleRweSocialCollect({ drug: "Ajovy", subreddits: ["migraine"] })) as Out & {
      social_collect: { total_collected: number; warnings: string[] };
    };
    expect(r.social_collect.total_collected).toBe(0);
    expect(r.content).toMatch(/Module VI/);
    expect(r.content).toMatch(/lowest-validity/i);
    expect(r.content).toMatch(/REDDIT_CLIENT_ID/);
  });

  it("renders collected posts as a table and carries no raw author", async () => {
    process.env.REDDIT_CLIENT_ID = "id";
    process.env.REDDIT_CLIENT_SECRET = "secret";
    global.fetch = jest.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("access_token"))
        return { ok: true, json: async () => ({ access_token: "TKN", expires_in: 3600 }) } as never;
      return {
        ok: true,
        json: async () => ({ data: { children: [{ data: {
          name: "t3_abc", permalink: "/p/", subreddit: "migraine", author: "jane_doe_99",
          created_utc: 1700000000, title: "My experience", selftext: "side effect", score: 9, num_comments: 2,
        } }] } }),
      } as never;
    }) as unknown as typeof fetch;
    const r = (await handleRweSocialCollect({
      drug: "Ajovy", brand_names: ["fremanezumab"], subreddits: ["migraine"], max_posts: 10,
    })) as Out;
    expect(r.content).toContain("t3_abc");
    expect(r.content).not.toContain("jane_doe_99");
  });
});
