import { validateProxyUrl, getProxyUrl, fetchViaProxy } from "../../../src/providers/direct/proxyClient.js";

describe("validateProxyUrl", () => {
  // Silence console.error during tests
  const origError = console.error;
  beforeEach(() => { console.error = jest.fn(); });
  afterEach(() => { console.error = origError; });

  it("returns null when url is undefined", () => {
    expect(validateProxyUrl(undefined)).toBeNull();
  });

  it("returns null when url is empty string", () => {
    expect(validateProxyUrl("")).toBeNull();
  });

  it("accepts localhost with http", () => {
    expect(validateProxyUrl("http://localhost:3333")).toBe("http://localhost:3333");
  });

  it("accepts 127.0.0.1", () => {
    expect(validateProxyUrl("http://127.0.0.1:3333")).toBe("http://127.0.0.1:3333");
  });

  it("strips trailing slashes", () => {
    expect(validateProxyUrl("http://localhost:3333/")).toBe("http://localhost:3333");
    expect(validateProxyUrl("http://localhost:3333///")).toBe("http://localhost:3333");
  });

  it("REJECTS external hostnames (security)", () => {
    expect(validateProxyUrl("https://evil.com/proxy")).toBeNull();
    expect(validateProxyUrl("http://attacker.io")).toBeNull();
    expect(validateProxyUrl("http://10.0.0.1:8080")).toBeNull();
    expect(validateProxyUrl("http://192.168.1.5")).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("REJECTS invalid URLs", () => {
    expect(validateProxyUrl("not-a-url")).toBeNull();
    expect(validateProxyUrl("ftp://localhost")).toBeNull();
  });
});

describe("getProxyUrl", () => {
  const original = process.env.HEOR_PROXY_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.HEOR_PROXY_URL;
    else process.env.HEOR_PROXY_URL = original;
  });

  it("returns null when HEOR_PROXY_URL not set", () => {
    delete process.env.HEOR_PROXY_URL;
    expect(getProxyUrl()).toBeNull();
  });

  it("returns validated URL when set to localhost", () => {
    process.env.HEOR_PROXY_URL = "http://localhost:3333";
    expect(getProxyUrl()).toBe("http://localhost:3333");
  });

  it("returns null when set to external host", () => {
    const origError = console.error;
    console.error = jest.fn();
    process.env.HEOR_PROXY_URL = "https://evil.com";
    expect(getProxyUrl()).toBeNull();
    console.error = origError;
  });
});

describe("fetchViaProxy", () => {
  const original = process.env.HEOR_PROXY_URL;
  const origError = console.error;
  afterEach(() => {
    if (original === undefined) delete process.env.HEOR_PROXY_URL;
    else process.env.HEOR_PROXY_URL = original;
    console.error = origError;
  });
  beforeEach(() => { console.error = jest.fn(); });

  it("returns empty array when proxy not configured", async () => {
    delete process.env.HEOR_PROXY_URL;
    const results = await fetchViaProxy("cochrane", "test", 10);
    expect(results).toEqual([]);
  });

  it("returns results from proxy", async () => {
    process.env.HEOR_PROXY_URL = "http://localhost:3333";
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { id: "test_1", source: "cochrane", title: "Test Review", authors: [], date: "2024", study_type: "meta_analysis", abstract: "", url: "" },
        ],
      }),
    });
    const results = await fetchViaProxy("cochrane", "test", 10);
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Test Review");
    global.fetch = origFetch;
  });

  it("accepts array response format", async () => {
    process.env.HEOR_PROXY_URL = "http://localhost:3333";
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { id: "test_1", source: "cochrane", title: "Test", authors: [], date: "2024", study_type: "review", abstract: "", url: "" },
      ],
    });
    const results = await fetchViaProxy("cochrane", "test", 10);
    expect(results.length).toBe(1);
    global.fetch = origFetch;
  });

  it("filters malformed results", async () => {
    process.env.HEOR_PROXY_URL = "http://localhost:3333";
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { id: "ok", source: "cochrane", title: "Valid" },
          { broken: true },
          null,
        ],
      }),
    });
    const results = await fetchViaProxy("cochrane", "test", 10);
    expect(results.length).toBe(1);
    global.fetch = origFetch;
  });

  it("returns empty on fetch error", async () => {
    process.env.HEOR_PROXY_URL = "http://localhost:3333";
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error("fail"));
    const results = await fetchViaProxy("cochrane", "test", 10);
    expect(results).toEqual([]);
    global.fetch = origFetch;
  });
});
