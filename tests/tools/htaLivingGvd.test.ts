/**
 * Tests for hta.living_gvd — Living GVD as a diffable artifact.
 * Isolated KB root + real project + claim registry.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleProjectCreate } from "../../src/tools/projectCreate.js";
import { handleClaimRegistry } from "../../src/tools/claimRegistry.js";
import { handleHtaLivingGvd } from "../../src/tools/htaLivingGvd.js";

const PROJECT = "gvd-proj";

type SnapRes = { content: string; living_gvd_manifest: any };
type DiffRes = { content: string; living_gvd_diff: any };

async function upsert(claim: Record<string, unknown>) {
  await handleClaimRegistry({ project_id: PROJECT, action: "upsert", claim });
}

describe("hta.living_gvd", () => {
  let tmpDir: string;
  const orig = process.env.HEOR_KB_ROOT;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-gvd-"));
    process.env.HEOR_KB_ROOT = tmpDir;
    await handleProjectCreate({ project_id: PROJECT, drug: "x", indication: "y" });
    await upsert({
      id: "icer-base-case",
      statement: "ICER 18,500 per QALY",
      numeric_value: 18500,
      value_display: "£18,500",
      keywords: ["ICER"],
    });
    await upsert({
      id: "net-budget-impact",
      statement: "Net budget impact GBP 1,250,000",
      numeric_value: 1250000,
      keywords: ["budget impact"],
    });
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    if (orig === undefined) delete process.env.HEOR_KB_ROOT;
    else process.env.HEOR_KB_ROOT = orig;
  });

  it("requires a snapshot before refresh", async () => {
    await expect(
      handleHtaLivingGvd({ project_id: PROJECT, action: "refresh" }),
    ).rejects.toThrow(/snapshot/i);
  });

  it("snapshot records section→claim mapping with baseline values", async () => {
    const r = (await handleHtaLivingGvd({
      project_id: PROJECT,
      action: "snapshot",
      sections: [
        { name: "Health Economic Summary", claim_ids: ["icer-base-case", "net-budget-impact"] },
        { name: "Disease Background and Epidemiology", claim_ids: [] },
      ],
    })) as unknown as SnapRes;
    expect(r.living_gvd_manifest.sections).toHaveLength(2);
    const econ = r.living_gvd_manifest.sections.find(
      (s: any) => s.name === "Health Economic Summary",
    );
    expect(econ.snapshot_values["icer-base-case"]).toBe(18500);
  });

  it("refresh reports all current when nothing changed", async () => {
    await handleHtaLivingGvd({
      project_id: PROJECT,
      action: "snapshot",
      sections: [{ name: "Health Economic Summary", claim_ids: ["icer-base-case"] }],
    });
    const r = (await handleHtaLivingGvd({
      project_id: PROJECT,
      action: "refresh",
    })) as unknown as DiffRes;
    expect(r.living_gvd_diff.stale_count).toBe(0);
    expect(r.living_gvd_diff.regenerate).toHaveLength(0);
    expect(r.content).toMatch(/in sync/i);
  });

  it("refresh flags only the section whose claim value drifted", async () => {
    await handleHtaLivingGvd({
      project_id: PROJECT,
      action: "snapshot",
      sections: [
        { name: "Health Economic Summary", claim_ids: ["icer-base-case"] },
        { name: "Disease Background and Epidemiology", claim_ids: ["net-budget-impact"] },
      ],
    });
    // Change the ICER only.
    await upsert({
      id: "icer-base-case",
      statement: "ICER 21,000 per QALY",
      numeric_value: 21000,
      value_display: "£21,000",
      keywords: ["ICER"],
    });
    const r = (await handleHtaLivingGvd({
      project_id: PROJECT,
      action: "refresh",
    })) as unknown as DiffRes;
    expect(r.living_gvd_diff.stale_count).toBe(1);
    expect(r.living_gvd_diff.regenerate).toEqual(["Health Economic Summary"]);
    const stale = r.living_gvd_diff.sections.find(
      (s: any) => s.name === "Health Economic Summary",
    );
    expect(stale.status).toBe("stale");
    expect(stale.changed_claims[0]).toMatchObject({ claim_id: "icer-base-case", old: 18500, new: 21000 });
  });

  it("flags a section whose claim was removed as claim_missing", async () => {
    await handleHtaLivingGvd({
      project_id: PROJECT,
      action: "snapshot",
      sections: [{ name: "Health Economic Summary", claim_ids: ["icer-base-case"] }],
    });
    await handleClaimRegistry({ project_id: PROJECT, action: "remove", claim_id: "icer-base-case" });
    const r = (await handleHtaLivingGvd({
      project_id: PROJECT,
      action: "refresh",
    })) as unknown as DiffRes;
    const s = r.living_gvd_diff.sections[0];
    expect(s.status).toBe("claim_missing");
    expect(s.missing_claims).toContain("icer-base-case");
  });

  it("treats a superseded claim as stale even if the value is unchanged", async () => {
    await handleHtaLivingGvd({
      project_id: PROJECT,
      action: "snapshot",
      sections: [{ name: "Health Economic Summary", claim_ids: ["icer-base-case"] }],
    });
    await upsert({
      id: "icer-base-case",
      statement: "ICER 18,500 per QALY",
      numeric_value: 18500,
      value_display: "£18,500",
      keywords: ["ICER"],
      status: "superseded",
    });
    const r = (await handleHtaLivingGvd({
      project_id: PROJECT,
      action: "refresh",
    })) as unknown as DiffRes;
    expect(r.living_gvd_diff.stale_count).toBe(1);
  });

  it("requires sections for snapshot and a valid project", async () => {
    await expect(
      handleHtaLivingGvd({ project_id: PROJECT, action: "snapshot" }),
    ).rejects.toThrow(/requires sections/i);
    await expect(
      handleHtaLivingGvd({ project_id: "nope", action: "refresh" }),
    ).rejects.toThrow(/not found/i);
  });
});
