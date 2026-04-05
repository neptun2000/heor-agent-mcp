import { writeWikiFile, readKnowledgeFile, knowledgeFileExists } from "../../src/knowledge/wikiStore.js";
import { saveLiteratureResult } from "../../src/knowledge/rawStore.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("wikiStore", () => {
  let tmpDir: string;
  const orig = process.env.HEOR_KB_ROOT;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "heor-wiki-"));
    process.env.HEOR_KB_ROOT = tmpDir;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    if (orig === undefined) delete process.env.HEOR_KB_ROOT;
    else process.env.HEOR_KB_ROOT = orig;
  });

  describe("writeWikiFile", () => {
    it("writes a file to wiki/ tree", async () => {
      const path = await writeWikiFile("proj1", "wiki/trials/sustain-6.md", "# Test content");
      expect(path).toContain("wiki");
      expect(path).toContain("sustain-6.md");
      const content = await readKnowledgeFile("proj1", "wiki/trials/sustain-6.md");
      expect(content).toContain("# Test content");
    });

    it("creates parent directories", async () => {
      await writeWikiFile("proj1", "wiki/deeply/nested/path/file.md", "content");
      expect(await knowledgeFileExists("proj1", "wiki/deeply/nested/path/file.md")).toBe(true);
    });

    it("rejects paths outside wiki/", async () => {
      await expect(writeWikiFile("proj1", "raw/literature/hack.md", "content")).rejects.toThrow();
    });

    it("rejects non-.md paths", async () => {
      await expect(writeWikiFile("proj1", "wiki/trials/file.txt", "content")).rejects.toThrow();
    });

    it("rejects path traversal (../)", async () => {
      await expect(writeWikiFile("proj1", "wiki/../../../etc/passwd", "hack")).rejects.toThrow();
    });

    it("rejects absolute paths", async () => {
      await expect(writeWikiFile("proj1", "/etc/passwd", "hack")).rejects.toThrow();
    });
  });

  describe("readKnowledgeFile", () => {
    it("reads from wiki/", async () => {
      await writeWikiFile("proj1", "wiki/test.md", "hello");
      const content = await readKnowledgeFile("proj1", "wiki/test.md");
      expect(content).toBe("hello");
    });

    it("reads from raw/", async () => {
      await saveLiteratureResult("proj1", {
        id: "pubmed_99", source: "pubmed", title: "Test", authors: [], date: "2024",
        study_type: "rct", abstract: "abstract", url: "https://example.com",
      }, "q");
      const content = await readKnowledgeFile("proj1", "raw/literature/pubmed_99.md");
      expect(content).toContain("Test");
    });

    it("rejects path traversal", async () => {
      await expect(readKnowledgeFile("proj1", "../../etc/passwd")).rejects.toThrow();
    });

    it("rejects paths outside raw/ or wiki/", async () => {
      await expect(readKnowledgeFile("proj1", "project.yaml")).rejects.toThrow();
    });
  });
});
