import {
  pseudonymizeAuthor,
  getRedditToken,
  _resetRedditTokenCache,
} from "../../src/providers/direct/reddit.js";

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
