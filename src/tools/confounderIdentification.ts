import { join } from "node:path";
import { z } from "zod";
import type { ToolResult } from "../providers/types.js";
import {
  createAuditRecord,
  setMethodology,
  addAssumption,
  addWarning,
  addToolCall,
} from "../audit/builder.js";
import {
  buildDisclosure,
  extractDisclosureLevel,
  AI_DISCLOSURE_LEVEL_SCHEMA_PROPERTY,
} from "../formatters/disclosure.js";
import type { VerifyCitationsContent } from "./verifyCitations.js";
import {
  normalizeRaw,
  mapToConsolidated,
  heuristicScan,
  expertInterviewBlock,
} from "../confounder/lexicon.js";

/**
 * confounder_identification (evidence.confounder_identification) — Design log #43.
 *
 * IQWiG / Pufulete 2022 Step 1: systematic identification of candidate
 * confounder variables from a DEFINED corpus, with full provenance.
 *
 * DETERMINISTIC — the MCP server never calls an LLM. The web-tier agent reads
 * each corpus paper and supplies structured `candidate_extractions`; this tool
 * (a) enforces closed-corpus provenance, (b) verifies every cited source via
 * verify_citations, (c) dedupes + proposes consolidation HINTS (never an
 * auto-merge), (d) emits an expert-interview block for confounders literature
 * cannot supply. A keyword-lexicon fallback extractor runs when no candidates
 * are supplied (an offline baseline; low recall by design).
 *
 * Invariants (enforced + tested):
 *   I1 closed_corpus: a candidate citing a paper not in the corpus is REJECTED.
 *   I2 unverified source → provenance "unverified" (never silently HTA-grade).
 *   I3 output is always "draft_for_human_consolidation" — never a complete list.
 */

const CorpusPaperSchema = z
  .object({
    pmid: z.string().optional(),
    doi: z.string().optional(),
    title: z.string().min(1),
    year: z.number().int().optional(),
    abstract: z.string().optional(),
  })
  .strict();

const CandidateExtractionSchema = z
  .object({
    variable_name: z.string().min(1),
    category: z.string().optional(),
    source_paper_pmid: z.string().optional(),
    source_paper_doi: z.string().optional(),
    source_paper_title: z.string().optional(),
    source_location: z.string().min(1),
    verbatim_snippet: z.string().max(200).optional(),
    direction: z
      .enum(["prognostic", "treatment_predictor", "both", "unclear"])
      .optional(),
  })
  .strict();

const ConfounderIdentificationSchema = z
  .object({
    intervention: z.string().min(1),
    comparator: z.string().min(1),
    indication: z.string().min(1),
    population: z.string().optional(),
    outcome: z.string().optional(),
    mode: z.enum(["closed_corpus", "open_search"]).default("closed_corpus"),
    corpus_papers: z.array(CorpusPaperSchema).max(200).optional(),
    candidate_extractions: z.array(CandidateExtractionSchema).max(500).optional(),
    project_id: z.string().optional(),
    literature_sources: z.array(z.string()).optional(),
    runs: z.number().int().min(1).max(3).default(1).optional(),
    ai_disclosure_level: z
      .enum(["off", "standard", "submission"])
      .default("submission")
      .optional(),
  })
  .strict();

type ConfounderInput = z.infer<typeof ConfounderIdentificationSchema>;

interface CorpusPaper {
  pmid?: string;
  doi?: string;
  title: string;
  year?: number;
  abstract?: string;
}

export interface ConfounderCandidate {
  variable_name: string;
  category?: string;
  source_paper: { corpus_key: string; pmid?: string; doi?: string; title: string };
  source_location: string;
  verbatim_snippet?: string;
  direction?: "prognostic" | "treatment_predictor" | "both" | "unclear";
  extraction_method: "agent" | "heuristic";
  provenance: "verified" | "unverified";
}

export interface ConfounderIdentificationContent {
  mode: ConfounderInput["mode"];
  intervention: string;
  comparator: string;
  indication: string;
  candidates: ConfounderCandidate[];
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
    doi?: string;
    title: string;
    year?: number;
    included: boolean;
    exclusion_reason?: string;
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
  status_label: "draft_for_human_consolidation";
  markdown_report: string;
}

export interface ConfounderDeps {
  verifyCitations: (args: {
    citations: Array<{ id?: string; doi?: string; pmid?: string; url?: string }>;
  }) => Promise<ToolResult>;
  literatureSearch?: (args: unknown) => Promise<ToolResult>;
  screenAbstracts?: (args: unknown) => Promise<ToolResult>;
}

function corpusKey(p: { pmid?: string; doi?: string; title: string; year?: number }): string {
  if (p.doi) return `doi:${p.doi.toLowerCase().trim()}`;
  if (p.pmid) return `pmid:${p.pmid.trim()}`;
  return `title:${normalizeRaw(p.title)}|${p.year ?? ""}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function extractPapers(res: ToolResult): Array<Record<string, unknown>> {
  let content: unknown = res.content;
  if (typeof content === "string") {
    try {
      content = JSON.parse(content);
    } catch {
      return [];
    }
  }
  if (!isRecord(content)) return [];
  const results = content.results;
  return Array.isArray(results) ? results.filter(isRecord) : [];
}

function toCorpusPaper(r: Record<string, unknown>): CorpusPaper {
  return {
    pmid: typeof r.pmid === "string" ? r.pmid : undefined,
    doi: typeof r.doi === "string" ? r.doi : undefined,
    title: typeof r.title === "string" ? r.title : "(untitled)",
    year: typeof r.year === "number" ? r.year : undefined,
    abstract: typeof r.abstract === "string" ? r.abstract : undefined,
  };
}

function rawKey(r: Record<string, unknown>): string {
  if (typeof r.doi === "string" && r.doi) return `doi:${r.doi.toLowerCase()}`;
  if (typeof r.pmid === "string" && r.pmid) return `pmid:${r.pmid}`;
  return `title:${normalizeRaw(typeof r.title === "string" ? r.title : "")}`;
}

async function loadProjectCorpus(projectId: string): Promise<CorpusPaper[]> {
  try {
    const [{ getRawLiteratureDir }, { readdir, readFile }] = await Promise.all([
      import("../knowledge/paths.js"),
      import("node:fs/promises"),
    ]);
    const dir = getRawLiteratureDir(projectId);
    const files = await readdir(dir);
    const papers: CorpusPaper[] = [];
    for (const f of files.filter((f) => f.endsWith(".json"))) {
      try {
        const raw = JSON.parse(await readFile(join(dir, f), "utf-8"));
        const arr = Array.isArray(raw)
          ? raw
          : isRecord(raw) && Array.isArray(raw.results)
            ? raw.results
            : [raw];
        for (const r of arr) {
          if (isRecord(r) && typeof r.title === "string") papers.push(toCorpusPaper(r));
        }
      } catch {
        /* skip unparseable file */
      }
    }
    return papers;
  } catch {
    return []; // project missing / unreadable — graceful empty corpus
  }
}

async function buildCorpus(
  input: ConfounderInput,
  deps: ConfounderDeps,
): Promise<{ corpus: CorpusPaper[]; warnings: string[] }> {
  const warnings: string[] = [];

  if (input.mode === "open_search") {
    if (!deps.literatureSearch || !deps.screenAbstracts) {
      warnings.push("open_search requested but literature/screen deps unavailable — empty corpus.");
      return { corpus: [], warnings };
    }
    const query = `${input.intervention} OR ${input.comparator} ${input.indication}`;
    let litRaw: Array<Record<string, unknown>> = [];
    let screenRaw: Array<Record<string, unknown>> = [];
    try {
      litRaw = extractPapers(
        await deps.literatureSearch({
          query,
          sources: input.literature_sources,
          runs: input.runs ?? 3,
          output_format: "json",
        }),
      );
    } catch (e) {
      warnings.push(`literature_search failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      screenRaw = extractPapers(
        await deps.screenAbstracts({
          results: litRaw,
          criteria: {
            population: input.population ?? `patients with ${input.indication}`,
            intervention: input.intervention,
            comparator: input.comparator,
            outcomes: input.outcome ? [input.outcome] : undefined,
          },
          output_format: "json",
        }),
      );
    } catch (e) {
      warnings.push(`screen_abstracts failed: ${e instanceof Error ? e.message : String(e)}`);
      screenRaw = litRaw;
    }
    const includedKeys = new Set(
      screenRaw.filter((r) => r.screening_status !== "exclude").map(rawKey),
    );
    const source = screenRaw.length > 0 ? litRaw : litRaw; // litRaw carries abstracts
    const corpus = source.filter((r) => includedKeys.has(rawKey(r))).map(toCorpusPaper);
    return { corpus, warnings };
  }

  // closed_corpus
  const corpus: CorpusPaper[] = [...(input.corpus_papers ?? [])];
  if (input.project_id) {
    const loaded = await loadProjectCorpus(input.project_id);
    if (loaded.length === 0) {
      warnings.push(
        `project_id "${input.project_id}" contributed 0 papers (missing, empty, or non-JSON raw store). Pass corpus_papers explicitly for guaranteed inclusion.`,
      );
    }
    corpus.push(...loaded);
  }
  return { corpus, warnings };
}

export async function runConfounderIdentification(
  rawInput: unknown,
  deps: ConfounderDeps,
): Promise<ToolResult> {
  const input = ConfounderIdentificationSchema.parse(rawInput);

  let audit = createAuditRecord(
    "evidence.confounder_identification",
    {
      intervention: input.intervention,
      comparator: input.comparator,
      indication: input.indication,
      mode: input.mode,
    } as unknown as Record<string, unknown>,
    "json",
  );
  audit = setMethodology(
    audit,
    "IQWiG / Pufulete 2022 Step 1: deterministic provenance enforcement over agent-supplied candidate_extractions (or a keyword-lexicon fallback). Closed-corpus citations only; every source verified via verify_citations; consolidation emitted as HINTS for human review.",
  );

  // ── Step 1: freeze corpus ──
  const { corpus: rawCorpus, warnings } = await buildCorpus(input, deps);
  for (const w of warnings) audit = addWarning(audit, w);

  // dedup corpus by corpus_key
  const corpusByKey = new Map<string, CorpusPaper>();
  for (const p of rawCorpus) {
    const k = corpusKey(p);
    if (!corpusByKey.has(k)) corpusByKey.set(k, p);
  }

  const corpus_manifest = Array.from(corpusByKey.entries()).map(([corpus_key, p]) => ({
    corpus_key,
    pmid: p.pmid,
    doi: p.doi,
    title: p.title,
    year: p.year,
    included: true,
  }));

  // ── Step 2: gather candidates ──
  const candidates: ConfounderCandidate[] = [];
  const rejected_out_of_corpus: ConfounderIdentificationContent["rejected_out_of_corpus"] = [];

  const hasAgent =
    Array.isArray(input.candidate_extractions) && input.candidate_extractions.length > 0;

  if (hasAgent) {
    for (const c of input.candidate_extractions!) {
      const paper = findCorpusPaper(corpusByKey, c);
      if (!paper) {
        const attempted =
          c.source_paper_pmid
            ? `pmid:${c.source_paper_pmid}`
            : c.source_paper_doi
              ? `doi:${c.source_paper_doi}`
              : c.source_paper_title
                ? `title:${c.source_paper_title}`
                : "(no source identifier)";
        rejected_out_of_corpus.push({
          variable_name: c.variable_name,
          attempted_source: attempted,
          reason:
            input.mode === "closed_corpus"
              ? "Source paper is not in the defined corpus — closed-corpus mode never cites out-of-corpus papers."
              : "Source paper is not among the screened/frozen corpus.",
        });
        continue;
      }
      candidates.push({
        variable_name: c.variable_name,
        category: c.category ?? mapToConsolidated(c.variable_name)?.category,
        source_paper: {
          corpus_key: paper.key,
          pmid: paper.paper.pmid,
          doi: paper.paper.doi,
          title: paper.paper.title,
        },
        source_location: c.source_location,
        verbatim_snippet: c.verbatim_snippet,
        direction: c.direction,
        extraction_method: "agent",
        provenance: "unverified", // set after citation check
      });
    }
  } else {
    // ── deterministic no-LLM fallback ──
    for (const [key, p] of corpusByKey.entries()) {
      const text = `${p.title} ${p.abstract ?? ""}`;
      for (const hit of heuristicScan(text)) {
        candidates.push({
          variable_name: hit.variable_name,
          category: hit.category,
          source_paper: { corpus_key: key, pmid: p.pmid, doi: p.doi, title: p.title },
          source_location: "abstract (heuristic)",
          extraction_method: "heuristic",
          provenance: "unverified",
        });
      }
    }
  }

  // ── Step 4: verify every cited source ──
  const citationCitations = corpus_manifest
    .filter((m) => m.pmid || m.doi)
    .map((m) => ({ id: m.corpus_key, pmid: m.pmid, doi: m.doi }));

  let citation_audit: VerifyCitationsContent = {
    results: [],
    summary: {
      total: 0,
      verified: 0,
      fabricated: 0,
      unverifiable: 0,
      url_only: 0,
      fabrication_count: 0,
      verified_rate: 0,
    },
    text: "",
  };
  const statusByKey = new Map<string, string>();
  if (citationCitations.length > 0) {
    const t0 = Date.now();
    try {
      const vres = await deps.verifyCitations({ citations: citationCitations });
      citation_audit = vres.content as VerifyCitationsContent;
      for (const r of citation_audit.results) {
        const k =
          r.input.id ??
          (r.input.doi ? `doi:${r.input.doi.toLowerCase()}` : r.input.pmid ? `pmid:${r.input.pmid}` : "");
        if (k) statusByKey.set(k, r.status);
      }
      audit = addToolCall(audit, {
        name: "utils.verify_citations",
        ms: Date.now() - t0,
        outcome: "ok",
      });
    } catch (e) {
      audit = addWarning(audit, `verify_citations failed: ${e instanceof Error ? e.message : String(e)}`);
      audit = addToolCall(audit, {
        name: "utils.verify_citations",
        ms: Date.now() - t0,
        outcome: "error",
      });
    }
  }

  for (const cand of candidates) {
    cand.provenance =
      statusByKey.get(cand.source_paper.corpus_key) === "verified" ? "verified" : "unverified";
  }

  // ── Step 5: consolidation HINTS (no auto-merge) ──
  const groups = new Map<string, { label: string; members: Set<string> }>();
  for (const cand of candidates) {
    const hit = mapToConsolidated(cand.variable_name);
    const groupKey = hit?.label ?? normalizeRaw(cand.variable_name);
    const label = hit?.label ?? cand.variable_name;
    if (!groups.has(groupKey)) groups.set(groupKey, { label, members: new Set() });
    groups.get(groupKey)!.members.add(cand.variable_name);
  }
  const consolidation_candidates = Array.from(groups.values())
    .filter((g) => g.members.size >= 2)
    .map((g) => ({ name: g.label, member_variables: Array.from(g.members) }));

  // ── Step 6: expert-interview block ──
  const expert_interview_required = expertInterviewBlock(input.indication);

  // ── Step 7: metrics ──
  const verifiedCount = candidates.filter((c) => c.provenance === "verified").length;
  const agentCount = candidates.filter((c) => c.extraction_method === "agent").length;
  const heuristicCount = candidates.filter((c) => c.extraction_method === "heuristic").length;
  const metrics = {
    candidate_count: candidates.length,
    verified_source_rate:
      candidates.length > 0 ? Math.round((verifiedCount / candidates.length) * 100) / 100 : 0,
    fabrication_count: citation_audit.summary.fabrication_count,
    agent_count: agentCount,
    heuristic_count: heuristicCount,
    consolidation_candidate_count: consolidation_candidates.length,
  };

  if (rejected_out_of_corpus.length > 0) {
    audit = addWarning(
      audit,
      `${rejected_out_of_corpus.length} candidate(s) rejected — cited a paper not in the corpus.`,
    );
  }
  audit = addAssumption(
    audit,
    `${candidates.length} candidate(s) accepted (${agentCount} agent-extracted, ${heuristicCount} heuristic); ${verifiedCount} have a verified source. This is a DRAFT for human consolidation, not a complete confounder set.`,
  );

  const markdown_report = renderMarkdown(input, {
    candidates,
    rejected_out_of_corpus,
    consolidation_candidates,
    expert_interview_required,
    corpus_manifest,
    metrics,
  });

  const level = extractDisclosureLevel(rawInput, "submission");
  const disclosure = buildDisclosure(audit, { level });
  const report = disclosure ? `${markdown_report}\n\n${disclosure}` : markdown_report;

  const content: ConfounderIdentificationContent = {
    mode: input.mode,
    intervention: input.intervention,
    comparator: input.comparator,
    indication: input.indication,
    candidates,
    rejected_out_of_corpus,
    consolidation_candidates,
    expert_interview_required,
    corpus_manifest,
    citation_audit,
    metrics,
    status_label: "draft_for_human_consolidation",
    markdown_report: report,
  };

  return { content, audit };
}

function findCorpusPaper(
  corpusByKey: Map<string, CorpusPaper>,
  c: z.infer<typeof CandidateExtractionSchema>,
): { key: string; paper: CorpusPaper } | undefined {
  for (const [key, p] of corpusByKey.entries()) {
    if (c.source_paper_pmid && p.pmid && p.pmid.trim() === c.source_paper_pmid.trim()) {
      return { key, paper: p };
    }
  }
  for (const [key, p] of corpusByKey.entries()) {
    if (
      c.source_paper_doi &&
      p.doi &&
      p.doi.toLowerCase().trim() === c.source_paper_doi.toLowerCase().trim()
    ) {
      return { key, paper: p };
    }
  }
  for (const [key, p] of corpusByKey.entries()) {
    if (
      c.source_paper_title &&
      normalizeRaw(p.title) === normalizeRaw(c.source_paper_title)
    ) {
      return { key, paper: p };
    }
  }
  return undefined;
}

function renderMarkdown(
  input: ConfounderInput,
  data: Pick<
    ConfounderIdentificationContent,
    | "candidates"
    | "rejected_out_of_corpus"
    | "consolidation_candidates"
    | "expert_interview_required"
    | "corpus_manifest"
    | "metrics"
  >,
): string {
  const lines: string[] = [];
  lines.push(`# Confounder Identification (IQWiG / Pufulete Step 1)`);
  lines.push(``);
  lines.push(
    `**${input.intervention}** vs **${input.comparator}** — ${input.indication}` +
      (input.population ? ` (${input.population})` : ""),
  );
  lines.push(``);
  lines.push(
    `> **Draft for human consolidation.** This is a recall-oriented candidate set (mode: \`${input.mode}\`), **NOT a complete or final confounder set** — IQWiG-style consolidation and expert sign-off remain a human task.`,
  );
  lines.push(``);
  lines.push(
    `**Corpus:** ${data.corpus_manifest.length} paper(s). **Candidates:** ${data.metrics.candidate_count} ` +
      `(${data.metrics.agent_count} agent-extracted, ${data.metrics.heuristic_count} heuristic). ` +
      `**Verified-source rate:** ${Math.round(data.metrics.verified_source_rate * 100)}%. ` +
      `**Fabricated citations:** ${data.metrics.fabrication_count}.`,
  );
  lines.push(``);

  lines.push(`## Candidate confounders`);
  if (data.candidates.length === 0) {
    lines.push(`_No candidates accepted from the defined corpus._`);
  } else {
    lines.push(`| Variable | Category | Source | Location | Provenance | Method |`);
    lines.push(`|----------|----------|--------|----------|------------|--------|`);
    for (const c of data.candidates) {
      const src = c.source_paper.pmid
        ? `PMID ${c.source_paper.pmid}`
        : c.source_paper.doi
          ? c.source_paper.doi
          : c.source_paper.title.slice(0, 30);
      lines.push(
        `| ${c.variable_name} | ${c.category ?? "—"} | ${src} | ${c.source_location} | ${c.provenance} | ${c.extraction_method} |`,
      );
    }
  }
  lines.push(``);

  if (data.consolidation_candidates.length > 0) {
    lines.push(`## Consolidation hints (review — NOT auto-merged)`);
    for (const g of data.consolidation_candidates) {
      lines.push(`- **${g.name}** ← ${g.member_variables.join("; ")}`);
    }
    lines.push(``);
  }

  lines.push(`## Expert interview required (literature cannot supply)`);
  for (const e of data.expert_interview_required) {
    lines.push(`- **${e.variable}** — ${e.reason}`);
  }
  lines.push(``);

  if (data.rejected_out_of_corpus.length > 0) {
    lines.push(`## Rejected — out of corpus (provenance guard)`);
    for (const r of data.rejected_out_of_corpus) {
      lines.push(`- ${r.variable_name} (${r.attempted_source}) — ${r.reason}`);
    }
    lines.push(``);
  }

  return lines.join("\n");
}

export async function handleConfounderIdentification(
  rawInput: unknown,
): Promise<ToolResult> {
  const [{ handleVerifyCitations }, { handleLiteratureSearch }, { handleScreenAbstracts }] =
    await Promise.all([
      import("./verifyCitations.js"),
      import("./literatureSearch.js"),
      import("./screenAbstracts.js"),
    ]);
  return runConfounderIdentification(rawInput, {
    verifyCitations: handleVerifyCitations as ConfounderDeps["verifyCitations"],
    literatureSearch: handleLiteratureSearch as ConfounderDeps["literatureSearch"],
    screenAbstracts: handleScreenAbstracts as ConfounderDeps["screenAbstracts"],
  });
}

export const confounderIdentificationToolSchema = {
  name: "evidence.confounder_identification",
  description:
    "IQWiG / Pufulete 2022 Step 1: systematically identify candidate CONFOUNDER variables for a non-randomised comparison, with full provenance. DETERMINISTIC — you (the agent) read each corpus paper and pass structured `candidate_extractions` (variable_name + source_paper_pmid/doi + source_location + verbatim_snippet); the tool enforces closed-corpus provenance (it NEVER cites a paper outside the corpus), verifies every source via Crossref/PubMed, dedupes, and proposes consolidation HINTS for human review. Emits an expert-interview block for confounders literature cannot supply (patient preference, tolerability). Output is always a DRAFT for human consolidation — never a complete list. Use this for IQWiG/G-BA confounder identification instead of generating confounder lists from memory.",
  annotations: {
    title: "Confounder Identification (IQWiG Step 1)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      intervention: { type: "string", description: "Intervention, e.g. dimethyl fumarate" },
      comparator: { type: "string", description: "Comparator, e.g. glatiramer acetate" },
      indication: { type: "string", description: "Indication, e.g. relapsing-remitting multiple sclerosis" },
      population: { type: "string", description: "Optional population refinement" },
      outcome: { type: "string", description: "Optional primary outcome" },
      mode: {
        type: "string",
        enum: ["closed_corpus", "open_search"],
        description:
          "closed_corpus (default): only cite papers you pass in corpus_papers. open_search: the tool runs literature_search + screen_abstracts and freezes the screened set as the corpus.",
      },
      corpus_papers: {
        type: "array",
        description: "The defined corpus (closed_corpus mode). Each paper: {pmid?, doi?, title, year?, abstract?}.",
        items: {
          type: "object",
          properties: {
            pmid: { type: "string" },
            doi: { type: "string" },
            title: { type: "string" },
            year: { type: "number" },
            abstract: { type: "string" },
          },
          required: ["title"],
        },
      },
      candidate_extractions: {
        type: "array",
        description:
          "Confounder variables YOU extracted from the corpus. Each MUST cite a paper in corpus_papers.",
        items: {
          type: "object",
          properties: {
            variable_name: { type: "string" },
            category: { type: "string" },
            source_paper_pmid: { type: "string" },
            source_paper_doi: { type: "string" },
            source_paper_title: { type: "string" },
            source_location: { type: "string", description: "e.g. 'Table 1 baseline', 'Methods adjustment'" },
            verbatim_snippet: { type: "string", description: "≤200 chars supporting quote" },
            direction: {
              type: "string",
              enum: ["prognostic", "treatment_predictor", "both", "unclear"],
            },
          },
          required: ["variable_name", "source_location"],
        },
      },
      project_id: { type: "string", description: "Optional: also load corpus from a project workspace raw/literature store." },
      literature_sources: {
        type: "array",
        items: { type: "string" },
        description: "Sources for open_search mode (passed to literature_search).",
      },
      runs: { type: "number", description: "Search runs in open_search mode (1-3, default for stability)." },
      ai_disclosure_level: AI_DISCLOSURE_LEVEL_SCHEMA_PROPERTY,
    },
    required: ["intervention", "comparator", "indication"],
  },
};
