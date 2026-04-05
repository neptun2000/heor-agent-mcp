import { handleKnowledgeSearch } from "../../src/tools/knowledgeSearch.js";
import { saveLiteratureResult } from "../../src/knowledge/rawStore.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("handleKnowledgeSearch", () => {
  let tmpDir: string;
  const orig = process.env.HEOR_KB_ROOT;
  beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), "kb-search-")); process.env.HEOR_KB_ROOT = tmpDir; });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); if (orig === undefined) delete process.env.HEOR_KB_ROOT; else process.env.HEOR_KB_ROOT = orig; });

  it("returns matches", async () => {
    await saveLiteratureResult("p1", { id: "pm_1", source: "pubmed", title: "Semaglutide efficacy", authors: [], date: "2023", study_type: "rct", abstract: "weight loss in diabetes", url: "" }, "q");
    const result = await handleKnowledgeSearch({ project: "p1", query: "semaglutide" });
    expect(result.audit.tool).toBe("knowledge_search");
    expect(result.content as string).toContain("semaglutide");
  });

  it("returns empty-result message when no matches", async () => {
    const result = await handleKnowledgeSearch({ project: "empty", query: "xyz" });
    expect(result.content as string).toContain("No matches");
  });

  it("validates required fields", async () => {
    await expect(handleKnowledgeSearch({})).rejects.toThrow();
  });
});
