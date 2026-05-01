import { inferSurface } from "../../src/analytics.js";

describe("inferSurface — derive client surface from MCP clientInfo.name", () => {
  it("recognizes the Vercel web UI's MCP client name", () => {
    expect(inferSurface("heor-web-ui")).toBe("claude_anthropic_web");
  });

  it("recognizes ChatGPT Custom GPT adapter", () => {
    expect(inferSurface("chatgpt-adapter")).toBe("chatgpt_adapter");
    expect(inferSurface("chatgpt-adapter-test")).toBe("chatgpt_adapter");
    expect(inferSurface("chatgpt-adapter-v2")).toBe("chatgpt_adapter");
  });

  it("recognizes Claude Desktop", () => {
    expect(inferSurface("Claude")).toBe("claude_desktop");
    expect(inferSurface("claude-ai")).toBe("claude_desktop");
  });

  it("recognizes Smithery / Glama / PulseMCP gateways", () => {
    expect(inferSurface("smithery")).toBe("smithery");
    expect(inferSurface("glama")).toBe("glama");
    expect(inferSurface("pulsemcp")).toBe("pulsemcp");
  });

  it("falls back to 'direct_mcp' for unknown / npx clients", () => {
    expect(inferSurface("npx")).toBe("direct_mcp");
    expect(inferSurface("some-third-party-client")).toBe("direct_mcp");
    expect(inferSurface("")).toBe("direct_mcp");
    expect(inferSurface(undefined)).toBe("direct_mcp");
  });

  it("is case-insensitive on the prefix match (Anthropic clients vary)", () => {
    expect(inferSurface("CLAUDE")).toBe("claude_desktop");
    expect(inferSurface("ChatGPT-Adapter")).toBe("chatgpt_adapter");
    expect(inferSurface("Heor-Web-UI")).toBe("claude_anthropic_web");
  });
});
