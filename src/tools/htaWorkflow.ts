/**
 * hta_workflow — server-side orchestrator that runs the canonical
 * HTA submission pipeline in a single MCP call. Built because generic
 * LLMs (ChatGPT, Claude.ai, Copilot) require 4-5 separate prompts +
 * manual context re-paste to chain literature_search → screen_abstracts
 * → risk_of_bias → cost_effectiveness_model → hta_dossier → validate_links.
 * This tool absorbs the orchestration burden so a single prompt produces
 * the full dossier package.
 *
 * Pipeline (5 phases):
 *   Phase 1 (sequential): literature_search (runs=N for stability)
 *   Phase 2 (sequential): screen_abstracts on PICO criteria
 *   Phase 3 (sequential): risk_of_bias on screened set
 *   Phase 4 (sequential): cost_effectiveness_model with indication-derived defaults
 *   Phase 5 (sequential): hta_dossier consuming evidence + rob + model outputs
 *   Phase 6 (sequential): validate_links on every URL cited across the run
 *
 * Each phase is wrapped in safeRun so a single failure doesn't kill the
 * whole pipeline — the report shows which phase ran, which fell back,
 * and what to do next.
 *
 * See design log #17.
 */
import { z } from "zod";
import {
  addAssumption,
  addWarning,
  createAuditRecord,
  setMethodology,
} from "../audit/builder.js";
import { auditToMarkdown } from "../formatters/markdown.js";
import { suggestForEnum } from "../util/didYouMean.js";
import type { AuditRecord } from "../audit/types.js";
import type { ToolResult } from "../providers/types.js";

const HTA_BODIES = [
  "nice",
  "ema",
  "fda",
  "iqwig",
  "has",
  "jca",
  "gvd",
] as const;
const SUBMISSION_TYPES = [
  "sta",
  "mta",
  "early_access",
  "initial",
  "renewal",
  "variation",
] as const;
const PERSPECTIVES = ["nhs", "us_payer", "societal"] as const;
const DRUG_CLASSES = [
  "monoclonal_antibody",
  "small_molecule",
  "atmp_cell",
  "atmp_gene",
  "atmp_tissue",
  "biosimilar",
  "vaccine",
  "radiopharmaceutical",
  "other",
] as const;
const SOURCES = [
  "pubmed",
  "clinicaltrials",
  "biorxiv",
  "cochrane",
  "nice_ta",
  "cadth_reviews",
  "icer_reports",
  "ispor",
  "wiley",
] as const;

const HtaWorkflowSchema = z
  .object({
    drug: z.string().min(1, "drug is required"),
    indication: z.string().min(1, "indication is required"),
    hta_body: z.enum(HTA_BODIES).default("nice"),
    submission_type: z.enum(SUBMISSION_TYPES).default("sta"),
    perspective: z.enum(PERSPECTIVES).default("nhs"),
    drug_class: z.enum(DRUG_CLASSES).default("small_molecule"),
    is_orphan: z.boolean().default(false),
    pico: z
      .object({
        population: z.string().optional(),
        intervention: z.string().optional(),
        comparator: z.string().optional(),
        outcomes: z.array(z.string()).optional(),
      })
      .optional(),
    ce_inputs: z
      .object({
        drug_cost_annual: z.number().min(0).optional(),
        comparator_cost_annual: z.number().min(0).optional(),
        efficacy_delta: z.number().min(0).max(1).optional(),
        ae_cost: z.number().min(0).optional(),
        admin_cost: z.number().min(0).optional(),
        qaly_on_treatment: z.number().min(0).max(1).optional(),
        qaly_comparator: z.number().min(0).max(1).optional(),
      })
      .optional(),
    sources: z
      .array(z.enum(SOURCES))
      .min(1)
      .default(["pubmed", "clinicaltrials"]),
    max_literature_results: z.number().int().min(1).max(100).default(30),
    literature_runs: z.number().int().min(1).max(5).default(3),
    jurisdictions: z
      .array(z.enum(["de", "fr", "it", "es", "nl", "uk", "eu_other"]))
      .default(["de", "fr", "it", "es", "nl"]),
    skip_ce_model: z
      .boolean()
      .default(false)
      .describe(
        "Skip the cost-effectiveness model phase (e.g., when the dossier is clinical-only).",
      ),
    unmet_need_inputs: z
      .object({
        disease_burden: z
          .object({
            incidence_per_100k: z.number().optional(),
            prevalence_per_100k: z.number().optional(),
            qualitative_summary: z.string().optional(),
          })
          .optional(),
        treatment_landscape: z
          .object({
            current_soc: z.array(z.string()).optional(),
            qualitative_summary: z.string().optional(),
          })
          .optional(),
      })
      .optional()
      .describe(
        "Optional disease burden + treatment landscape inputs for Phase 3.5 (GVD path only). When provided alongside hta_body='gvd', triggers the evidence.unmet_need phase.",
      ),
  })
  .strict();

export type HtaWorkflowInput = z.infer<typeof HtaWorkflowSchema>;

type Handler = (args: unknown) => Promise<unknown>;

export interface HtaWorkflowDeps {
  literatureSearch: Handler;
  screenAbstracts: Handler;
  riskOfBias: Handler;
  costEffectivenessModel: Handler;
  htaDossier: Handler;
  validateLinks: Handler;
  jcaPicoScope?: Handler; // optional — only needed when hta_body=jca
  evidenceUnmetNeed?: Handler; // optional — only used when hta_body=gvd + unmet_need_inputs supplied
}

function isToolResult(x: unknown): x is { content: unknown } {
  return typeof x === "object" && x !== null && "content" in x;
}

function asText(x: unknown): string {
  if (!isToolResult(x)) return "";
  return typeof x.content === "string"
    ? x.content
    : JSON.stringify(x.content, null, 2);
}

async function safeRun<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

interface LiteratureRecord {
  id: string;
  source: string;
  title: string;
  authors: string[];
  date: string;
  study_type?: string;
  abstract: string;
  url: string;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/**
 * Extract literature records from a literature_search ToolResult that
 * was called with output_format="json". The JSON-mode handler returns
 * { content: <stringified JSON> } where the inner JSON has a `results`
 * array. We robustly handle both shapes (object-content and string-content).
 */
function extractLiteratureResults(raw: unknown): LiteratureRecord[] {
  if (!isRecord(raw)) return [];
  const content = (raw as { content?: unknown }).content;
  let parsed: unknown = content;
  if (typeof content === "string") {
    try {
      parsed = JSON.parse(content);
    } catch {
      return [];
    }
  }
  if (!isRecord(parsed)) return [];
  const results = (parsed as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  return results.filter((r): r is LiteratureRecord => isRecord(r));
}

/**
 * Extract URLs from the workflow's output content for the final
 * link-validation phase. We scan a combined Markdown blob for
 * https://… URL patterns. Deduplicates and caps at 50 (the
 * validate_links limit).
 */
const URL_REGEX = /https?:\/\/[^\s)\]"'>]+/g;
function extractUrls(text: string, cap = 50): string[] {
  const urls = new Set<string>();
  for (const m of text.matchAll(URL_REGEX)) {
    // Strip trailing punctuation that's commonly attached in prose.
    const u = m[0].replace(/[.,;:!?]+$/, "");
    urls.add(u);
    if (urls.size >= cap) break;
  }
  return Array.from(urls);
}

export async function runHtaWorkflow(
  rawInput: unknown,
  deps: HtaWorkflowDeps,
): Promise<ToolResult> {
  const parsed = HtaWorkflowSchema.safeParse(rawInput);
  if (!parsed.success) {
    const messages: string[] = [];
    for (const issue of parsed.error.issues) {
      if (
        issue.code === "invalid_enum_value" &&
        typeof issue.received === "string"
      ) {
        const suggestions = suggestForEnum(
          issue.received,
          issue.options as readonly string[],
        );
        messages.push(
          `Invalid ${issue.path.join(".")}: "${issue.received}". Allowed: ${(issue.options as string[]).join(", ")}.${
            suggestions.length
              ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(", ")}?`
              : ""
          }`,
        );
      } else {
        messages.push(`${issue.path.join(".") || "input"}: ${issue.message}`);
      }
    }
    throw new Error(messages.join("\n"));
  }
  const input = parsed.data;

  let audit: AuditRecord = createAuditRecord(
    "hta.workflow",
    input as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "End-to-end HTA submission pipeline: literature_search (runs=N for stability) → screen_abstracts (PICO) → risk_of_bias (RoB 2 / ROBINS-I / AMSTAR-2 auto-instrument) → cost_effectiveness_model (Markov/PartSA + PSA) → hta_dossier (auto-GRADE from RoB output) → validate_links (post-hoc URL audit). Each phase wrapped in safe-run so single-step failures do not abort the pipeline.",
  );

  // JCA-route guard: when hta_body="jca", this orchestrator runs the
  // standard pipeline without calling jca_pico_scope, so the JCA scope
  // eligibility check (Reg 2021/2282 phased rollout) does NOT fire.
  // Surface this so an out-of-scope indication can't silently produce
  // a credible-looking JCA dossier.
  if (input.hta_body === "jca") {
    audit = addWarning(
      audit,
      "hta_body='jca' — this orchestrator does NOT run jca_pico_scope, so the JCA scope eligibility check (Reg 2021/2282: oncology+ATMP from 13 Jan 2025; orphans from 13 Jan 2028; all medicines from 13 Jan 2030) is bypassed. Verify the indication is actually in JCA scope before treating this output as submission-grade. To check scope explicitly, call jca_pico_scope first.",
    );
  }

  if (input.hta_body === "gvd") {
    audit = addAssumption(
      audit,
      "hta_body='gvd' — pipeline runs all 6 phases and emits a Global Value Dossier (13 sections, ISPOR-aligned). " +
        "Phase 3.5 runs evidence.unmet_need when disease_burden or treatment_landscape inputs are supplied. " +
        "The gvd_evidence_pack pipe interface is included in the Phase 5 output for downstream NICE/JCA/AMCP dossiers.",
    );
  }

  const t0 = Date.now();
  const phaseTimings: Record<string, number> = {};

  // ── Phase 1: literature_search ─────────────────────────────────────
  const tLit = Date.now();
  const litQuery = `${input.drug} ${input.indication}`;
  const litRes = await safeRun(() =>
    deps.literatureSearch({
      query: litQuery,
      sources: input.sources,
      max_results: input.max_literature_results,
      runs: input.literature_runs,
      output_format: "json",
    }),
  );
  phaseTimings.literature_search = Date.now() - tLit;
  let literatureRecords: LiteratureRecord[] = [];
  if (litRes.ok) {
    literatureRecords = extractLiteratureResults(litRes.value);
    audit = addAssumption(
      audit,
      `Phase 1 (literature_search) returned ${literatureRecords.length} records across ${input.sources.join(", ")} (${phaseTimings.literature_search}ms).`,
    );
  } else {
    audit = addWarning(
      audit,
      `Phase 1 (literature_search) failed: ${litRes.error}. Downstream phases will fall back to evidence_summary=null.`,
    );
  }

  // ── Phase 2: screen_abstracts ─────────────────────────────────────
  const tScreen = Date.now();
  let screenedRecords: LiteratureRecord[] = literatureRecords;
  if (literatureRecords.length > 0) {
    const screenRes = await safeRun(() =>
      deps.screenAbstracts({
        results: literatureRecords,
        criteria: {
          population:
            input.pico?.population ?? `adults with ${input.indication}`,
          intervention: input.pico?.intervention ?? input.drug,
          comparator: input.pico?.comparator,
          outcomes: input.pico?.outcomes,
        },
        output_format: "json",
      }),
    );
    if (screenRes.ok) {
      // CRITICAL FIX (v1.4.2 code review): screen_abstracts JSON output
      // returns ScreeningResult objects that LACK the `abstract` field.
      // If we passed those straight through to risk_of_bias, RoB
      // inference would silently run on empty abstracts and return
      // "Unclear" for every domain — corrupting GRADE downstream.
      //
      // Instead: extract the included/uncertain IDs from the screening
      // result and re-map them onto the ORIGINAL literatureRecords
      // (which still carry the abstract text).
      const screened = extractLiteratureResults(screenRes.value);
      const includedIds = new Set(
        screened
          .filter((r) => {
            const status = (r as unknown as Record<string, unknown>)
              .screening_status;
            return !status || status === "include" || status === "uncertain";
          })
          .map((r) => String(r.id ?? ""))
          .filter(Boolean),
      );
      const remapped =
        includedIds.size > 0
          ? literatureRecords.filter((r) => includedIds.has(String(r.id ?? "")))
          : [];

      if (remapped.length > 0) {
        screenedRecords = remapped;
        audit = addAssumption(
          audit,
          `Phase 2 (screen_abstracts) included ${remapped.length} of ${literatureRecords.length} records via PICO filter; abstracts preserved for downstream RoB inference.`,
        );
      } else if (screened.length > 0) {
        // Screening returned results but none mapped back to original IDs.
        // Fall back to the unfiltered set with abstracts intact and warn.
        audit = addWarning(
          audit,
          `Phase 2 (screen_abstracts) returned ${screened.length} screened records but none could be re-mapped to original literature IDs (likely an ID-shape mismatch). Falling back to unfiltered ${literatureRecords.length} records with abstracts preserved.`,
        );
      } else {
        // Fallback: if screener returns 0, keep the unfiltered set with a warning.
        audit = addWarning(
          audit,
          `Phase 2 (screen_abstracts) returned 0 included records; falling back to unfiltered ${literatureRecords.length} records for downstream phases.`,
        );
      }
    } else {
      audit = addWarning(
        audit,
        `Phase 2 (screen_abstracts) failed: ${screenRes.error}. Using unfiltered literature for downstream phases.`,
      );
    }
  }
  phaseTimings.screen_abstracts = Date.now() - tScreen;

  // ── Phase 3: risk_of_bias ─────────────────────────────────────────
  const tRob = Date.now();
  let robResults: unknown = undefined;
  let robSummaryText = "";
  if (screenedRecords.length > 0) {
    const robRes = await safeRun(() =>
      deps.riskOfBias({
        studies: screenedRecords.slice(0, 10), // Cap at top-10 for tractable RoB
        instrument: "auto",
        output_format: "json",
      }),
    );
    if (robRes.ok) {
      const robContent = (robRes.value as { content?: unknown }).content;
      if (typeof robContent === "string") {
        try {
          robResults = JSON.parse(robContent);
        } catch {
          robResults = robContent;
        }
      } else {
        robResults = robContent;
      }
      // Best-effort summary line
      if (
        isRecord(robResults) &&
        isRecord((robResults as { summary?: unknown }).summary)
      ) {
        const s = (robResults as { summary: Record<string, unknown> }).summary;
        robSummaryText = `RoB summary: ${s.n_assessed ?? "?"} assessed; instruments: RoB 2 ×${s.rob2_count ?? 0}, ROBINS-I ×${s.robins_i_count ?? 0}, AMSTAR-2 ×${s.amstar2_count ?? 0}; overall judgement: ${s.rob_judgment ?? "n/a"}.`;
      }
      audit = addAssumption(
        audit,
        `Phase 3 (risk_of_bias) assessed ${screenedRecords.slice(0, 10).length} top-included studies.`,
      );
    } else {
      audit = addWarning(
        audit,
        `Phase 3 (risk_of_bias) failed: ${robRes.error}. hta_dossier GRADE will use heuristic estimates instead of structured RoB judgements.`,
      );
    }
  }
  phaseTimings.risk_of_bias = Date.now() - tRob;

  // ── Phase 3.5: evidence.unmet_need (GVD path only) ───────────────
  let unmetNeedSummary: string | undefined;
  if (
    input.hta_body === "gvd" &&
    deps.evidenceUnmetNeed &&
    input.unmet_need_inputs
  ) {
    const tUnmet = Date.now();
    const unmetRes = await safeRun(() =>
      deps.evidenceUnmetNeed!({
        drug: input.drug,
        indication: input.indication,
        jurisdictions: ["global"],
        disease_burden: input.unmet_need_inputs?.disease_burden,
        treatment_landscape: input.unmet_need_inputs?.treatment_landscape
          ? {
              current_soc:
                input.unmet_need_inputs.treatment_landscape.current_soc ?? [],
              qualitative_summary:
                input.unmet_need_inputs.treatment_landscape.qualitative_summary,
            }
          : undefined,
      }),
    );
    if (unmetRes.ok) {
      // evidenceUnmetNeedHandler returns UnmetNeedResult directly
      // (object shape: { schema_version, drug, indication, ..., unmet_need_summary, ... }).
      // We also support a {content: string|object} wrapper for safety, in case
      // the tool is invoked via the MCP envelope (tests, server dispatch).
      const v = unmetRes.value as
        | { unmet_need_summary?: string; content?: unknown }
        | string
        | undefined;
      if (
        v &&
        typeof v === "object" &&
        "unmet_need_summary" in v &&
        typeof v.unmet_need_summary === "string"
      ) {
        unmetNeedSummary = v.unmet_need_summary;
      } else if (v && typeof v === "object" && "content" in v) {
        try {
          const parsed = JSON.parse(
            typeof v.content === "string"
              ? v.content
              : JSON.stringify(v.content),
          );
          unmetNeedSummary = parsed?.unmet_need_summary as string | undefined;
        } catch {
          /* ignore parse errors */
        }
      }
      audit = addAssumption(
        audit,
        unmetNeedSummary
          ? `Phase 3.5 (evidence.unmet_need) generated unmet need summary for ${input.indication}.`
          : `Phase 3.5 (evidence.unmet_need) ran but produced no parseable summary; Section 4 will use placeholder.`,
      );
    } else {
      audit = addWarning(
        audit,
        `Phase 3.5 (evidence.unmet_need) failed: ${unmetRes.error}. GVD Section 4 will use placeholder.`,
      );
    }
    phaseTimings.evidence_unmet_need = Date.now() - tUnmet;
  }

  // ── Phase 4: cost_effectiveness_model ─────────────────────────────
  const tCe = Date.now();
  let ceResults: unknown = undefined;
  let ceSummaryText = "";
  if (!input.skip_ce_model) {
    const ce = input.ce_inputs ?? {};
    const ceRes = await safeRun(() =>
      deps.costEffectivenessModel({
        intervention: input.drug,
        comparator: "standard of care",
        indication: input.indication,
        time_horizon: "lifetime",
        perspective: input.perspective,
        clinical_inputs: {
          efficacy_delta: ce.efficacy_delta ?? 0.25,
        },
        cost_inputs: {
          drug_cost_annual: ce.drug_cost_annual ?? 1000,
          comparator_cost_annual: ce.comparator_cost_annual ?? 0,
          ae_cost: ce.ae_cost ?? 0,
          admin_cost: ce.admin_cost ?? 0,
        },
        utility_inputs:
          ce.qaly_on_treatment !== undefined || ce.qaly_comparator !== undefined
            ? {
                qaly_on_treatment: ce.qaly_on_treatment,
                qaly_comparator: ce.qaly_comparator,
              }
            : undefined,
        psa_iterations: 1000,
        run_psa: true,
        output_format: "json",
      }),
    );
    if (ceRes.ok) {
      const ceContent = (ceRes.value as { content?: unknown }).content;
      if (typeof ceContent === "string") {
        try {
          ceResults = JSON.parse(ceContent);
        } catch {
          ceResults = ceContent;
        }
      } else {
        ceResults = ceContent;
      }
      if (
        isRecord(ceResults) &&
        isRecord((ceResults as { base_case?: unknown }).base_case)
      ) {
        const bc = (ceResults as { base_case: Record<string, unknown> })
          .base_case;
        const icer = bc.icer;
        if (typeof icer === "number") {
          ceSummaryText = `Deterministic ICER: ${input.perspective === "nhs" ? "£" : "$"}${Math.round(icer).toLocaleString()} per QALY.`;
        }
      }
      audit = addAssumption(
        audit,
        `Phase 4 (cost_effectiveness_model) ran 1000-iteration PSA. ${ceSummaryText}`,
      );
    } else {
      audit = addWarning(
        audit,
        `Phase 4 (cost_effectiveness_model) failed: ${ceRes.error}. hta_dossier Economic Evidence Summary will be flagged as gap.`,
      );
    }
  } else {
    audit = addAssumption(
      audit,
      `Phase 4 (cost_effectiveness_model) skipped (skip_ce_model=true).`,
    );
  }
  // Only record CE timing when CE actually ran. Setting it to a small
  // non-zero on the skip path made `phase_timings_ms.cost_effectiveness_model`
  // a misleading proxy for "did CE run?" and caused the skip-path test to
  // be flaky on slower CI.
  if (!input.skip_ce_model) {
    phaseTimings.cost_effectiveness_model = Date.now() - tCe;
  }

  // ── Phase 5: hta_dossier ──────────────────────────────────────────
  const tDossier = Date.now();
  const dossierRes = await safeRun(() =>
    deps.htaDossier({
      hta_body: input.hta_body,
      submission_type: input.submission_type,
      drug_name: input.drug,
      indication: input.indication,
      evidence_summary:
        screenedRecords.length > 0 ? screenedRecords : undefined,
      rob_results: robResults,
      model_results: ceResults,
      unmet_need_summary: unmetNeedSummary,
    }),
  );
  let dossierContent = "";
  if (dossierRes.ok) {
    dossierContent = asText(dossierRes.value);
    audit = addAssumption(
      audit,
      `Phase 5 (hta_dossier) produced ${input.hta_body.toUpperCase()} ${input.submission_type.toUpperCase()} draft with ${screenedRecords.length} cited studies.`,
    );
  } else {
    audit = addWarning(
      audit,
      `Phase 5 (hta_dossier) failed: ${dossierRes.error}.`,
    );
  }
  phaseTimings.hta_dossier = Date.now() - tDossier;

  // ── Phase 6: validate_links ──────────────────────────────────────
  // Scan the dossier output + screened records for URLs, validate up to 50.
  const tValidate = Date.now();
  const urlsFromDossier = extractUrls(dossierContent);
  const urlsFromRecords = screenedRecords.map((r) => r.url).filter(Boolean);
  const allUrls = Array.from(
    new Set([...urlsFromRecords, ...urlsFromDossier]),
  ).slice(0, 50);
  let validationContent = "";
  let validationCounts = { working: 0, browser_only: 0, broken: 0 };
  if (allUrls.length > 0) {
    const valRes = await safeRun(() => deps.validateLinks({ urls: allUrls }));
    if (valRes.ok) {
      validationContent = asText(valRes.value);
      // Best-effort summary extraction
      const valObj = (valRes.value as { content?: unknown }).content;
      const valData =
        typeof valObj === "string"
          ? (() => {
              try {
                return JSON.parse(valObj);
              } catch {
                return null;
              }
            })()
          : valObj;
      if (
        isRecord(valData) &&
        isRecord((valData as { summary?: unknown }).summary)
      ) {
        const s = (valData as { summary: Record<string, unknown> }).summary;
        validationCounts = {
          working: Number(s.working ?? 0),
          browser_only: Number(s.browser_only ?? 0),
          broken: Number(s.broken ?? 0),
        };
      }
      audit = addAssumption(
        audit,
        `Phase 6 (validate_links) checked ${allUrls.length} URLs: ${validationCounts.working} working, ${validationCounts.browser_only} browser-only, ${validationCounts.broken} broken.`,
      );
    } else {
      audit = addWarning(
        audit,
        `Phase 6 (validate_links) failed: ${valRes.error}.`,
      );
    }
  }
  phaseTimings.validate_links = Date.now() - tValidate;

  const totalMs = Date.now() - t0;
  audit = addAssumption(audit, `Total pipeline time: ${totalMs}ms.`);

  // ── Render combined report ───────────────────────────────────────
  const lines: string[] = [];
  lines.push(`# HTA Submission Workflow — ${input.drug} (${input.indication})`);
  lines.push("");
  lines.push(
    `**Pipeline:** literature_search → screen_abstracts → risk_of_bias → cost_effectiveness_model → hta_dossier → validate_links`,
  );
  lines.push(
    `**Target:** ${input.hta_body.toUpperCase()} ${input.submission_type.toUpperCase()} · perspective: ${input.perspective}`,
  );
  lines.push(`**Total time:** ${totalMs}ms · 6 phases`);
  lines.push("");

  lines.push(`## Pipeline summary`);
  lines.push("| Phase | Tool | Time (ms) | Outcome |");
  lines.push("|-------|------|----------:|---------|");
  lines.push(
    `| 1 | literature_search | ${phaseTimings.literature_search ?? 0} | ${literatureRecords.length} records via ${input.sources.join(", ")} |`,
  );
  lines.push(
    `| 2 | screen_abstracts | ${phaseTimings.screen_abstracts ?? 0} | ${screenedRecords.length} included |`,
  );
  lines.push(
    `| 3 | risk_of_bias | ${phaseTimings.risk_of_bias ?? 0} | ${robSummaryText || (robResults ? "assessed" : "skipped")} |`,
  );
  if (phaseTimings.evidence_unmet_need !== undefined) {
    lines.push(
      `| 3.5 | evidence.unmet_need | ${phaseTimings.evidence_unmet_need}ms | ${unmetNeedSummary ? "summary generated" : "skipped"} |`,
    );
  }
  if (input.skip_ce_model) {
    lines.push(`| 4 | cost_effectiveness_model | — | skipped |`);
  } else {
    lines.push(
      `| 4 | cost_effectiveness_model | ${phaseTimings.cost_effectiveness_model ?? 0} | ${ceSummaryText || (ceResults ? "ran" : "failed")} |`,
    );
  }
  lines.push(
    `| 5 | hta_dossier | ${phaseTimings.hta_dossier ?? 0} | ${
      dossierRes.ok
        ? `${input.hta_body.toUpperCase()} ${input.submission_type.toUpperCase()} draft`
        : "FAILED — see audit"
    } |`,
  );
  lines.push(
    `| 6 | validate_links | ${phaseTimings.validate_links ?? 0} | ${validationCounts.working}/${allUrls.length} working, ${validationCounts.broken} broken |`,
  );
  lines.push("");

  // The dossier is the primary user-facing artifact.
  lines.push(`## ${input.hta_body.toUpperCase()} dossier draft`);
  lines.push("");
  lines.push(dossierContent || "_(dossier phase failed — see warnings below)_");
  lines.push("");

  if (validationContent) {
    lines.push(`## URL validation report`);
    lines.push("");
    lines.push(validationContent);
    lines.push("");
  }

  lines.push(`## Audit`);
  lines.push("");
  lines.push(auditToMarkdown(audit));

  return {
    content: lines.join("\n"),
    audit,
    workflow_summary: {
      total_ms: totalMs,
      phase_timings_ms: phaseTimings,
      n_records_searched: literatureRecords.length,
      n_records_screened: screenedRecords.length,
      n_urls_validated: allUrls.length,
      url_validation_counts: validationCounts,
    },
  } as ToolResult & {
    workflow_summary: {
      total_ms: number;
      phase_timings_ms: Record<string, number>;
      n_records_searched: number;
      n_records_screened: number;
      n_urls_validated: number;
      url_validation_counts: typeof validationCounts;
    };
  };
}

/**
 * Production handler — wraps runHtaWorkflow with the real tool handlers
 * imported lazily to avoid circular dependencies.
 */
export async function handleHtaWorkflow(
  rawInput: unknown,
): Promise<ToolResult> {
  const [
    { handleLiteratureSearch },
    { handleScreenAbstracts },
    { handleRiskOfBias },
    { handleCostEffectivenessModel },
    { handleHtaDossierPrep },
    { handleValidateLinks },
    { evidenceUnmetNeedHandler },
  ] = await Promise.all([
    import("./literatureSearch.js"),
    import("./screenAbstracts.js"),
    import("./riskOfBias.js"),
    import("./costEffectivenessModel.js"),
    import("./htaDossierPrep.js"),
    import("./validateLinks.js"),
    import("./evidenceUnmetNeed.js"),
  ]);
  return runHtaWorkflow(rawInput, {
    literatureSearch: handleLiteratureSearch as Handler,
    screenAbstracts: handleScreenAbstracts as Handler,
    riskOfBias: handleRiskOfBias as Handler,
    costEffectivenessModel: handleCostEffectivenessModel as Handler,
    htaDossier: handleHtaDossierPrep as Handler,
    validateLinks: handleValidateLinks as Handler,
    evidenceUnmetNeed: evidenceUnmetNeedHandler as Handler,
  });
}

export const htaWorkflowToolSchema = {
  name: "hta.workflow",
  description:
    "End-to-end HTA submission orchestrator. One call runs literature_search (with PRISMA-style stability via runs=N) → screen_abstracts (PICO filter) → risk_of_bias (auto RoB 2/ROBINS-I/AMSTAR-2) → cost_effectiveness_model (Markov + 1k PSA, defaults from indication) → hta_dossier (auto-GRADE downgrade from RoB output) → validate_links (post-hoc URL audit). Returns a combined report with per-phase timings, the full dossier draft, and the URL validation table. Use as a single-shot drop-in replacement for the 4-5 separate prompts a generic LLM would need to chain these tools manually. Each phase wrapped in safe-run so single-step failures do not abort the pipeline.",
  annotations: {
    title: "HTA Submission Workflow Orchestrator",
    readOnlyHint: true,
    destructiveHint: false,
    // Stochastic Phase 4 PSA + live external API calls (PubMed,
    // ClinicalTrials.gov, validate_links HTTP) make this NOT idempotent
    // and definitively open-world. Caching by MCP clients on the
    // idempotent hint would return stale CE estimates.
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      drug: { type: "string", description: "Drug or intervention name." },
      indication: {
        type: "string",
        description: "Disease or condition (free text).",
      },
      hta_body: {
        type: "string",
        enum: HTA_BODIES,
        default: "nice",
        description: "Target HTA body for the dossier draft.",
      },
      submission_type: {
        type: "string",
        enum: SUBMISSION_TYPES,
        default: "sta",
      },
      perspective: {
        type: "string",
        enum: PERSPECTIVES,
        default: "nhs",
        description:
          "Economic perspective for the cost-effectiveness model phase.",
      },
      drug_class: {
        type: "string",
        enum: DRUG_CLASSES,
        default: "small_molecule",
      },
      is_orphan: {
        type: "boolean",
        default: false,
        description:
          "Orphan-designated medicinal product. Affects JCA scope eligibility (orphans enter JCA scope 2028 vs 2030 for general medicinal products).",
      },
      pico: {
        type: "object",
        properties: {
          population: { type: "string" },
          intervention: { type: "string" },
          comparator: { type: "string" },
          outcomes: { type: "array", items: { type: "string" } },
        },
        description:
          "Optional PICO criteria for the screening phase (defaults derived from drug + indication).",
      },
      ce_inputs: {
        type: "object",
        description:
          "Optional cost-effectiveness model inputs. Sensible defaults applied when omitted (efficacy_delta=0.25; drug_cost_annual=1000; SoC=0).",
        properties: {
          drug_cost_annual: { type: "number", minimum: 0 },
          comparator_cost_annual: { type: "number", minimum: 0 },
          efficacy_delta: { type: "number", minimum: 0, maximum: 1 },
          ae_cost: { type: "number", minimum: 0 },
          admin_cost: { type: "number", minimum: 0 },
          qaly_on_treatment: { type: "number", minimum: 0, maximum: 1 },
          qaly_comparator: { type: "number", minimum: 0, maximum: 1 },
        },
      },
      sources: {
        type: "array",
        items: { type: "string", enum: SOURCES },
        default: ["pubmed", "clinicaltrials"],
      },
      max_literature_results: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: 30,
      },
      literature_runs: {
        type: "number",
        minimum: 1,
        maximum: 5,
        default: 3,
        description:
          "Number of dedup-stability passes for the literature_search phase. 3 is the project default for HTA-grade reproducibility.",
      },
      jurisdictions: {
        type: "array",
        items: {
          type: "string",
          enum: ["de", "fr", "it", "es", "nl", "uk", "eu_other"],
        },
        default: ["de", "fr", "it", "es", "nl"],
      },
      skip_ce_model: {
        type: "boolean",
        default: false,
        description:
          "Skip the cost-effectiveness model phase (e.g., for clinical-only dossiers).",
      },
    },
    required: ["drug", "indication"],
  },
} as const;
