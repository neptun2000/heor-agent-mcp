describe("createProvider", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns DirectProvider when HEOR_API_KEY is not set", async () => {
    delete process.env.HEOR_API_KEY;
    const { createProvider } = await import("../../src/providers/factory.js");
    const provider = createProvider();
    expect(provider.constructor.name).toBe("DirectProvider");
  });

  it("returns HostedProvider when HEOR_API_KEY is set", async () => {
    process.env.HEOR_API_KEY = "test-key";
    const { createProvider } = await import("../../src/providers/factory.js");
    const provider = createProvider();
    expect(provider.constructor.name).toBe("HostedProvider");
  });
});
