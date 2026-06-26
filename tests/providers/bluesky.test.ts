import { getBlueskySession, _resetBlueskySessionCache } from "../../src/providers/direct/bluesky.js";

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
