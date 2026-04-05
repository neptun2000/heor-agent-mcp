import { handleKnowledgeRead } from "../../src/tools/knowledgeRead.js";
import { writeWikiFile } from "../../src/knowledge/wikiStore.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("handleKnowledgeRead", () => {
  let tmpDir: string;
  const orig = process.env.HEOR_KB_ROOT;
  beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), "kb-read-")); process.env.HEOR_KB_ROOT = tmpDir; });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); if (orig === undefined) delete process.env.HEOR_KB_ROOT; else process.env.HEOR_KB_ROOT = orig; });

  it("reads a wiki file", async () => {
    await writeWikiFile("p1", "wiki/notes.md", "test content");
    const result = await handleKnowledgeRead({ project: "p1", path: "wiki/notes.md" });
    expect(result.content as string).toContain("test content");
  });

  it("returns error message for invalid path", async () => {
    const result = await handleKnowledgeRead({ project: "p1", path: "../etc/passwd" });
    expect(result.content as string).toContain("Error");
  });
});
