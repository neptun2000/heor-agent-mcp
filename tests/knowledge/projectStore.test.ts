import { createProject, projectExists, readProjectConfig, listProjects } from "../../src/knowledge/projectStore.js";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("projectStore", () => {
  let tmpDir: string;
  const orig = process.env.HEOR_KB_ROOT;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "heor-proj-"));
    process.env.HEOR_KB_ROOT = tmpDir;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    if (orig === undefined) delete process.env.HEOR_KB_ROOT;
    else process.env.HEOR_KB_ROOT = orig;
  });

  it("creates project with full skeleton", async () => {
    const result = await createProject({
      project_id: "semaglutide-t2d",
      drug: "semaglutide",
      indication: "type 2 diabetes",
      hta_targets: ["nice", "cadth"],
    });
    expect(result.created).toBe(true);
    expect(result.config.drug).toBe("semaglutide");
    expect(result.config.hta_targets).toEqual(["nice", "cadth"]);

    // Verify directories exist
    await expect(access(join(result.path, "raw/literature"))).resolves.toBeUndefined();
    await expect(access(join(result.path, "raw/models"))).resolves.toBeUndefined();
    await expect(access(join(result.path, "raw/dossiers"))).resolves.toBeUndefined();
    await expect(access(join(result.path, "wiki"))).resolves.toBeUndefined();
    await expect(access(join(result.path, "wiki/index.md"))).resolves.toBeUndefined();
    await expect(access(join(result.path, "project.yaml"))).resolves.toBeUndefined();
  });

  it("is idempotent", async () => {
    await createProject({ project_id: "test", drug: "X", indication: "Y" });
    const second = await createProject({ project_id: "test", drug: "Z", indication: "W" });
    expect(second.created).toBe(false);
    expect(second.config.drug).toBe("X"); // original kept
  });

  it("sanitizes project_id", async () => {
    const result = await createProject({ project_id: "Test/Drug!!!", drug: "X", indication: "Y" });
    expect(result.config.project_id).not.toContain("/");
    expect(result.config.project_id).not.toContain("!");
  });

  it("projectExists returns correct status", async () => {
    expect(await projectExists("new-proj")).toBe(false);
    await createProject({ project_id: "new-proj", drug: "X", indication: "Y" });
    expect(await projectExists("new-proj")).toBe(true);
  });

  it("readProjectConfig retrieves saved data", async () => {
    await createProject({ project_id: "read-test", drug: "semaglutide", indication: "T2D", hta_targets: ["nice"] });
    const config = await readProjectConfig("read-test");
    expect(config.drug).toBe("semaglutide");
    expect(config.hta_targets).toEqual(["nice"]);
  });

  it("listProjects returns created projects", async () => {
    await createProject({ project_id: "a-proj", drug: "A", indication: "B" });
    await createProject({ project_id: "b-proj", drug: "C", indication: "D" });
    const projects = await listProjects();
    expect(projects).toContain("a-proj");
    expect(projects).toContain("b-proj");
  });

  it("listProjects returns empty array when no projects", async () => {
    const projects = await listProjects();
    expect(projects).toEqual([]);
  });
});
