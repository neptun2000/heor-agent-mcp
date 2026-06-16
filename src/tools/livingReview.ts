// heor-agent-mcp/src/tools/livingReview.ts
/**
 * literature.living_review — protocol-locked living SLR with delta refresh.
 *
 * The MCP tool is STATELESS (design log #39, Q1): it never reads or writes
 * persistent storage. `init` runs a baseline literature.search and returns the
 * locked protocol + baseline records for the CALLER to persist; `refresh`
 * takes the protocol + the caller's previous_records, re-runs the search, and
 * returns the delta (new/dropped records, a deterministic material-change
 * flag, recommended downstream re-runs, and the next-refresh date). Cadence is
 * driven by the host (Vercel Cron), not an in-server timer.
 */
import { z } from "zod";
import { createAuditRecord, addToolCall } from "../audit/builder.js";
import {
  buildDisclosure,
  extractDisclosureLevel,
  AI_DISCLOSURE_LEVEL_SCHEMA_PROPERTY,
} from "../formatters/disclosure.js";

export type LivingReviewCadence =
  | "monthly"
  | "quarterly"
  | "half_yearly"
  | "annual"
  | "conference_adhoc";

export interface LivingReviewRecord {
  id: string;
  source: string;
  title: string;
  authors: string[];
  date: string;
  study_type?: string;
  abstract: string;
  url: string;
}

const protocolSchema = z.object({
  research_question: z.string().min(1),
  pico: z
    .object({
      population: z.string().optional(),
      intervention: z.string().optional(),
      comparator: z.string().optional(),
      outcomes: z.string().optional(),
    })
    .optional(),
  eligibility: z
    .object({
      include: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
    })
    .optional(),
  sources: z.array(z.string()).optional(),
  search_terms: z.string().optional(),
  runs: z.number().int().min(1).max(5).default(3),
});

export const livingReviewSchema = z.object({
  mode: z.enum(["init", "refresh"]),
  protocol: protocolSchema,
  previous_records: z.array(z.any()).optional(),
  prior_run_index: z.number().int().nonnegative().optional(),
  review_id: z.string().optional(),
  recommended_cadence: z
    .enum(["monthly", "quarterly", "half_yearly", "annual", "conference_adhoc"])
    .default("quarterly"),
  as_of: z.string().optional(),
  new_records_threshold: z.number().int().positive().default(5),
  ai_disclosure_level: z.enum(["off", "standard", "submission"]).optional(),
});

export type LivingReviewInput = z.input<typeof livingReviewSchema>;
export type LivingReviewParams = z.infer<typeof livingReviewSchema>;

// ── Stable record identity ────────────────────────────────────────────────
// Prefer the source-stable id; fall back to normalised title + publication
// year so a record without an id still diffs consistently across runs.
function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

export function recordKey(r: LivingReviewRecord): string {
  const id = (r.id ?? "").trim();
  if (id) return `id:${id}`;
  const year = (r.date ?? "").slice(0, 4);
  return `t:${normalizeTitle(r.title ?? "")}:${year}`;
}

export function diffRecordSets(
  prev: LivingReviewRecord[],
  next: LivingReviewRecord[],
): { added: LivingReviewRecord[]; removed: LivingReviewRecord[] } {
  const prevKeys = new Set(prev.map(recordKey));
  const nextKeys = new Set(next.map(recordKey));
  const added = next.filter((r) => !prevKeys.has(recordKey(r)));
  const removed = prev.filter((r) => !nextKeys.has(recordKey(r)));
  return { added, removed };
}

// ── Materiality (deterministic rules over the newly-added records) ─────────
const RCT_TERMS = [
  "randomized",
  "randomised",
  "rct",
  "phase 3",
  "phase iii",
  "phase 2/3",
];
const LATE_BREAKER_TERMS = [
  "late-break",
  "late break",
  "esmo",
  "asco",
  "easl",
  "aacr",
  "ash ",
];

function isRct(r: LivingReviewRecord): boolean {
  const st = (r.study_type ?? "").toLowerCase();
  if (st === "rct" || st.includes("randomi")) return true;
  const t = (r.title ?? "").toLowerCase();
  return RCT_TERMS.some((term) => t.includes(term));
}

function isLateBreaker(r: LivingReviewRecord): boolean {
  const hay =
    `${r.title ?? ""} ${r.abstract ?? ""} ${r.source ?? ""}`.toLowerCase();
  return LATE_BREAKER_TERMS.some((term) => hay.includes(term));
}

export function assessMateriality(
  added: LivingReviewRecord[],
  threshold: number,
): { material: boolean; reasons: string[]; recommended_downstream: string[] } {
  const reasons: string[] = [];
  if (added.some(isRct)) {
    reasons.push("A new RCT entered the evidence base.");
  }
  if (added.length >= threshold) {
    reasons.push(
      `${added.length} new records this refresh (threshold ${threshold}).`,
    );
  }
  if (added.some(isLateBreaker)) {
    reasons.push("A conference late-breaker was identified.");
  }
  const material = reasons.length > 0;
  return {
    material,
    reasons,
    recommended_downstream: material
      ? ["evidence_network", "itc_feasibility"]
      : [],
  };
}

// ── Cadence → next refresh date ────────────────────────────────────────────
// Conference dates are APPROXIMATE and must be re-verified annually
// (Phase 0 WebFetch per CLAUDE.md). Bump CONFERENCE_CALENDAR_REVISION on edit.
export const CONFERENCE_CALENDAR_REVISION = "2026-06-16";
export const CONFERENCE_CALENDAR: string[] = [
  "2026-09-12", // ESMO 2026 (approx)
  "2026-11-09", // AASLD The Liver Meeting 2026 (approx)
  "2027-05-29", // ASCO 2027 (approx)
  "2027-06-23", // EASL 2027 (approx)
  "2027-09-18", // ESMO 2027 (approx)
];

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const zeroBased = m - 1 + months;
  const newYear = y + Math.floor(zeroBased / 12);
  const newMonth = ((zeroBased % 12) + 12) % 12; // 0-based
  const daysInMonth = new Date(newYear, newMonth + 1, 0).getDate();
  const day = Math.min(d, daysInMonth);
  const mm = String(newMonth + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${newYear}-${mm}-${dd}`;
}

export function computeNextRefresh(
  asOf: string,
  cadence: LivingReviewCadence,
): string {
  switch (cadence) {
    case "monthly":
      return addMonths(asOf, 1);
    case "quarterly":
      return addMonths(asOf, 3);
    case "half_yearly":
      return addMonths(asOf, 6);
    case "annual":
      return addMonths(asOf, 12);
    case "conference_adhoc": {
      const next = [...CONFERENCE_CALENDAR].sort().find((dt) => dt > asOf);
      // If the static calendar is exhausted, fall back to a quarterly cadence.
      return next ?? addMonths(asOf, 3);
    }
  }
}

// ── Handler (stateless; deps-injected literature.search) ───────────────────
type Handler = (args: Record<string, unknown>) => Promise<unknown>;

export interface LivingReviewDeps {
  literatureSearch: Handler;
}

export interface LivingReviewResult {
  schema_version: "1.0";
  mode: "init" | "refresh";
  review_id?: string;
  run_index: number;
  records: LivingReviewRecord[];
  new_records: LivingReviewRecord[];
  dropped_records: LivingReviewRecord[];
  prisma_delta: { new: number; dropped: number; total_now: number };
  material_change: boolean;
  material_reasons: string[];
  recommended_downstream: string[];
  recommended_cadence: LivingReviewCadence;
  next_refresh_due: string;
  markdown_section: string;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function extractLiteratureResults(raw: unknown): LivingReviewRecord[] {
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
  return results.filter((r): r is LivingReviewRecord => isRecord(r));
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function renderLivingReview(
  res: Omit<LivingReviewResult, "markdown_section">,
  researchQuestion: string,
): string {
  const lines: string[] = [];
  const head =
    res.mode === "init" ? "Living SLR baseline" : "Living SLR refresh";
  lines.push(
    `## ${head} — run ${res.run_index}${res.review_id ? ` (${res.review_id})` : ""}`,
  );
  lines.push("");
  lines.push(`**Protocol:** ${researchQuestion}`);
  lines.push(
    `**Δ:** +${res.prisma_delta.new} new · −${res.prisma_delta.dropped} dropped · ${res.prisma_delta.total_now} total`,
  );
  if (res.material_change) {
    lines.push(`**⚠ Material change:** ${res.material_reasons.join(" ")}`);
    lines.push(
      `**Recommended re-run:** ${res.recommended_downstream.join(" → ")}`,
    );
  } else if (res.mode === "refresh") {
    lines.push("**Material change:** none — no re-run required.");
  }
  lines.push(
    `**Next refresh due:** ${res.next_refresh_due} (${res.recommended_cadence})`,
  );
  if (res.new_records.length > 0) {
    lines.push("");
    lines.push("### New records");
    res.new_records.slice(0, 25).forEach((r) => {
      lines.push(
        `- ${r.title} — ${r.source}, ${r.date}${r.url ? ` (${r.url})` : ""}`,
      );
    });
    if (res.new_records.length > 25) {
      lines.push(`- …and ${res.new_records.length - 25} more.`);
    }
  }
  return lines.join("\n").trim();
}

export async function runLivingReview(
  rawInput: LivingReviewInput,
  deps: LivingReviewDeps,
): Promise<LivingReviewResult> {
  const params = livingReviewSchema.parse(rawInput);
  const asOf = params.as_of ?? todayISO();
  const query =
    params.protocol.search_terms ?? params.protocol.research_question;

  const searchArgs: Record<string, unknown> = {
    query,
    runs: params.protocol.runs,
    output_format: "json",
  };
  if (params.protocol.sources) searchArgs.sources = params.protocol.sources;

  const raw = await deps.literatureSearch(searchArgs);
  const nextRecords = extractLiteratureResults(raw);

  const isInit = params.mode === "init";
  const prev: LivingReviewRecord[] = isInit
    ? []
    : (params.previous_records ?? []);
  const { added, removed } = diffRecordSets(prev, nextRecords);

  const runIndex = isInit ? 1 : (params.prior_run_index ?? 1) + 1;

  const materiality = isInit
    ? {
        material: false,
        reasons: [] as string[],
        recommended_downstream: [] as string[],
      }
    : assessMateriality(added, params.new_records_threshold);

  const base: Omit<LivingReviewResult, "markdown_section"> = {
    schema_version: "1.0",
    mode: params.mode,
    ...(params.review_id ? { review_id: params.review_id } : {}),
    run_index: runIndex,
    records: nextRecords,
    new_records: added,
    dropped_records: removed,
    prisma_delta: {
      new: added.length,
      dropped: removed.length,
      total_now: nextRecords.length,
    },
    material_change: materiality.material,
    material_reasons: materiality.reasons,
    recommended_downstream: materiality.recommended_downstream,
    recommended_cadence: params.recommended_cadence,
    next_refresh_due: computeNextRefresh(asOf, params.recommended_cadence),
  };

  let markdown = renderLivingReview(base, params.protocol.research_question);

  const level = extractDisclosureLevel(rawInput, "standard");
  let audit = createAuditRecord(
    "literature.living_review",
    { mode: params.mode, review_id: params.review_id },
    "markdown",
    "Protocol-locked living SLR delta refresh (design log #39).",
  );
  audit = addToolCall(audit, {
    name: "literature.search",
    ms: 0,
    outcome: "ok",
  });
  const disclosure = buildDisclosure(audit, { level });
  if (disclosure) markdown = `${markdown}\n\n${disclosure}`;

  return { ...base, markdown_section: markdown };
}

export async function handleLivingReview(
  input: LivingReviewInput,
): Promise<LivingReviewResult> {
  const { handleLiteratureSearch } = await import("./literatureSearch.js");
  return runLivingReview(input, {
    literatureSearch: handleLiteratureSearch as unknown as Handler,
  });
}

export const livingReviewToolSchema = {
  name: "literature.living_review",
  description:
    "Protocol-locked LIVING systematic literature review with delta refresh. Stateless: the tool never stores anything — the caller persists state. Two modes: 'init' locks a protocol, runs a baseline literature.search, and returns the baseline records for you to persist; 'refresh' takes the protocol + your previous_records, re-runs the search, and returns the delta (new/dropped records, a deterministic material-change flag, recommended downstream re-runs, and the next-refresh date). Material change fires on: a new RCT, ≥ threshold new records, or a conference late-breaker. Cadence (monthly/quarterly/half_yearly/annual/conference_adhoc) is a recommendation surfaced to your scheduler (e.g. Vercel Cron) — there is no in-server timer. Pipe a material refresh into evidence_network / itc_feasibility. Design log #39.",
  annotations: {
    title: "Living Systematic Review",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    required: ["mode", "protocol"],
    properties: {
      mode: {
        type: "string",
        enum: ["init", "refresh"],
        description:
          "'init' = lock protocol + baseline search; 'refresh' = re-run + diff vs previous_records.",
      },
      protocol: {
        type: "object",
        required: ["research_question"],
        properties: {
          research_question: { type: "string" },
          pico: {
            type: "object",
            properties: {
              population: { type: "string" },
              intervention: { type: "string" },
              comparator: { type: "string" },
              outcomes: { type: "string" },
            },
          },
          eligibility: {
            type: "object",
            properties: {
              include: { type: "array", items: { type: "string" } },
              exclude: { type: "array", items: { type: "string" } },
            },
          },
          sources: { type: "array", items: { type: "string" } },
          search_terms: {
            type: "string",
            description: "Overrides research_question as the search query.",
          },
          runs: {
            type: "number",
            default: 3,
            description: "literature.search stability runs (1–5).",
          },
        },
      },
      previous_records: {
        type: "array",
        items: { type: "object" },
        description:
          "refresh only — the prior run's record set, from your store (e.g. Supabase).",
      },
      prior_run_index: {
        type: "number",
        description: "refresh only — the prior run_index for bookkeeping.",
      },
      review_id: {
        type: "string",
        description:
          "Opaque label for your bookkeeping; the server never looks it up.",
      },
      recommended_cadence: {
        type: "string",
        enum: [
          "monthly",
          "quarterly",
          "half_yearly",
          "annual",
          "conference_adhoc",
        ],
        default: "quarterly",
      },
      as_of: {
        type: "string",
        description:
          "ISO date the refresh runs (defaults to today); drives next_refresh_due.",
      },
      new_records_threshold: {
        type: "number",
        default: 5,
        description: "Material-change threshold for new-record count.",
      },
      ai_disclosure_level: AI_DISCLOSURE_LEVEL_SCHEMA_PROPERTY,
    },
  },
};
