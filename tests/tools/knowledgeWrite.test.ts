import { handleKnowledgeWrite } from "../../src/tools/knowledgeWrite.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("handleKnowledgeWrite", () => {
  let tmpDir: string;
  const orig = process.env.HEOR_KB_ROOT;
  beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), "kb-write-")); process.env.HEOR_KB_ROOT = tmpDir; });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); if (orig === undefined) delete process.env.HEOR_KB_ROOT; else process.env.HEOR_KB_ROOT = orig; });

  it("writes a wiki file", async () => {
    const result = await handleKnowledgeWrite({ project: "p1", path: "wiki/trials/test.md", content: "# Test" });
    expect(result.content as string).toContain("Wrote");
  });

  it("returns error for path outside wiki", async () => {
    const result = await handleKnowledgeWrite({ project: "p1", path: "raw/hack.md", content: "x" });
    expect(result.content as string).toContain("Error");
  });
});
