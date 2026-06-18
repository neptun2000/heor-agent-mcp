/**
 * pv.social_listening_triage — GVP Module VI reportability triage of
 * already-collected social-media posts.
 *
 * The caller supplies, per post, a structured assessment of which of the
 * four ICSR elements are present (identifiable reporter, identifiable
 * patient, suspect product, adverse event) plus optional sentiment/themes.
 * This tool applies the deterministic four-element test, tallies sentiment/
 * themes/AE terms, and surfaces the pharmacovigilance reporting
 * obligations. It does NOT scrape and does NOT run NLP — that is the
 * calling model's job; this keeps the tool auditable and anti-fabrication.
 *
 * Pairs with rwe.social_listening_protocol. See design log #19.
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
import { triageSocialPosts } from "../social/reportability.js";
import type { SocialTriageResult } from "../social/types.js";
import type { ToolResult } from "../providers/types.js";

export type { SocialTriageResult } from "../social/types.js";

const IcsrElementsSchema = z.object({
  identifiable_reporter: z.boolean(),
  identifiable_patient: z.boolean(),
  suspect_product: z.boolean(),
  adverse_event: z.boolean(),
});

const PostSchema = z.object({
  id: z.string().min(1),
  elements: IcsrElementsSchema,
  sentiment: z.enum(["positive", "neutral", "negative", "mixed"]).optional(),
  themes: z.array(z.string()).optional(),
  adverse_event_terms: z.array(z.string()).optional(),
  serious: z.boolean().default(false),
  verbatim_excerpt: z.string().optional(),
});

const PvSocialTriageSchema = z
  .object({
    drug: z.string().min(1, "drug is required"),
    indication: z.string().min(1, "indication is required"),
    platform: z.string().min(1).default("mixed"),
    posts: z.array(PostSchema).min(1, "supply at least one post"),
  })
  .strict();

export async function handlePvSocialListeningTriage(
  rawInput: unknown,
): Promise<ToolResult> {
  const parsed = PvSocialTriageSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues
        .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
        .join("\n"),
    );
  }
  const input = parsed.data;

  let audit = createAuditRecord(
    "pv.social_listening_triage",
    input as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "EMA GVP Module VI rev 2 — four-element ICSR validity test (identifiable reporter + identifiable patient + suspect medicinal product + adverse event) applied to digital-media posts; serious cases 15-day / non-serious 90-day reporting clocks. Tool applies the rule to the caller-supplied per-post assessment; it does not read or scrape posts.",
  );

  const result = triageSocialPosts(input);

  audit = addAssumption(
    audit,
    `${result.total_posts} posts triaged: ${result.reportable_icsr_count} valid ICSR(s) (${result.serious_icsr_count} serious), ${result.counts.potential_ae_followup} needing follow-up.`,
  );
  for (const o of result.pv_obligations) audit = addWarning(audit, o);
  for (const w of result.warnings) audit = addWarning(audit, w);

  const lines: string[] = [];
  lines.push(
    `# Social-Listening PV Triage — ${input.drug} (${input.indication})`,
  );
  lines.push("");
  lines.push(
    `**Platform:** ${input.platform} · **Posts:** ${result.total_posts} · **Valid ICSRs:** ${result.reportable_icsr_count} (${result.serious_icsr_count} serious)`,
  );
  lines.push("");

  if (result.pv_obligations.length) {
    lines.push("## ⚠️ Pharmacovigilance obligations");
    for (const o of result.pv_obligations) lines.push(`- ${o}`);
    lines.push("");
  }

  lines.push("## Reportability breakdown");
  lines.push("| Classification | Count |");
  lines.push("|----------------|-------|");
  lines.push(`| Valid ICSR (reportable) | ${result.counts.valid_icsr} |`);
  lines.push(`| Potential AE — needs follow-up | ${result.counts.potential_ae_followup} |`);
  lines.push(`| Non-AE qualitative insight | ${result.counts.non_ae_insight} |`);
  lines.push(`| Not reportable | ${result.counts.not_reportable} |`);
  lines.push("");

  lines.push("## Per-post triage");
  lines.push("| Post | Classification | Serious | Missing elements | Deadline |");
  lines.push("|------|----------------|---------|------------------|----------|");
  for (const p of result.per_post) {
    lines.push(
      `| ${p.id} | ${p.classification} | ${p.serious ? "yes" : "no"} | ${p.missing_elements.join(", ") || "—"} | ${p.reporting_deadline_days !== null ? `${p.reporting_deadline_days}d` : "—"} |`,
    );
  }
  lines.push("");

  // Sentiment + themes (the qualitative insight layer).
  const sd = result.sentiment_distribution;
  if (sd.positive + sd.neutral + sd.negative + sd.mixed > 0) {
    lines.push("## Sentiment distribution");
    lines.push(
      `Positive ${sd.positive} · Neutral ${sd.neutral} · Negative ${sd.negative} · Mixed ${sd.mixed}`,
    );
    lines.push("");
  }
  if (result.theme_tally.length) {
    lines.push("## Top themes");
    for (const t of result.theme_tally.slice(0, 10))
      lines.push(`- ${t.theme} (${t.count})`);
    lines.push("");
  }
  if (result.adverse_event_tally.length) {
    lines.push("## Adverse-event terms reported");
    for (const t of result.adverse_event_tally.slice(0, 15))
      lines.push(`- ${t.term} (${t.count})`);
    lines.push("");
  }

  lines.push("## ⚠️ Interpretation caveats");
  for (const w of result.warnings) lines.push(`- ${w}`);
  lines.push("");

  lines.push("## References");
  lines.push("- EMA GVP Module VI rev 2 (Management and reporting of adverse reactions)");
  lines.push("- EMA GVP Module IX rev 2 (Signal management)");
  lines.push("");
  lines.push(
    auditToMarkdown(audit, {
      disclosure: { level: extractDisclosureLevel(rawInput, "submission") },
    }),
  );

  return {
    content: lines.join("\n"),
    audit,
    social_triage: result,
  } as ToolResult & { social_triage: SocialTriageResult };
}

export const pvSocialListeningTriageToolSchema = {
  name: "pv.social_listening_triage",
  description:
    "Triage already-collected social-media posts for pharmacovigilance reportability per EMA GVP Module VI. For each post the caller supplies a structured assessment of which of the four ICSR elements are present (identifiable_reporter, identifiable_patient, suspect_product, adverse_event) plus optional sentiment / themes / adverse_event_terms. The tool applies the deterministic four-element validity test (all four → valid reportable ICSR with a 15-day serious / 90-day non-serious clock; product+event only → follow-up needed; no AE → qualitative insight only), tallies sentiment/themes/AE terms, and surfaces the reporting obligations and validity caveats. It does NOT scrape and does NOT run NLP — the calling model extracts the per-post fields, keeping the output auditable. Pairs with rwe.social_listening_protocol (study design) and pv.signal_workflow (signal scoring). ⚠️ Social data is the lowest-validity RWE source — sentiment/theme output is hypothesis-generating only. Pure logic, no external calls.",
  annotations: {
    title: "Social-Listening PV Triage",
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
      platform: { type: "string", default: "mixed" },
      posts: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            elements: {
              type: "object",
              properties: {
                identifiable_reporter: { type: "boolean" },
                identifiable_patient: { type: "boolean" },
                suspect_product: { type: "boolean" },
                adverse_event: { type: "boolean" },
              },
              required: [
                "identifiable_reporter",
                "identifiable_patient",
                "suspect_product",
                "adverse_event",
              ],
            },
            sentiment: {
              type: "string",
              enum: ["positive", "neutral", "negative", "mixed"],
            },
            themes: { type: "array", items: { type: "string" } },
            adverse_event_terms: { type: "array", items: { type: "string" } },
            serious: { type: "boolean", default: false },
            verbatim_excerpt: { type: "string" },
          },
          required: ["id", "elements"],
        },
      },
      ai_disclosure_level: {
        type: "string",
        enum: ["off", "standard", "submission"],
        description:
          'AI assistance disclosure level. "off" = no disclosure; "standard" = default; "submission" = adds ISPOR ELEVATE-GenAI citation.',
      },
    },
    required: ["drug", "indication", "posts"],
  },
} as const;
