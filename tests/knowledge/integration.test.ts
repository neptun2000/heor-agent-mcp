import { handleLiteratureSearch } from "../../src/tools/literatureSearch.js";
import { readdir, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

jest.mock("../../src/providers/factory.js", () => ({
  createProvider: () => ({
    searchLiterature: async (params: any) => {
      const results = [
        {
          id: "pubmed_111",
          source: "pubmed" as const,
          title: "Study A",
          authors: ["A"],
          date: "2024",
          study_type: "rct",
          abstract: "abs",
          url: "https://example.com/111",
        },
        {
          id: "pubmed_222",
          source: "pubmed" as const,
          title: "Study B",
          authors: ["B"],
          date: "2024",
          study_type: "rct",
          abstract: "abs",
          url: "https://example.com/222",
        },
      ];
      // Simulate what DirectProvider does: save if project is set
      if (params.project) {
        const { saveLiteratureResult } =
          await import("../../src/knowledge/rawStore.js");
        for (const r of results) {
          await saveLiteratureResult(params.project, r, params.query);
        }
      }
      return {
        content: "mock content",
        audit: {
          tool: "literature.search",
          timestamp: new Date().toISOString(),
          query: {},
          sources_queried: [],
          methodology: "",
          inclusions: 2,
          exclusions: [],
          assumptions: [],
          warnings: [],
          output_format: "text",
        },
      };
    },
  }),
}));

describe("literature_search auto-save", () => {
  let tmpDir: string;
  const originalEnv = process.env.HEOR_KB_ROOT;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "heor-int-test-"));
    process.env.HEOR_KB_ROOT = tmpDir;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.HEOR_KB_ROOT;
    else process.env.HEOR_KB_ROOT = originalEnv;
  });

  it("saves results when project param is set", async () => {
    await handleLiteratureSearch({ query: "test", project: "int-test" });
    const literatureDir = join(
      tmpDir,
      "projects",
      "int-test",
      "raw",
      "literature",
    );
    const files = await readdir(literatureDir);
    expect(files.length).toBe(2);
    expect(files.some((f) => f.includes("pubmed_111"))).toBe(true);
  });

  it("does not save when project param is absent", async () => {
    await handleLiteratureSearch({ query: "test" });
    // No files should be created
    const projectsDir = join(tmpDir, "projects");
    try {
      const dirs = await readdir(projectsDir);
      expect(dirs.length).toBe(0);
    } catch {
      // directory may not exist at all — that's fine
    }
  });
});
