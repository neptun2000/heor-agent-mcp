/**
 * Tests for confounder_identification (evidence.confounder_identification).
 * Design log #43 — IQWiG / Pufulete 2022 Step 1.
 *
 * The tool is DETERMINISTIC. The web-tier agent supplies candidate_extractions;
 * the tool enforces closed-corpus provenance, runs verify_citations, dedupes,
 * proposes consolidation HINTS (never auto-merges), and emits an
 * expert-interview block for confounders literature cannot supply.
 *
 * verify_citations is dependency-injected (mocked) so the suite is offline.
 */

import {
  runConfounderIdentification,
  type ConfounderDeps,
} from "../../src/tools/confounderIdentification.js";
import type { ToolResult } from "../../src/providers/types.js";
import type { VerifyCitationsContent } from "../../src/tools/verifyCitations.js";

type Content = {
  mode: string;
  candidates: Array<{
    variable_name: string;
    source_paper: {
      corpus_key: string;
      pmid?: string;
      doi?: string;
      title: string;
    };
    source_location: string;
    extraction_method: "agent" | "heuristic";
    provenance: "verified" | "unverified";
  }>;
  rejected_out_of_corpus: Array<{
    variable_name: string;
    attempted_source: string;
    reason: string;
  }>;
  consolidation_candidates: Array<{ name: string; member_variables: string[] }>;
  expert_interview_required: Array<{ variable: string; reason: string }>;
  corpus_manifest: Array<{
    corpus_key: string;
    pmid?: string;
    title: string;
    included: boolean;
  }>;
  citation_audit: VerifyCitationsContent;
  metrics: {
    candidate_count: number;
    verified_source_rate: number;
    fabrication_count: number;
    agent_count: number;
    heuristic_count: number;
    consolidation_candidate_count: number;
  };
  status_label: string;
  markdown_report: string;
};

// ── Mock verify_citations: map a doi/pmid to a status ───────────────────────
function mockVerify(
  statusByKey: Record<
    string,
    "verified" | "fabricated" | "unverifiable" | "url_only"
  >,
  defaultStatus: "verified" | "fabricated" | "unverifiable" = "verified",
): ConfounderDeps["verifyCitations"] {
  return async ({ citations }) => {
    const results: VerifyCitationsContent["results"] = citations.map(
      (c: { id?: string; doi?: string; pmid?: string; url?: string }) => {
        const key = c.doi ?? c.pmid ?? c.url ?? "";
        const status = statusByKey[key] ?? defaultStatus;
        return {
          input: c,
          status,
          crossref_ok: status === "verified" && !!c.doi,
          pubmed_ok: status === "verified" && !!c.pmid,
          source:
            status === "verified" ? ("pubmed" as const) : ("none" as const),
          message: "",
          checked_at: "2026-06-25T00:00:00.000Z",
        };
      },
    );
    const fabricated = results.filter((r) => r.status === "fabricated").length;
    const verified = results.filter((r) => r.status === "verified").length;
    const content: VerifyCitationsContent = {
      results,
      summary: {
        total: results.length,
        verified,
        fabricated,
        unverifiable: results.filter((r) => r.status === "unverifiable").length,
        url_only: results.filter((r) => r.status === "url_only").length,
        fabrication_count: fabricated,
        verified_rate: results.length ? verified / results.length : 0,
      },
      text: "",
    };
    return {
      content,
      audit: { tool: "utils.verify_citations" } as ToolResult["audit"],
    };
  };
}

const DEFINE = {
  pmid: "22992073",
  title: "Placebo-controlled phase 3 study of oral BG-12 in RRMS (DEFINE)",
  year: 2012,
};
const CONFIRM = {
  pmid: "22992074",
  title:
    "Randomised, comparator-controlled study of BG-12 and glatiramer acetate (CONFIRM)",
  year: 2012,
};

const RRMS_INPUT = {
  intervention: "dimethyl fumarate",
  comparator: "glatiramer acetate",
  indication: "relapsing-remitting multiple sclerosis",
  mode: "closed_corpus" as const,
};

describe("runConfounderIdentification", () => {
  it("requires intervention/comparator/indication (Zod)", async () => {
    await expect(
      runConfounderIdentification(
        { intervention: "x" },
        { verifyCitations: mockVerify({}) },
      ),
    ).rejects.toThrow();
  });

  it("rejects unknown keys (.strict)", async () => {
    await expect(
      runConfounderIdentification(
        { ...RRMS_INPUT, corpus_papers: [DEFINE], not_a_field: 1 },
        { verifyCitations: mockVerify({}) },
      ),
    ).rejects.toThrow();
  });

  it("tags the audit evidence.confounder_identification", async () => {
    const r = await runConfounderIdentification(
      { ...RRMS_INPUT, corpus_papers: [DEFINE] },
      { verifyCitations: mockVerify({}) },
    );
    expect(r.audit.tool).toBe("evidence.confounder_identification");
  });

  // ── INVARIANT I1: closed_corpus rejects out-of-corpus citations ──
  it("closed_corpus rejects out-of-corpus citations", async () => {
    const r = await runConfounderIdentification(
      {
        ...RRMS_INPUT,
        corpus_papers: [DEFINE],
        candidate_extractions: [
          {
            variable_name: "Baseline EDSS",
            source_paper_pmid: "22992073",
            source_location: "Table 1 baseline",
          },
          {
            variable_name: "Smoking status",
            source_paper_pmid: "99999999",
            source_location: "Table 1 baseline",
          },
        ],
      },
      { verifyCitations: mockVerify({}) },
    );
    const c = r.content as Content;
    expect(c.candidates.map((x) => x.variable_name)).toContain("Baseline EDSS");
    expect(c.candidates.map((x) => x.variable_name)).not.toContain(
      "Smoking status",
    );
    expect(c.rejected_out_of_corpus.map((x) => x.variable_name)).toContain(
      "Smoking status",
    );
  });

  // ── INVARIANT I2: unverified source → provenance "unverified" ──
  it("flags a candidate whose source did not verify as unverified", async () => {
    const r = await runConfounderIdentification(
      {
        ...RRMS_INPUT,
        corpus_papers: [DEFINE],
        candidate_extractions: [
          {
            variable_name: "Baseline EDSS",
            source_paper_pmid: "22992073",
            source_location: "Table 1 baseline",
          },
        ],
      },
      { verifyCitations: mockVerify({ "22992073": "fabricated" }) },
    );
    const c = r.content as Content;
    expect(c.candidates[0].provenance).toBe("unverified");
    expect(c.metrics.fabrication_count).toBe(1);
  });

  it("marks a candidate with a verified source as verified", async () => {
    const r = await runConfounderIdentification(
      {
        ...RRMS_INPUT,
        corpus_papers: [DEFINE],
        candidate_extractions: [
          {
            variable_name: "Baseline EDSS",
            source_paper_pmid: "22992073",
            source_location: "Table 1 baseline",
          },
        ],
      },
      { verifyCitations: mockVerify({ "22992073": "verified" }) },
    );
    const c = r.content as Content;
    expect(c.candidates[0].provenance).toBe("verified");
    expect(c.candidates[0].extraction_method).toBe("agent");
    expect(c.metrics.verified_source_rate).toBe(1);
  });

  // ── INVARIANT I3: never claims a complete list ──
  it("always labels output as draft_for_human_consolidation", async () => {
    const r = await runConfounderIdentification(
      { ...RRMS_INPUT, corpus_papers: [DEFINE] },
      { verifyCitations: mockVerify({}) },
    );
    const c = r.content as Content;
    expect(c.status_label).toBe("draft_for_human_consolidation");
    expect(c.markdown_report.toLowerCase()).not.toMatch(
      /complete (confounder )?list|final (confounder )?list/,
    );
  });

  it("runs a deterministic heuristic fallback when no candidate_extractions are supplied", async () => {
    const r = await runConfounderIdentification(
      {
        ...RRMS_INPUT,
        corpus_papers: [
          {
            ...DEFINE,
            abstract:
              "Patients had a mean baseline EDSS of 2.4 and mean age 38 years; the annualised relapse rate in the prior year was 1.3. Disease duration averaged 5 years.",
          },
        ],
      },
      { verifyCitations: mockVerify({}) },
    );
    const c = r.content as Content;
    expect(c.candidates.length).toBeGreaterThan(0);
    expect(c.candidates.every((x) => x.extraction_method === "heuristic")).toBe(
      true,
    );
    expect(c.candidates.some((x) => /edss/i.test(x.variable_name))).toBe(true);
    expect(c.metrics.heuristic_count).toBeGreaterThan(0);
  });

  it("proposes consolidation hints for synonymous variables (never auto-merges)", async () => {
    const r = await runConfounderIdentification(
      {
        ...RRMS_INPUT,
        corpus_papers: [DEFINE, CONFIRM],
        candidate_extractions: [
          {
            variable_name: "Baseline EDSS",
            source_paper_pmid: "22992073",
            source_location: "Table 1",
          },
          {
            variable_name: "Expanded Disability Status Scale score",
            source_paper_pmid: "22992074",
            source_location: "Table 1",
          },
        ],
      },
      { verifyCitations: mockVerify({}) },
    );
    const c = r.content as Content;
    // Both candidates survive (no auto-merge) ...
    expect(c.candidates.length).toBe(2);
    // ... but a consolidation hint groups the two synonyms.
    const group = c.consolidation_candidates.find(
      (g) => g.member_variables.length >= 2,
    );
    expect(group).toBeDefined();
    expect(group!.member_variables).toEqual(
      expect.arrayContaining([
        "Baseline EDSS",
        "Expanded Disability Status Scale score",
      ]),
    );
  });

  it("emits an expert-interview block for confounders literature cannot supply", async () => {
    const r = await runConfounderIdentification(
      { ...RRMS_INPUT, corpus_papers: [DEFINE] },
      { verifyCitations: mockVerify({}) },
    );
    const c = r.content as Content;
    expect(c.expert_interview_required.length).toBeGreaterThanOrEqual(2);
    expect(c.expert_interview_required[0]).toHaveProperty("variable");
    expect(c.expert_interview_required[0]).toHaveProperty("reason");
  });

  it("open_search mode freezes the screened literature as the corpus", async () => {
    const litResult: ToolResult = {
      content: {
        results: [
          {
            pmid: "22992073",
            title: DEFINE.title,
            abstract: "mean baseline EDSS 2.4",
          },
          {
            pmid: "30000001",
            title: "Off-topic editorial",
            abstract: "no data",
          },
        ],
      },
      audit: { tool: "literature.search" } as ToolResult["audit"],
    };
    const screenResult: ToolResult = {
      content: {
        results: [
          {
            pmid: "22992073",
            title: DEFINE.title,
            screening_status: "include",
          },
          {
            pmid: "30000001",
            title: "Off-topic editorial",
            screening_status: "exclude",
          },
        ],
      },
      audit: { tool: "literature.screen" } as ToolResult["audit"],
    };
    const deps: ConfounderDeps = {
      verifyCitations: mockVerify({}),
      literatureSearch: async () => litResult,
      screenAbstracts: async () => screenResult,
    };
    const r = await runConfounderIdentification(
      {
        ...RRMS_INPUT,
        mode: "open_search",
        candidate_extractions: [
          {
            variable_name: "Baseline EDSS",
            source_paper_pmid: "22992073",
            source_location: "Table 1",
          },
        ],
      },
      deps,
    );
    const c = r.content as Content;
    // Only the included paper is in the corpus.
    expect(c.corpus_manifest.map((m) => m.pmid)).toContain("22992073");
    expect(c.corpus_manifest.map((m) => m.pmid)).not.toContain("30000001");
    expect(c.candidates[0].variable_name).toBe("Baseline EDSS");
  });

  it("handles a non-existent project_id gracefully (empty corpus)", async () => {
    const r = await runConfounderIdentification(
      {
        ...RRMS_INPUT,
        project_id: "nonexistent-confounder-project-xyz",
        candidate_extractions: [
          {
            variable_name: "Baseline EDSS",
            source_paper_pmid: "22992073",
            source_location: "Table 1",
          },
        ],
      },
      { verifyCitations: mockVerify({}) },
    );
    const c = r.content as Content;
    expect(c.candidates.length).toBe(0);
    expect(c.rejected_out_of_corpus.length).toBe(1);
  });

  it("does not crash when a closed corpus is empty (graceful)", async () => {
    const r = await runConfounderIdentification(
      {
        ...RRMS_INPUT,
        corpus_papers: [],
        candidate_extractions: [
          {
            variable_name: "Baseline EDSS",
            source_paper_pmid: "22992073",
            source_location: "Table 1",
          },
        ],
      },
      { verifyCitations: mockVerify({}) },
    );
    const c = r.content as Content;
    expect(c.candidates.length).toBe(0);
    expect(c.rejected_out_of_corpus.length).toBe(1);
  });
});
