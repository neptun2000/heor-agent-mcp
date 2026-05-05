/**
 * pv_signal_workflow — EMA GVP Module IX rev 2 signal management.
 *
 * Given drug-AE case counts from EudraVigilance / FAERS / national PV
 * databases, compute disproportionality statistics (PRR, ROR, IC, MGPS),
 * decide a signal verdict, and emit canonical RMP signal-section text.
 *
 * Pure logic, no I/O. Pairs with pv_classify (planned-study classifier).
 * See design log #14.
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
import { computeAllStats, decideVerdict } from "../pv/signalDecision.js";
import { GVP_REVISION } from "../pv/gvpModules.js";
import type { ToolResult } from "../providers/types.js";

const DATA_SOURCES = [
  "eudravigilance",
  "faers",
  "vigibase_who",
  "national_db",
  "spontaneous_internal",
] as const;

const PvSignalWorkflowSchema = z
  .object({
    drug: z.string().min(1, "drug is required"),
    indication: z.string().min(1, "indication is required"),
    reporting_period_months: z.number().int().min(1).max(120).default(12),
    case_counts: z
      .object({
        drug_event: z.number().int().nonnegative(),
        drug_total: z.number().int().nonnegative(),
        event_total: z.number().int().nonnegative(),
        grand_total: z.number().int().nonnegative(),
      })
      .refine((d) => d.drug_total >= d.drug_event, {
        message:
          "drug_total must be >= drug_event (cell b = drug_total - drug_event would be negative)",
      })
      .refine((d) => d.event_total >= d.drug_event, {
        message:
          "event_total must be >= drug_event (cell c = event_total - drug_event would be negative)",
      })
      .refine(
        (d) => d.grand_total >= d.drug_total + (d.event_total - d.drug_event),
        {
          message:
            "grand_total too small — cell d = grand_total - drug_total - (event_total - drug_event) would be negative. Check that all 4 counts come from the same database.",
        },
      ),
    data_source: z.enum(DATA_SOURCES).default("eudravigilance"),
    pregnancy_exposure: z.boolean().default(false),
    prior_known_signals: z.array(z.string()).default([]),
    reported_event: z
      .string()
      .optional()
      .describe(
        "Optional: the specific adverse event being scored (e.g., 'lactic acidosis'). REQUIRED to enable previously_known_signal classification — without it, the tool cannot determine whether the disproportionality applies to a known event vs a new one. When omitted with prior_known_signals non-empty, output emits a warning and treats the case as a potentially new signal.",
      ),
    outcome_serious: z.boolean().default(false),
    rmp_has_pregnancy_concern: z.boolean().default(false),
  })
  .strict();

export async function handlePvSignalWorkflow(
  rawInput: unknown,
): Promise<ToolResult> {
  const parsed = PvSignalWorkflowSchema.safeParse(rawInput);
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

  let audit = createAuditRecord(
    "pv.signal_workflow",
    input as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "EMA GVP Module IX rev 2 (Signal management); EU Implementing Reg. 2025/1466 (mandatory EVDAS integration from 2026-02-12); Evans 2001 (PRR); van Puijenbroek 2002 (ROR); Bate 1998 / Norén 2006 (IC, BCPNN); DuMouchel 1999 (MGPS, EBGM, gamma-Poisson shrinkage). GVP Considerations P.III for pregnancy follow-up gating.",
  );

  const stats = computeAllStats(input.case_counts, input.outcome_serious);
  const verdict = decideVerdict({
    stats,
    prior_known_signals: input.prior_known_signals,
    reported_event: input.reported_event,
    outcome_serious: input.outcome_serious,
  });

  // Honest-API guard: when caller has prior_known_signals but didn't supply
  // reported_event, we cannot match the disproportionality to a specific
  // known signal. Surface this in the audit so reviewers see we treated it
  // as a potentially new signal rather than silently suppressing it.
  if (
    input.prior_known_signals.length > 0 &&
    !input.reported_event &&
    [
      stats.prr.threshold_met,
      stats.ror.threshold_met,
      stats.ic.threshold_met,
      stats.mgps.threshold_met,
    ].filter(Boolean).length >= 2
  ) {
    audit = addWarning(
      audit,
      "prior_known_signals supplied but reported_event missing — cannot match to a specific known signal. Verdict treats this as a potentially new signal. Re-run with reported_event to enable previously_known_signal classification.",
    );
  }

  audit = addAssumption(
    audit,
    `${stats.thresholds_used} thresholds applied. ${
      [
        stats.prr.threshold_met,
        stats.ror.threshold_met,
        stats.ic.threshold_met,
        stats.mgps.threshold_met,
      ].filter(Boolean).length
    }/4 methods triggered.`,
  );
  if (verdict === "confirmed_signal") {
    audit = addWarning(
      audit,
      `Confirmed signal — recommend PRAC notification, RMP signal-section update, ICSR review.`,
    );
  }

  const wantsPregnancyFollowup =
    input.pregnancy_exposure && input.rmp_has_pregnancy_concern;
  const pregnancy_followup = wantsPregnancyFollowup
    ? {
        timepoints: ["birth", "3_months", "12_months"] as const,
        followup_protocol_ref: "GVP-P.III-2026",
        structured_data_required: [
          "pregnancy outcome (live birth / spontaneous abortion / elective TOP / stillbirth)",
          "gestational age at exposure",
          "gestational age at delivery",
          "birth weight + length + head circumference",
          "congenital anomalies (any organ system, classified by ICD-10)",
          "developmental milestones at 3 months and 12 months",
          "breastfeeding status at follow-up timepoints",
        ],
      }
    : undefined;

  const recommendations = recommendationsFor(verdict, stats, input);
  const rmpText = rmpSignalSectionText(input, stats, verdict);

  const signal_assessment = {
    drug: input.drug,
    period_months: input.reporting_period_months,
    statistics: {
      prr: stats.prr,
      ror: stats.ror,
      ic: stats.ic,
      mgps: stats.mgps,
      chi_squared: stats.chi_squared,
      n_cases: stats.n_cases,
    },
    verdict,
    workflow_recommendation: recommendations,
    rmp_signal_section_text: rmpText,
    pregnancy_followup,
    gvp_revision: GVP_REVISION,
  };

  // ── Markdown report ─────────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push(`# PV Signal Assessment — ${input.drug} (${input.indication})`);
  lines.push("");
  lines.push(
    `**Data source:** ${input.data_source} · **Period:** ${input.reporting_period_months} months · **N cases:** ${stats.n_cases} · **Threshold tier:** ${stats.thresholds_used}`,
  );
  lines.push("");
  lines.push(`**Verdict:** \`${verdict}\``);
  lines.push("");

  lines.push("## Disproportionality statistics");
  lines.push("| Method | Value | 95% CI / posterior | Threshold met? |");
  lines.push("|--------|-------|--------------------|----------------|");
  lines.push(
    `| PRR (Evans 2001) | ${stats.prr.value.toFixed(2)} | [${stats.prr.ci_low.toFixed(2)}, ${stats.prr.ci_high.toFixed(2)}] | ${stats.prr.threshold_met ? "✅" : "❌"} |`,
  );
  lines.push(
    `| ROR (van Puijenbroek 2002) | ${stats.ror.value.toFixed(2)} | [${stats.ror.ci_low.toFixed(2)}, ${stats.ror.ci_high.toFixed(2)}] | ${stats.ror.threshold_met ? "✅" : "❌"} |`,
  );
  lines.push(
    `| IC (BCPNN, Bate 1998) | ${stats.ic.value.toFixed(2)} | IC025 = ${stats.ic.ic025.toFixed(2)} | ${stats.ic.threshold_met ? "✅" : "❌"} |`,
  );
  lines.push(
    `| MGPS / EBGM (DuMouchel 1999) | ${stats.mgps.ebgm.toFixed(2)} | EB05 = ${stats.mgps.eb05.toFixed(2)} · EB95 = ${stats.mgps.eb95.toFixed(2)} | ${stats.mgps.threshold_met ? "✅" : "❌"} |`,
  );
  lines.push(
    `| χ² (Yates) | ${stats.chi_squared.toFixed(2)} | — | ${stats.chi_squared >= 4 ? "✅" : "❌"} |`,
  );
  lines.push("");

  lines.push("## Workflow recommendation");
  for (const r of recommendations) lines.push(`- ${r}`);
  lines.push("");

  if (pregnancy_followup) {
    lines.push("## GVP Considerations P.III — Pregnancy follow-up");
    lines.push(
      "The drug has a pregnancy-related safety concern in the RMP and pregnancy exposure was reported. Per GVP Considerations P.III (effective 2026-02-09), structured follow-up is required at:",
    );
    lines.push("");
    for (const t of pregnancy_followup.timepoints) lines.push(`- **${t}**`);
    lines.push("");
    lines.push(
      `Structured data to capture (protocol ref \`${pregnancy_followup.followup_protocol_ref}\`):`,
    );
    for (const d of pregnancy_followup.structured_data_required)
      lines.push(`- ${d}`);
    lines.push("");
  } else if (input.pregnancy_exposure) {
    lines.push("## Pregnancy exposure noted");
    lines.push(
      "Pregnancy exposure was reported but `rmp_has_pregnancy_concern: false` — per GVP Considerations P.III, structured follow-up is required *in principle only when the medicinal product is associated with pregnancy-related safety concerns identified in the RMP*. Confirm RMP status; if a pregnancy-related risk is in scope, re-run with `rmp_has_pregnancy_concern: true`.",
    );
    lines.push("");
  }

  lines.push("## RMP signal-section text (canonical)");
  lines.push("```");
  lines.push(rmpText);
  lines.push("```");
  lines.push("");

  lines.push("## Roadmap notes");
  lines.push(
    "- **v2 (planned):** EVDAS programmatic integration via eRMR / ICSR download per Reg. 2025/1466 — currently this tool takes user-supplied case counts.",
  );
  lines.push(
    "- **v2 (planned):** Stratified MGPS (by sex / age band) — currently single-stratum gamma-Poisson shrinkage.",
  );
  lines.push("");

  lines.push("## References");
  lines.push("- EMA GVP Module IX rev 2 (Signal management, 2026)");
  lines.push(
    "- EU Implementing Regulation 2025/1466 (mandatory EVDAS integration)",
  );
  lines.push("- EMA GVP Considerations P.III — Pregnancy and breastfeeding");
  lines.push(
    "- Evans SJW et al. (2001). PRR for signal generation. *PDS* 10:483-486.",
  );
  lines.push(
    "- van Puijenbroek EP et al. (2002). ROR for signal detection. *PDS* 11:3-10.",
  );
  lines.push(
    "- Bate A et al. (1998). BCPNN signal detection. *Eur J Clin Pharmacol* 54:315-321.",
  );
  lines.push(
    "- Norén GN et al. (2006). Extending IC to bivariate cases. *Stat Med* 25:1995-2017.",
  );
  lines.push(
    "- DuMouchel W. (1999). Bayesian data mining in large freq tables. *Am Stat* 53:177-190.",
  );
  lines.push("");
  lines.push(auditToMarkdown(audit));

  return {
    content: lines.join("\n"),
    audit,
    signal_assessment,
  } as ToolResult & { signal_assessment: typeof signal_assessment };
}

function recommendationsFor(
  verdict: string,
  stats: ReturnType<typeof computeAllStats>,
  input: {
    outcome_serious: boolean;
    rmp_has_pregnancy_concern: boolean;
    pregnancy_exposure: boolean;
  },
): string[] {
  const out: string[] = [];
  switch (verdict) {
    case "confirmed_signal":
      out.push("Notify PRAC within the next signal management cycle.");
      out.push(
        "Update RMP Part III (PV Plan) with the new signal section text below.",
      );
      out.push("Conduct ICSR-level review of the contributing cases.");
      out.push(
        "Consider whether a label variation is warranted; if yes, file Type II variation.",
      );
      if (input.outcome_serious) {
        out.push(
          "⚠️ AE is serious — accelerated review timeline applies (lower thresholds were used).",
        );
      }
      break;
    case "strengthening_signal":
      out.push("Continue monitoring; re-evaluate at next PSUR cycle.");
      out.push(
        "Document in signal management tracking system; not yet a confirmed signal.",
      );
      out.push(
        `Currently ${[stats.prr.threshold_met, stats.ror.threshold_met, stats.ic.threshold_met, stats.mgps.threshold_met].filter(Boolean).length}/4 methods trigger; needs ≥2 + N≥3 + χ²≥4 for confirmation.`,
      );
      break;
    case "previously_known_signal":
      out.push("Signal matches a previously-identified known risk in the RMP.");
      out.push(
        "Confirm continued reporting in the next PSUR; no new RMP variation required.",
      );
      break;
    case "refuted_signal":
      out.push("Statistics significantly below threshold with adequate N.");
      out.push(
        "Document non-signal in signal management tracking; no further action required.",
      );
      break;
    case "no_signal":
    default:
      out.push(
        "No disproportionality detected. Continue routine PV monitoring.",
      );
      out.push("Re-evaluate at next PSUR cycle or if N grows materially.");
  }
  if (input.pregnancy_exposure && input.rmp_has_pregnancy_concern) {
    out.push(
      "GVP P.III follow-up required (birth / 3mo / 12mo) — see protocol below.",
    );
  }
  return out;
}

function rmpSignalSectionText(
  input: {
    drug: string;
    indication: string;
    case_counts: { drug_event: number };
    data_source: string;
    reporting_period_months: number;
  },
  stats: ReturnType<typeof computeAllStats>,
  verdict: string,
): string {
  return [
    `Signal: ${input.drug} in ${input.indication}.`,
    `Source: ${input.data_source}, ${input.reporting_period_months}-month reporting period.`,
    `Cases (N): ${stats.n_cases}.`,
    `PRR = ${stats.prr.value.toFixed(2)} (95% CI ${stats.prr.ci_low.toFixed(2)}-${stats.prr.ci_high.toFixed(2)}); ROR = ${stats.ror.value.toFixed(2)} (95% CI ${stats.ror.ci_low.toFixed(2)}-${stats.ror.ci_high.toFixed(2)}); IC = ${stats.ic.value.toFixed(2)} (IC025 = ${stats.ic.ic025.toFixed(2)}); EBGM = ${stats.mgps.ebgm.toFixed(2)} (EB05 = ${stats.mgps.eb05.toFixed(2)}); χ² = ${stats.chi_squared.toFixed(2)}.`,
    `Verdict: ${verdict.replace(/_/g, " ")}.`,
    `Threshold tier: ${stats.thresholds_used}.`,
  ].join(" ");
}

export const pvSignalWorkflowToolSchema = {
  name: "pv.signal_workflow",
  description:
    "Compute disproportionality statistics (PRR, ROR, IC/BCPNN, MGPS/EBGM) on user-supplied drug-AE case counts and decide a signal verdict per EMA GVP Module IX rev 2. Returns the verdict (no/strengthening/confirmed/previously known/refuted), workflow recommendations, and canonical RMP signal-section text. To classify a finding as previously_known_signal, supply BOTH prior_known_signals AND reported_event so the tool can match the disproportionality to a specific known event. Optionally layers in GVP Considerations P.III pregnancy follow-up (birth/3mo/12mo) when both pregnancy_exposure and rmp_has_pregnancy_concern are true. Pairs with pv_classify. ⚠️ MGPS uses single-stratum gamma-Poisson shrinkage in v1 — when database counts are confounded by sex/age strata, EBGM/EB05 may be inflated; stratified MGPS is planned for v2. v1 takes user counts; v2 will also integrate EVDAS programmatic access per Reg. 2025/1466.",
  annotations: {
    title: "PV Signal Workflow",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      drug: { type: "string" },
      indication: { type: "string" },
      reporting_period_months: {
        type: "number",
        minimum: 1,
        maximum: 120,
        default: 12,
      },
      case_counts: {
        type: "object",
        properties: {
          drug_event: {
            type: "number",
            minimum: 0,
            description: "a — cases of THIS drug AND THIS event",
          },
          drug_total: {
            type: "number",
            minimum: 0,
            description: "a+b — all cases of the drug",
          },
          event_total: {
            type: "number",
            minimum: 0,
            description: "a+c — all cases of the event",
          },
          grand_total: {
            type: "number",
            minimum: 0,
            description: "a+b+c+d — all cases in DB",
          },
        },
        required: ["drug_event", "drug_total", "event_total", "grand_total"],
      },
      data_source: {
        type: "string",
        enum: DATA_SOURCES,
        default: "eudravigilance",
      },
      pregnancy_exposure: { type: "boolean", default: false },
      prior_known_signals: {
        type: "array",
        items: { type: "string" },
        default: [],
      },
      outcome_serious: { type: "boolean", default: false },
      rmp_has_pregnancy_concern: { type: "boolean", default: false },
    },
    required: ["drug", "indication", "case_counts"],
  },
} as const;
