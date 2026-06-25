/**
 * GA23-02 confounder-identification benchmark — Design log #43.
 *
 * Scores confounder_identification (closed_corpus) against the IQWiG GA23-02
 * ground truth (132 individual -> 26 consolidated + 2 expert-only).
 *
 * CI run: a MOCK 5-paper corpus (offline, deterministic). verify_citations is
 * dependency-injected to return "verified" for all sources, so any fabrication
 * the tool surfaces would be a real defect.
 *
 * A full live-corpus run is gated behind RUN_BENCHMARK=1.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  runConfounderIdentification,
  type ConfounderDeps,
} from "../../src/tools/confounderIdentification.js";
import { mapToConsolidated } from "../../src/confounder/lexicon.js";
import type { ToolResult } from "../../src/providers/types.js";
import type { VerifyCitationsContent } from "../../src/tools/verifyCitations.js";

const GROUND_TRUTH = JSON.parse(
  readFileSync(
    join(process.cwd(), "fixtures", "iqwig-ga23-02-ground-truth.json"),
    "utf-8",
  ),
) as {
  consolidated_confounders: string[];
  unmeasurable_expert_only: string[];
  individual_variables: string[];
};

// verify_citations stub — every source verifies.
const allVerified: ConfounderDeps["verifyCitations"] = async ({ citations }) => {
  const results: VerifyCitationsContent["results"] = citations.map((c) => ({
    input: c,
    status: "verified",
    crossref_ok: !!c.doi,
    pubmed_ok: !!c.pmid,
    source: "pubmed",
    message: "",
    checked_at: "2026-06-25T00:00:00.000Z",
  }));
  return {
    content: {
      results,
      summary: {
        total: results.length,
        verified: results.length,
        fabricated: 0,
        unverifiable: 0,
        url_only: 0,
        fabrication_count: 0,
        verified_rate: 1,
      },
      text: "",
    } satisfies VerifyCitationsContent,
    audit: { tool: "utils.verify_citations" } as ToolResult["audit"],
  };
};

// Mock 5-paper RRMS corpus (illustrative PMIDs).
const CORPUS = [
  { pmid: "22992073", title: "Placebo-controlled phase 3 study of oral BG-12 in RRMS (DEFINE)", year: 2012 },
  { pmid: "22992074", title: "Comparator-controlled study of BG-12 and glatiramer acetate (CONFIRM)", year: 2012 },
  { pmid: "26432685", title: "ENDORSE long-term extension of dimethyl fumarate in RRMS", year: 2015 },
  { pmid: "28235177", title: "Comparative effectiveness of DMF vs GA in an MS registry", year: 2017 },
  { pmid: "23399041", title: "Glatiramer acetate 40 mg three times weekly in RRMS (GALA)", year: 2013 },
];

// 16 agent-extracted candidates spread across the 5 papers.
const CANDIDATES = [
  { variable_name: "Age at baseline", source_paper_pmid: "22992073", source_location: "Table 1 baseline" },
  { variable_name: "Sex", source_paper_pmid: "22992073", source_location: "Table 1 baseline" },
  { variable_name: "Baseline body weight", source_paper_pmid: "22992073", source_location: "Table 1 baseline" },
  { variable_name: "Race", source_paper_pmid: "22992074", source_location: "Table 1 baseline" },
  { variable_name: "Disease duration", source_paper_pmid: "22992074", source_location: "Table 1 baseline" },
  { variable_name: "Time since diagnosis", source_paper_pmid: "22992074", source_location: "Table 1 baseline" },
  { variable_name: "Baseline EDSS score", source_paper_pmid: "22992073", source_location: "Table 1 baseline" },
  { variable_name: "Number of relapses in prior year", source_paper_pmid: "26432685", source_location: "Methods adjustment" },
  { variable_name: "Annualised relapse rate", source_paper_pmid: "26432685", source_location: "Methods adjustment" },
  { variable_name: "Gadolinium-enhancing lesion count", source_paper_pmid: "26432685", source_location: "Table 2 MRI" },
  { variable_name: "T2 lesion volume", source_paper_pmid: "26432685", source_location: "Table 2 MRI" },
  { variable_name: "Number of prior DMTs", source_paper_pmid: "28235177", source_location: "Methods adjustment" },
  { variable_name: "Treatment-naive vs experienced", source_paper_pmid: "28235177", source_location: "Methods adjustment" },
  { variable_name: "Comorbid depression", source_paper_pmid: "28235177", source_location: "Table 1 baseline" },
  { variable_name: "MS disease course (RRMS vs SPMS)", source_paper_pmid: "23399041", source_location: "Table 1 baseline" },
  { variable_name: "SDMT cognitive score", source_paper_pmid: "23399041", source_location: "Table 1 baseline" },
];

type Content = {
  candidates: Array<{ variable_name: string; provenance: string }>;
  rejected_out_of_corpus: unknown[];
  metrics: { candidate_count: number; verified_source_rate: number; fabrication_count: number };
};

describe("GA23-02 confounder benchmark (mock corpus)", () => {
  it("scores recall/precision with zero fabrication", async () => {
    const r = await runConfounderIdentification(
      {
        intervention: "dimethyl fumarate",
        comparator: "glatiramer acetate",
        indication: "relapsing-remitting multiple sclerosis",
        mode: "closed_corpus",
        corpus_papers: CORPUS,
        candidate_extractions: CANDIDATES,
      },
      { verifyCitations: allVerified },
    );
    const c = r.content as Content;

    // map each candidate to its consolidated confounder, keep those in the GT set
    const covered = new Set<string>();
    let mappedToGt = 0;
    for (const cand of c.candidates) {
      const label = mapToConsolidated(cand.variable_name)?.label;
      if (label && GROUND_TRUTH.consolidated_confounders.includes(label)) {
        covered.add(label);
        mappedToGt++;
      }
    }
    const recall = covered.size / GROUND_TRUTH.consolidated_confounders.length;
    const precision = c.candidates.length > 0 ? mappedToGt / c.candidates.length : 0;

    // eslint-disable-next-line no-console
    console.log(
      `[GA23-02 benchmark] candidates=${c.candidates.length} ` +
        `consolidated-recall=${(recall * 100).toFixed(0)}% ` +
        `(${covered.size}/${GROUND_TRUTH.consolidated_confounders.length}) ` +
        `precision-proxy=${(precision * 100).toFixed(0)}% ` +
        `fabrication=${c.metrics.fabrication_count}`,
    );

    // Zero fabrication is the hard gate (the article's headline claim).
    expect(c.metrics.fabrication_count).toBe(0);
    // All cited papers are in-corpus -> nothing rejected.
    expect(c.rejected_out_of_corpus.length).toBe(0);
    // Every supplied source verified.
    expect(c.metrics.verified_source_rate).toBe(1);
    // Meaningful, non-brittle regression gates.
    expect(recall).toBeGreaterThanOrEqual(0.5);
    expect(precision).toBeGreaterThanOrEqual(0.8);
    // Candidates all retained (no auto-merge).
    expect(c.candidates.length).toBe(CANDIDATES.length);
  });

  it("the fixture is well-formed (132 -> 26 + 2)", () => {
    expect(GROUND_TRUTH.individual_variables.length).toBe(132);
    expect(GROUND_TRUTH.consolidated_confounders.length).toBe(26);
    expect(GROUND_TRUTH.unmeasurable_expert_only.length).toBe(2);
  });
});

// Full live-corpus run (real Crossref/PubMed + a real 35-paper corpus) —
// opt-in only. Wire a real corpus + handleVerifyCitations here when running it.
const liveDescribe = process.env.RUN_BENCHMARK ? describe : describe.skip;
liveDescribe("GA23-02 confounder benchmark (LIVE corpus)", () => {
  it.todo("score against the full GA23-02 corpus with live verify_citations");
});
