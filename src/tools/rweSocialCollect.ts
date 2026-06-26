/**
 * rwe.social_collect — pull public Reddit posts for a drug/indication via the
 * free OAuth API, pseudonymize authors, and return triage-ready posts.
 *
 * Pure-fetch: this tool does NOT run NLP. The calling model extracts ICSR
 * elements per post, then invokes pv.social_listening_triage. Stateless one-shot;
 * output carries id/fetched_at/query_used for a future monitoring layer.
 *
 * See design log #45.
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
import { collectRedditPosts } from "../providers/direct/reddit.js";
import type { SocialCollectResult } from "../social/types.js";
import type { ToolResult } from "../providers/types.js";

export type { SocialCollectResult } from "../social/types.js";

const RweSocialCollectSchema = z
  .object({
    drug: z.string().min(1, "drug is required"),
    brand_names: z.array(z.string()).default([]),
    indication: z.string().optional(),
    platform: z.enum(["reddit", "bluesky"]).default("reddit"),
    subreddits: z.array(z.string()).default([]),
    keywords: z.array(z.string()).default([]),
    time_window: z
      .enum(["day", "week", "month", "year", "all"])
      .default("year"),
    sort: z.enum(["relevance", "new", "top"]).default("relevance"),
    max_posts: z.number().int().min(1).max(100).default(50),
  })
  .strip();

export async function handleRweSocialCollect(
  rawInput: unknown,
): Promise<ToolResult> {
  const parsed = RweSocialCollectSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues
        .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
        .join("\n"),
    );
  }
  const input = parsed.data;

  let audit = createAuditRecord(
    "rwe.social_collect",
    input as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "Public Reddit search via the free OAuth API (application-only). Posts are pseudonymized " +
      "(SHA-256 of handle) and returned verbatim for downstream LLM extraction; the tool runs no NLP. " +
      "Social listening is the lowest-validity RWE source — output is descriptive/hypothesis-generating. " +
      "A systematic digital-media review triggers EMA GVP Module VI AE handling.",
  );

  const result: SocialCollectResult = await collectRedditPosts(input);

  audit = addAssumption(
    audit,
    `${result.total_collected} public Reddit post(s) collected for query: ${result.query_used}`,
  );
  for (const w of result.warnings) audit = addWarning(audit, w);

  const lines: string[] = [];
  lines.push(
    `# Social-Listening Collection — ${input.drug}${input.indication ? ` (${input.indication})` : ""}`,
  );
  lines.push("");
  lines.push(
    `**Platform:** Reddit · **Posts:** ${result.total_collected} · **Window:** ${input.time_window} · **Sort:** ${input.sort}`,
  );
  lines.push(
    `**Query:** \`${result.query_used}\` · **Fetched:** ${result.fetched_at}`,
  );
  lines.push("");

  lines.push("## ⚠️ Governance");
  lines.push(
    "- ⚠️ **Lowest-validity RWE** — social-listening output is descriptive / hypothesis-generating only.",
  );
  lines.push(`- ${result.governance.gvp_module_vi}`);
  lines.push(
    "- Public data only; authors pseudonymized (no raw handles); nothing persisted server-side.",
  );
  lines.push(
    "- Run `rwe.social_listening_protocol` first for jurisdiction privacy gating (GDPR/HIPAA).",
  );
  lines.push("");

  if (result.warnings.length) {
    lines.push("## Notices");
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  if (result.posts.length) {
    lines.push("## Collected posts");
    lines.push(
      "| ID | Channel | Author (pseudonym) | Score | Comments | Preview |",
    );
    lines.push(
      "|----|---------|--------------------|----|----------|---------|",
    );
    for (const p of result.posts) {
      const preview = (p.title || p.body).replace(/\|/g, "\\|").slice(0, 80);
      lines.push(
        `| ${p.id} | ${p.channel ? "r/" + p.channel : "—"} | ${p.author_pseudonym} | ${p.score} | ${p.num_comments} | ${preview} |`,
      );
    }
    lines.push("");
    lines.push(
      "**Next step:** extract the four ICSR elements per post (identifiable reporter / patient / suspect product / adverse event) and pass to `pv.social_listening_triage`.",
    );
    lines.push("");
  }

  lines.push("## References");
  lines.push(
    "- EMA GVP Module VI rev 2 (Management and reporting of adverse reactions)",
  );
  lines.push("- Reddit Data API (free OAuth tier)");
  lines.push("");
  lines.push(
    auditToMarkdown(audit, {
      disclosure: { level: extractDisclosureLevel(rawInput, "standard") },
    }),
  );

  return {
    content: lines.join("\n"),
    audit,
    social_collect: result,
  } as ToolResult & { social_collect: SocialCollectResult };
}

export const rweSocialCollectToolSchema = {
  name: "rwe.social_collect",
  description:
    "Collect public Reddit posts for a drug/indication via the free Reddit OAuth API, for social-listening RWE. " +
    "Searches (drug OR brand_names) optionally AND (keywords) across site-wide or specific subreddits, over a time " +
    "window, and returns normalized posts (id, subreddit, pseudonymized author, timestamp, title, body, score, " +
    "comment count) plus a governance block. It is PURE-FETCH: it does NOT run NLP and does NOT scrape — the calling " +
    "model extracts the four ICSR elements per post and passes them to pv.social_listening_triage. Authors are " +
    "pseudonymized (SHA-256); public data only; nothing is persisted. Requires REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET " +
    "(free app at reddit.com/prefs/apps); degrades gracefully with a notice when absent. A systematic digital-media " +
    "review triggers EMA GVP Module VI AE handling. ⚠️ Social listening is the lowest-validity RWE source — output is " +
    "hypothesis-generating only. Pairs with rwe.social_listening_protocol (design) and pv.social_listening_triage (triage).",
  annotations: {
    title: "Social-Listening Collection (Reddit)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      drug: { type: "string" },
      brand_names: { type: "array", items: { type: "string" } },
      indication: { type: "string" },
      subreddits: { type: "array", items: { type: "string" } },
      keywords: { type: "array", items: { type: "string" } },
      time_window: {
        type: "string",
        enum: ["day", "week", "month", "year", "all"],
        default: "year",
      },
      sort: {
        type: "string",
        enum: ["relevance", "new", "top"],
        default: "relevance",
      },
      max_posts: { type: "number", minimum: 1, maximum: 100, default: 50 },
      ai_disclosure_level: {
        type: "string",
        enum: ["off", "standard", "submission"],
      },
    },
    required: ["drug"],
  },
};
