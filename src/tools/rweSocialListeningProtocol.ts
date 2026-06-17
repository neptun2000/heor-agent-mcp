/**
 * rwe.social_listening_protocol — generate a social-listening study
 * protocol + compliance checklist.
 *
 * Produces objectives, search strategy, inclusion/exclusion, analysis plan,
 * data-governance/privacy/ethics, a MANDATORY pharmacovigilance-handling
 * section (GVP Module VI applies to any systematic digital-media review),
 * deliverables, a compliance checklist, and limitations. Pure logic, no
 * I/O. Pairs with pv.social_listening_triage (execution) and irb.review.
 *
 * See design log #19.
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
import { caseInsensitiveEnum } from "../util/caseInsensitive.js";
import { buildSocialProtocol } from "../social/protocol.js";
import type { SocialProtocolResult } from "../social/types.js";
import type { ToolResult } from "../providers/types.js";

export type { SocialProtocolResult } from "../social/types.js";

const OBJECTIVES = [
  "patient_experience",
  "sentiment",
  "adverse_event_monitoring",
  "unmet_need",
  "treatment_adherence",
  "disease_awareness",
] as const;

const PLATFORMS = [
  "x_twitter",
  "reddit",
  "facebook",
  "instagram",
  "patient_forums",
  "youtube",
  "tiktok",
  "blogs",
] as const;

const PRIVACY = ["eu_gdpr", "us_hipaa", "uk_gdpr", "global"] as const;

const RweSocialProtocolSchema = z
  .object({
    drug: z.string().min(1, "drug is required"),
    indication: z.string().min(1, "indication is required"),
    objectives: z.array(caseInsensitiveEnum(OBJECTIVES)).min(1, "supply at least one objective"),
    platforms: z.array(caseInsensitiveEnum(PLATFORMS)).min(1, "supply at least one platform"),
    privacy_jurisdictions: z.array(caseInsensitiveEnum(PRIVACY)).default(["global"]),
    keywords: z.array(z.string()).default([]),
    time_window_months: z.number().int().min(1).max(120).optional(),
    is_mah_managed_channel: z.boolean().default(false),
  })
  .strict();

export async function handleRweSocialListeningProtocol(
  rawInput: unknown,
): Promise<ToolResult> {
  const parsed = RweSocialProtocolSchema.safeParse(rawInput);
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
    "rwe.social_listening_protocol",
    input as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "Social-listening study protocol per RWE good-practice (ISPOR/ISPE) + EMA GVP Module VI rev 2 (mandatory AE handling for systematic digital-media review) + GDPR Art. 6/9 (EU/UK) / HIPAA (US) data-governance gating. Lowest RWE validity tier — outputs are descriptive/hypothesis-generating.",
  );

  const result = buildSocialProtocol(input);

  audit = addAssumption(
    audit,
    `Protocol generated for ${input.objectives.length} objective(s) across ${input.platforms.length} platform(s); ${result.compliance_checklist.filter((c) => c.mandatory).length} mandatory compliance items.`,
  );
  for (const w of result.warnings) audit = addWarning(audit, w);

  const lines: string[] = [];
  lines.push(
    `# Social-Listening Study Protocol — ${input.drug} (${input.indication})`,
  );
  lines.push("");

  for (const s of result.sections) {
    lines.push(`## ${s.heading}`);
    for (const i of s.items) lines.push(`- ${i}`);
    lines.push("");
  }

  lines.push("## Compliance checklist");
  lines.push("| Item | Required |");
  lines.push("|------|----------|");
  for (const c of result.compliance_checklist) {
    lines.push(`| ${c.item} | ${c.mandatory ? "✅ mandatory" : "recommended"} |`);
  }
  lines.push("");

  lines.push("## Limitations");
  for (const l of result.limitations) lines.push(`- ${l}`);
  lines.push("");

  if (result.warnings.length) {
    lines.push("## ⚠️ Advisory");
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  lines.push("## Next steps in this toolset");
  lines.push("- Execute AE triage on collected posts with `pv.social_listening_triage`.");
  lines.push("- Obtain the IRB exemption determination with `irb.review`.");
  lines.push("- Triangulate findings with higher-validity designs via `evidence.triangulation` / `rwe.method_select`.");
  lines.push("");

  lines.push("## References");
  lines.push("- ISPOR/ISPE Good Procedural Practices for Real-World Evidence (Berger et al. 2017)");
  lines.push("- EMA GVP Module VI rev 2 (digital-media adverse-event handling)");
  lines.push("- GDPR Regulation (EU) 2016/679, Art. 6 & Art. 9 (special-category health data)");
  lines.push("");
  lines.push(
    auditToMarkdown(audit, {
      disclosure: { level: extractDisclosureLevel(rawInput, "submission") },
    }),
  );

  return {
    content: lines.join("\n"),
    audit,
    social_protocol: result,
  } as ToolResult & { social_protocol: SocialProtocolResult };
}

export const rweSocialListeningProtocolToolSchema = {
  name: "rwe.social_listening_protocol",
  description:
    "Generate a social-listening (social-media listening) study protocol + compliance checklist for an RWE study. Given the drug, indication, objectives (patient_experience, sentiment, adverse_event_monitoring, unmet_need, treatment_adherence, disease_awareness), platforms, privacy jurisdictions, and seed keywords, it produces a full protocol: objectives & scope, search strategy, inclusion/exclusion, analysis plan (sentiment + thematic + MedDRA-coded AE extraction), data-governance/privacy/ethics (GDPR Art. 6/9 and HIPAA items switch on jurisdiction), a MANDATORY pharmacovigilance-handling section (GVP Module VI applies to any systematic digital-media review, regardless of objective or channel ownership — escalated when is_mah_managed_channel is true), deliverables, a mandatory/recommended compliance checklist, and limitations. Pairs with pv.social_listening_triage (execution) and irb.review. ⚠️ Social-listening is the lowest-validity RWE method — outputs are qualitative/hypothesis-generating; triangulate with higher-validity designs. Pure logic, no external calls; enum values case-insensitive.",
  annotations: {
    title: "Social-Listening Study Protocol",
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
      objectives: {
        type: "array",
        minItems: 1,
        items: { type: "string", enum: OBJECTIVES },
      },
      platforms: {
        type: "array",
        minItems: 1,
        items: { type: "string", enum: PLATFORMS },
      },
      privacy_jurisdictions: {
        type: "array",
        items: { type: "string", enum: PRIVACY },
        default: ["global"],
      },
      keywords: { type: "array", items: { type: "string" }, default: [] },
      time_window_months: { type: "number", minimum: 1, maximum: 120 },
      is_mah_managed_channel: {
        type: "boolean",
        default: false,
        description:
          "True if the channel is sponsored/managed by the marketing-authorisation holder — escalates proactive AE solicitation and reporting obligations.",
      },
      ai_disclosure_level: {
        type: "string",
        enum: ["off", "standard", "submission"],
        description:
          'AI assistance disclosure level. "off" = no disclosure; "standard" = default; "submission" = adds ISPOR ELEVATE-GenAI citation.',
      },
    },
    required: ["drug", "indication", "objectives", "platforms"],
  },
} as const;
