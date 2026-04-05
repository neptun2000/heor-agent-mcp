import { getKbRoot, getProjectRoot, sanitizeProjectId, sanitizeFilename } from "../../src/knowledge/paths.js";
import { homedir } from "node:os";
import { join } from "node:path";

describe("paths", () => {
  const originalEnv = process.env.HEOR_KB_ROOT;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.HEOR_KB_ROOT;
    else process.env.HEOR_KB_ROOT = originalEnv;
  });

  it("defaults KB root to ~/.heor-agent", () => {
    delete process.env.HEOR_KB_ROOT;
    expect(getKbRoot()).toBe(join(homedir(), ".heor-agent"));
  });

  it("respects HEOR_KB_ROOT env var", () => {
    process.env.HEOR_KB_ROOT = "/tmp/test-kb";
    expect(getKbRoot()).toBe("/tmp/test-kb");
  });

  it("builds project path correctly", () => {
    process.env.HEOR_KB_ROOT = "/tmp/test-kb";
    expect(getProjectRoot("my-drug")).toBe("/tmp/test-kb/projects/my-drug");
  });

  describe("sanitizeProjectId", () => {
    it("allows alphanumeric, hyphens, underscores", () => {
      expect(sanitizeProjectId("nivolumab-nsclc_v2")).toBe("nivolumab-nsclc_v2");
    });
    it("replaces invalid chars", () => {
      expect(sanitizeProjectId("drug/../../../etc")).toBe("drug-etc");
    });
    it("lowercases", () => {
      expect(sanitizeProjectId("MyDrug")).toBe("mydrug");
    });
    it("throws on empty result", () => {
      expect(() => sanitizeProjectId("///")).toThrow();
    });
    it("truncates to 64 chars", () => {
      const long = "a".repeat(100);
      expect(sanitizeProjectId(long).length).toBe(64);
    });
  });

  describe("sanitizeFilename", () => {
    it("replaces invalid chars with underscore", () => {
      expect(sanitizeFilename("pubmed/12345")).toBe("pubmed_12345");
    });
  });
});
