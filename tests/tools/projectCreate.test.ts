import { handleProjectCreate } from "../../src/tools/projectCreate.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("handleProjectCreate", () => {
  let tmpDir: string;
  const orig = process.env.HEOR_KB_ROOT;
  beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), "kb-proj-")); process.env.HEOR_KB_ROOT = tmpDir; });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); if (orig === undefined) delete process.env.HEOR_KB_ROOT; else process.env.HEOR_KB_ROOT = orig; });

  it("creates new project", async () => {
    const result = await handleProjectCreate({ project_id: "semaglutide-t2d", drug: "semaglutide", indication: "T2D" });
    expect(result.content as string).toContain("Created project");
  });

  it("is idempotent", async () => {
    await handleProjectCreate({ project_id: "test", drug: "X", indication: "Y" });
    const second = await handleProjectCreate({ project_id: "test", drug: "X", indication: "Y" });
    expect(second.content as string).toContain("already exists");
  });

  it("validates required fields", async () => {
    await expect(handleProjectCreate({ project_id: "test" })).rejects.toThrow();
  });
});
