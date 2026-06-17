/**
 * Tests for the cross-deliverable claim layer:
 *   evidence.claim_registry, evidence.consistency_check, publication.draft.
 *
 * Uses an isolated KB root per test (HEOR_KB_ROOT) and a real project.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleProjectCreate } from "../../src/tools/projectCreate.js";
import {
  handleClaimRegistry,
  type claimRegistryToolSchema,
} from "../../src/tools/claimRegistry.js";
import { handleConsistencyCheck } from "../../src/tools/consistencyCheck.js";
import { handlePublicationDraft } from "../../src/tools/publicationDraft.js";

type RegRes = { content: string; registry: { count: number; claims: any[] } };
type ChkRes = { content: string; consistency: any };
type PubRes = { content: string; publication: any };

const PROJECT = "fremanezumab-migraine";

async function seedProject() {
  await handleProjectCreate({
    project_id: PROJECT,
    drug: "fremanezumab",
    indication: "migraine",
  });
}

async function upsert(claim: Record<string, unknown>): Promise<RegRes> {
  return (await handleClaimRegistry({
    project_id: PROJECT,
    action: "upsert",
    claim,
  })) as unknown as RegRes;
}

describe("claim layer", () => {
  let tmpDir: string;
  const orig = process.env.HEOR_KB_ROOT;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kb-claims-"));
    process.env.HEOR_KB_ROOT = tmpDir;
    await seedProject();
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    if (orig === undefined) delete process.env.HEOR_KB_ROOT;
    else process.env.HEOR_KB_ROOT = orig;
  });

  // ── claim_registry ──────────────────────────────────────────────────────
  describe("evidence.claim_registry", () => {
    it("upserts a claim, derives an id from the statement, and persists it", async () => {
      const r = await upsert({
        statement: "Base-case ICER is £18,500 per QALY",
        numeric_value: 18500,
        value_display: "£18,500",
        unit: "GBP/QALY",
        keywords: ["ICER", "per QALY"],
        source_tool: "models.cost_effectiveness",
      });
      expect(r.registry.count).toBe(1);
      expect(r.registry.claims[0].id).toMatch(/icer/);
      // list reflects persistence
      const list = (await handleClaimRegistry({
        project_id: PROJECT,
        action: "list",
      })) as unknown as RegRes;
      expect(list.registry.count).toBe(1);
    });

    it("updates an existing claim in place (same id), preserving created_at", async () => {
      const first = await upsert({
        id: "icer-base",
        statement: "ICER is £18,500 per QALY",
        numeric_value: 18500,
        keywords: ["ICER"],
      });
      const createdAt = first.registry.claims[0].created_at;
      const second = await upsert({
        id: "icer-base",
        statement: "ICER is £21,000 per QALY",
        numeric_value: 21000,
        keywords: ["ICER"],
      });
      expect(second.registry.count).toBe(1);
      expect(second.registry.claims[0].numeric_value).toBe(21000);
      expect(second.registry.claims[0].created_at).toBe(createdAt);
    });

    it("get and remove work", async () => {
      await upsert({ id: "p1", statement: "Prevalence 15 per 100k", numeric_value: 15, keywords: ["prevalence"] });
      const got = (await handleClaimRegistry({ project_id: PROJECT, action: "get", claim_id: "p1" })) as unknown as RegRes;
      expect(got.content).toMatch(/Prevalence/);
      const removed = (await handleClaimRegistry({ project_id: PROJECT, action: "remove", claim_id: "p1" })) as unknown as RegRes;
      expect(removed.registry.count).toBe(0);
    });

    it("errors when the project does not exist", async () => {
      await expect(
        handleClaimRegistry({ project_id: "nonexistent-proj", action: "list" }),
      ).rejects.toThrow(/not found/i);
    });
  });

  // ── consistency_check ───────────────────────────────────────────────────
  describe("evidence.consistency_check", () => {
    beforeEach(async () => {
      await upsert({
        id: "icer-base",
        statement: "Base-case ICER is £18,500 per QALY",
        numeric_value: 18500,
        value_display: "£18,500",
        unit: "GBP/QALY",
        keywords: ["ICER", "per QALY"],
      });
    });

    it("flags drift when a deliverable quotes a different value near the keyword", async () => {
      const r = (await handleConsistencyCheck({
        project_id: PROJECT,
        deliverables: [
          { name: "NICE dossier", text: "The base-case ICER was £18,500 per QALY gained." },
          { name: "Payer GVD", text: "Our model estimates an ICER of £21,000 per QALY." },
        ],
      })) as unknown as ChkRes;
      expect(r.consistency.drift_count).toBe(1);
      expect(r.consistency.drifting_claims).toContain("icer-base");
      const driftFinding = r.consistency.findings.find(
        (f: any) => f.deliverable === "Payer GVD" && f.status === "drift",
      );
      expect(driftFinding.conflicting_values.join(" ")).toMatch(/21,000/);
    });

    it("reports consistent when canonical value present and absent when keyword missing", async () => {
      const r = (await handleConsistencyCheck({
        project_id: PROJECT,
        deliverables: [
          { name: "Abstract", text: "The ICER was £18,500 per QALY." },
          { name: "Press release", text: "A breakthrough migraine therapy." },
        ],
      })) as unknown as ChkRes;
      const consistent = r.consistency.findings.find((f: any) => f.deliverable === "Abstract");
      const absent = r.consistency.findings.find((f: any) => f.deliverable === "Press release");
      expect(consistent.status).toBe("consistent");
      expect(absent.status).toBe("absent");
      expect(r.consistency.drift_count).toBe(0);
    });

    it("works with inline claims (no project)", async () => {
      const r = (await handleConsistencyCheck({
        claims: [
          { id: "mmd", statement: "MMD reduction 4 days", numeric_value: 4, keywords: ["MMD"] },
        ],
        deliverables: [{ name: "Poster", text: "MMD fell by 6 days." }],
      })) as unknown as ChkRes;
      expect(r.consistency.drift_count).toBe(1);
    });

    it("requires project_id or inline claims", async () => {
      await expect(
        handleConsistencyCheck({ deliverables: [{ name: "x", text: "y" }] }),
      ).rejects.toThrow(/project_id|inline claims/i);
    });
  });

  // ── publication.draft ───────────────────────────────────────────────────
  describe("publication.draft", () => {
    it("drafts a structured abstract and selects CHEERS for economic evaluations", async () => {
      const r = (await handlePublicationDraft({
        type: "abstract",
        title: "Cost-effectiveness of fremanezumab in migraine",
        study_design: "economic_evaluation",
        target: "ISPOR 2026",
        background: "Migraine is burdensome.",
        methods: "Markov model, NICE reference case.",
        results: "Base case below threshold.",
        conclusions: "Cost-effective.",
      })) as unknown as PubRes;
      expect(r.publication.reporting_guideline).toMatch(/CHEERS/);
      expect(r.content).toMatch(/Background/);
      expect(r.content).toMatch(/Conclusions/);
    });

    it("pulls referenced claims from the registry into the draft", async () => {
      await upsert({
        id: "icer-base",
        statement: "Base-case ICER is £18,500 per QALY",
        numeric_value: 18500,
        value_display: "£18,500",
        keywords: ["ICER"],
      });
      const r = (await handlePublicationDraft({
        type: "abstract",
        title: "CEA abstract",
        study_design: "economic_evaluation",
        project_id: PROJECT,
        reference_claim_ids: ["icer-base"],
      })) as unknown as PubRes;
      expect(r.publication.referenced_claims).toContain("icer-base");
      expect(r.content).toMatch(/£18,500/);
    });

    it("warns about an over-limit draft", async () => {
      const big = "word ".repeat(400);
      const r = (await handlePublicationDraft({
        type: "abstract",
        title: "Too long",
        results: big,
      })) as unknown as PubRes;
      expect(r.publication.warnings.join(" ")).toMatch(/over the 300-word/i);
    });

    it("flags an RCT without trial registration and requires CONSORT", async () => {
      const r = (await handlePublicationDraft({
        type: "manuscript",
        title: "RCT manuscript",
        study_design: "rct",
      })) as unknown as PubRes;
      expect(r.publication.reporting_guideline).toMatch(/CONSORT/);
      expect(r.publication.warnings.join(" ")).toMatch(/trial_registration_id|registration/i);
    });

    it("errors when reference_claim_ids given without project_id", async () => {
      await expect(
        handlePublicationDraft({
          type: "abstract",
          title: "x",
          reference_claim_ids: ["icer-base"],
        }),
      ).rejects.toThrow(/project_id/i);
    });
  });
});
