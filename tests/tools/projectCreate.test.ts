import { handleProjectCreate } from "../../src/tools/projectCreate.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("handleProjectCreate", () => {
  let tmpDir: string;
  const orig = process.env.HEOR_KB_ROOT;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-proj-"));
    process.env.HEOR_KB_ROOT = tmpDir;
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    if (orig === undefined) delete process.env.HEOR_KB_ROOT;
    else process.env.HEOR_KB_ROOT = orig;
  });

  it("creates new project", async () => {
    const result = await handleProjectCreate({
      project_id: "semaglutide-t2d",
      drug: "semaglutide",
      indication: "T2D",
    });
    expect(result.content as string).toContain("Created project");
  });

  it("is idempotent", async () => {
    await handleProjectCreate({
      project_id: "test",
      drug: "X",
      indication: "Y",
    });
    const second = await handleProjectCreate({
      project_id: "test",
      drug: "X",
      indication: "Y",
    });
    expect(second.content as string).toContain("already exists");
  });

  it("validates required fields", async () => {
    await expect(handleProjectCreate({ project_id: "test" })).rejects.toThrow();
  });

  // PostHog showed real-world failures with hta_targets=["smc"], a real
  // HTA body that wasn't in the enum. Adding SMC + AWMSG + TLV + AIFA +
  // INESSS + ISPOR + the regional regulators users actually ask about.
  describe("hta_targets accepts new HTA bodies", () => {
    it("accepts SMC (Scottish Medicines Consortium)", async () => {
      await expect(
        handleProjectCreate({
          project_id: "smc-test",
          drug: "X",
          indication: "Y",
          hta_targets: ["nice", "smc"],
        }),
      ).resolves.not.toThrow();
    });

    it("accepts AWMSG (All Wales Medicines Strategy Group)", async () => {
      await expect(
        handleProjectCreate({
          project_id: "awmsg-test",
          drug: "X",
          indication: "Y",
          hta_targets: ["awmsg"],
        }),
      ).resolves.not.toThrow();
    });

    it("accepts TLV, AIFA, INESSS (existing literature_search sources)", async () => {
      await expect(
        handleProjectCreate({
          project_id: "eu-test",
          drug: "X",
          indication: "Y",
          hta_targets: ["tlv", "aifa", "inesss"],
        }),
      ).resolves.not.toThrow();
    });

    it("error for unknown HTA body suggests closest valid", async () => {
      try {
        await handleProjectCreate({
          project_id: "bad-test",
          drug: "X",
          indication: "Y",
          hta_targets: ["nicee"],
        });
        fail("should have thrown");
      } catch (err) {
        expect(String(err)).toMatch(/nice/i);
      }
    });
  });
});
