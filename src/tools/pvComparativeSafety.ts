/**
 * pv.comparative_safety — class-level comparative safety profile from
 * spontaneous-report data (FAERS / EudraVigilance / VigiBase).
 *
 * Ranks the top-N adverse events per product by reporting rate per 1,000
 * exposed (or raw report count when no denominator is supplied), lays the
 * products side-by-side, optionally layers in disproportionality (PRR/ROR/
 * IC/EBGM via the pv_signal_workflow statistics), and emits class-level
 * observations — including explicit call-outs for events of interest
 * (e.g. "cardiovascular events did not rank in the top 10 for any product").
 *
 * Pure logic, no I/O. Complements pv.signal_workflow (single drug × single
 * AE) with the multi-drug × multi-AE class view. See design log #17.
 */
import { z } from "zod";
import {
  addAssumption,
  addWarning,
  createAuditRecord,
  setMethodology,
} from "../audit/builder.js";
import { auditToMarkdown } from "../formatters/markdown.js";
import { extractDisclosureLevel } from "../formatters/disclosure.js";
import { suggestForEnum } from "../util/didYouMean.js";
import { computeComparativeSafety } from "../pv/comparativeSafety.js";
import type { ComparativeSafetyResult } from "../pv/comparativeSafety.js";
import type { ToolResult } from "../providers/types.js";

export type { ComparativeSafetyResult } from "../pv/comparativeSafety.js";

const DATA_SOURCES = [
  "faers",
  "eudravigilance",
  "vigibase_who",
  "national_db",
  "spontaneous_internal",
] as const;

const AdverseEventSchema = z.object({
  name: z.string().min(1),
  drug_event_count: z.number().int().nonnegative(),
  event_total: z.number().int().nonnegative().optional(),
  serious: z.boolean().default(false),
});

const ProductSchema = z.object({
  name: z.string().min(1),
  exposed_population: z.number().positive().optional(),
  total_reports: z.number().int().nonnegative().optional(),
  adverse_events: z.array(AdverseEventSchema).min(1),
});

const PvComparativeSafetySchema = z
  .object({
    drug_class: z.string().min(1, "drug_class is required"),
    indication: z.string().min(1, "indication is required"),
    data_source: z.enum(DATA_SOURCES).default("faers"),
    reporting_period_months: z.number().int().min(1).max(120).optional(),
    grand_total: z.number().int().nonnegative().optional(),
    top_n: z.number().int().min(1).max(50).default(10),
    products: z.array(ProductSchema).min(2, "supply at least 2 products to compare"),
    events_of_interest: z.array(z.string().min(1)).default([]),
  })
  .strict();

export async function handlePvComparativeSafety(
  rawInput: unknown,
): Promise<ToolResult> {
  const parsed = PvComparativeSafetySchema.safeParse(rawInput);
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
    "pv.comparative_safety",
    input as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "Class-level comparative reporting profile from spontaneous-report data. Reporting rate per 1,000 exposed = drug-event reports / exposed × 1000. Optional disproportionality per drug-AE pair: PRR (Evans 2001), ROR (van Puijenbroek 2002), IC/BCPNN (Bate 1998 / Norén 2006), MGPS/EBGM (DuMouchel 1999), signal = ≥2 methods crossing threshold (EMA GVP Module IX rev 2 conventions). Spontaneous-report rates are not incidence — descriptive/hypothesis-generating only.",
  );

  const result = computeComparativeSafety(input);

  audit = addAssumption(
    audit,
    `${input.products.length} products compared on top ${input.top_n} adverse events; ranked by ${result.per_product[0]?.ranked_by ?? "report_count"}. Disproportionality ${result.disproportionality_computed ? "computed" : "not computed"}.`,
  );
  for (const w of result.warnings) audit = addWarning(audit, w);

  const lines: string[] = [];
  lines.push(
    `# Comparative Safety Profile — ${input.drug_class} (${input.indication})`,
  );
  lines.push("");
  lines.push(
    `**Source:** ${input.data_source}${input.reporting_period_months ? ` · **Period:** ${input.reporting_period_months} months` : ""} · **Products:** ${input.products.length} · **Top N:** ${input.top_n}`,
  );
  lines.push("");

  // Key observations first — the "key messages" view.
  if (result.observations.length) {
    lines.push("## Key observations");
    for (const o of result.observations) lines.push(`- ${o}`);
    lines.push("");
  }

  // Per-product top-N rankings.
  for (const pr of result.per_product) {
    lines.push(`## ${pr.product} — top ${input.top_n} adverse events`);
    const rateCol =
      pr.ranked_by === "reporting_rate"
        ? "Rate / 1,000 exposed"
        : "Reports (no denominator)";
    const showDispro = result.disproportionality_computed;
    lines.push(
      `| # | Adverse event | ${rateCol} | Reports |${showDispro ? " PRR | ROR | EB05 | Signal |" : ""}`,
    );
    lines.push(
      `|---|---------------|-----------|---------|${showDispro ? "-----|-----|------|--------|" : ""}`,
    );
    for (const ae of pr.ranked) {
      const rate =
        ae.reporting_rate_per_1000 !== null
          ? ae.reporting_rate_per_1000.toFixed(2)
          : "—";
      const dispro = ae.disproportionality;
      const disproCols = showDispro
        ? ` ${dispro ? dispro.prr.toFixed(2) : "—"} | ${dispro ? dispro.ror.toFixed(2) : "—"} | ${dispro ? dispro.eb05.toFixed(2) : "—"} | ${dispro ? (dispro.signal ? "⚠️" : "—") : "—"} |`
        : "";
      lines.push(
        `| ${ae.rank} | ${ae.name}${ae.serious ? " (serious)" : ""} | ${rate} | ${ae.count} |${disproCols}`,
      );
    }
    lines.push("");
  }

  // Side-by-side class comparison.
  if (result.class_comparison.length) {
    lines.push("## Class comparison (rank by product)");
    lines.push(
      `| Adverse event | ${result.per_product.map((p) => p.product).join(" | ")} |`,
    );
    lines.push(
      `|---------------|${result.per_product.map(() => "------").join("|")}|`,
    );
    for (const row of result.class_comparison) {
      const cells = row.cells.map((c) => {
        if (c.rank === null) return "—";
        const rate =
          c.reporting_rate_per_1000 !== null
            ? ` (${c.reporting_rate_per_1000.toFixed(2)})`
            : "";
        return `#${c.rank}${rate}`;
      });
      lines.push(`| ${row.adverse_event} | ${cells.join(" | ")} |`);
    }
    lines.push(
      "_Cell = rank within that product's top-N (reporting rate per 1,000 exposed in parentheses). “—” = outside the top-N or not reported._",
    );
    lines.push("");
  }

  if (result.warnings.length) {
    lines.push("## ⚠️ Interpretation caveats");
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  lines.push("## References");
  lines.push(
    "- EMA GVP Module IX rev 2 (Signal management) — disproportionality conventions",
  );
  lines.push("- Evans SJW et al. 2001 (PRR); van Puijenbroek EP et al. 2002 (ROR)");
  lines.push(
    "- Bate A et al. 1998 / Norén GN et al. 2006 (IC/BCPNN); DuMouchel W. 1999 (MGPS/EBGM)",
  );
  lines.push(
    "- FDA FAERS public dashboard documentation (spontaneous-report limitations)",
  );
  lines.push("");
  lines.push(
    auditToMarkdown(audit, {
      disclosure: { level: extractDisclosureLevel(rawInput, "submission") },
    }),
  );

  return {
    content: lines.join("\n"),
    audit,
    comparative_safety: result,
  } as ToolResult & { comparative_safety: ComparativeSafetyResult };
}

export const pvComparativeSafetyToolSchema = {
  name: "pv.comparative_safety",
  description:
    "Build a class-level comparative safety profile from spontaneous-report data (FAERS / EudraVigilance / VigiBase / WHO VigiBase). Ranks the top-N adverse events for each product in a drug class by reporting rate per 1,000 exposed (supply exposed_population per product) or by raw report count, lays the products side-by-side in a class-comparison matrix, and emits key observations — shared class profile, product-level differentiators, and explicit call-outs for events_of_interest (e.g. report that 'cardiovascular' did not rank in the top 10 for any product). Optionally layers in disproportionality (PRR/ROR/IC/EBGM) per drug-AE pair when you supply grand_total + per-product total_reports + per-AE event_total. Complements pv.signal_workflow (which scores one drug × one AE). ⚠️ Spontaneous-report rates reflect reporting behaviour, not incidence — output is a comparative reporting profile, hypothesis-generating only. Pure logic, no external calls.",
  annotations: {
    title: "Comparative Class Safety Profile",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      drug_class: {
        type: "string",
        description: "Therapeutic class label, e.g. 'anti-CGRP migraine mAbs'.",
      },
      indication: { type: "string" },
      data_source: { type: "string", enum: DATA_SOURCES, default: "faers" },
      reporting_period_months: {
        type: "number",
        minimum: 1,
        maximum: 120,
      },
      grand_total: {
        type: "number",
        minimum: 0,
        description:
          "a+b+c+d — all reports in the database. Supply (with per-product total_reports and per-AE event_total) to enable disproportionality.",
      },
      top_n: { type: "number", minimum: 1, maximum: 50, default: 10 },
      products: {
        type: "array",
        minItems: 2,
        description: "At least two products to compare.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            exposed_population: {
              type: "number",
              minimum: 0,
              description:
                "Exposure denominator for the reporting rate per 1,000 exposed.",
            },
            total_reports: {
              type: "number",
              minimum: 0,
              description: "a+b — all reports of this product (for disproportionality).",
            },
            adverse_events: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  drug_event_count: {
                    type: "number",
                    minimum: 0,
                    description: "a — reports of this product AND this event.",
                  },
                  event_total: {
                    type: "number",
                    minimum: 0,
                    description:
                      "a+c — all reports of this event in the database (for disproportionality).",
                  },
                  serious: { type: "boolean", default: false },
                },
                required: ["name", "drug_event_count"],
              },
            },
          },
          required: ["name", "adverse_events"],
        },
      },
      events_of_interest: {
        type: "array",
        items: { type: "string" },
        default: [],
        description:
          "Adverse events to report on explicitly across all products (matched by substring), e.g. ['cardiovascular','constipation'].",
      },
      ai_disclosure_level: {
        type: "string",
        enum: ["off", "standard", "submission"],
        description:
          'AI assistance disclosure level. "off" = no disclosure; "standard" = default; "submission" = adds ISPOR ELEVATE-GenAI citation.',
      },
    },
    required: ["drug_class", "indication", "products"],
  },
} as const;
