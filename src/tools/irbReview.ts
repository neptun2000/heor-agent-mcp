/**
 * irb_review — IRB / Ethics Committee submission classifier.
 *
 * Pure decision-tree logic mapping a planned study onto its US 45 CFR 46
 * review tier (exempt / expedited / full-board), EU CTR 536/2014 review
 * pathway, vulnerable-population obligations, GDPR/HIPAA data-management
 * plan, SAE-reporting framework, ICF complexity tier, COI framework, and
 * a ready-to-paste cover-letter template.
 *
 * See design log #21 for the decision tree, jurisdiction trade-offs, and
 * v2 deferrals (UK / Japan / Canada, full pediatric Subpart D age tiers,
 * paired icf_readability_check tool).
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
import { assessIrb } from "../irb/decisionTree.js";
import {
  EXEMPT_CATEGORIES,
  EXPEDITED_CATEGORIES,
} from "../irb/rulesets.js";
import { IRB_RULESET, type IrbAssessment } from "../irb/types.js";
import type { ToolResult } from "../providers/types.js";

export type { IrbAssessment } from "../irb/types.js";

const STUDY_DESIGNS = [
  "interventional",
  "non_interventional_prospective",
  "retrospective_chart_review",
  "registry",
  "secondary_data_analysis",
  "specimen_repository",
  "questionnaire_only",
] as const;

const DATA_HANDLINGS = [
  "fully_identifiable",
  "pseudonymized",
  "anonymized_safe_harbor",
  "anonymized_expert_determination",
  "aggregate_only",
] as const;

const RISK_LEVELS = ["minimal", "greater_than_minimal", "unknown"] as const;

const FUNDING_SOURCES = [
  "industry",
  "nih",
  "other_government",
  "foundation",
  "academic",
  "none",
] as const;

const JURISDICTIONS = ["us_irb", "eu_cec", "uk_hra_rec", "other"] as const;

const IrbReviewSchema = z
  .object({
    study_design: z.enum(STUDY_DESIGNS),
    intervention: z.string().min(1, "intervention is required"),
    indication: z.string().min(1, "indication is required"),
    population_includes_pediatric: z.boolean().default(false),
    population_includes_pregnant: z.boolean().default(false),
    population_includes_prisoners: z.boolean().default(false),
    population_includes_decisionally_impaired: z.boolean().default(false),
    jurisdictions: z.array(z.enum(JURISDICTIONS)).default(["us_irb", "eu_cec"]),
    data_handling: z.enum(DATA_HANDLINGS),
    risk_level: z.enum(RISK_LEVELS).default("unknown"),
    funding_source: z.enum(FUNDING_SOURCES),
    multi_site: z.boolean().default(false),
    expedited_category_claim: z
      .array(z.number().int().min(1).max(7))
      .optional(),
    pv_classification: z.unknown().optional(),
    // Hint flags (see types.ts for the §46.104 / §46.110 mapping).
    exempt_category_hint: z.enum(["educational"]).optional(),
    benign_behavioural: z.boolean().optional(),
    federal_demonstration: z.boolean().optional(),
    taste_test: z.boolean().optional(),
    broad_consent_obtained: z.boolean().optional(),
    marketed_drug: z.boolean().optional(),
    blood_draw_within_limits: z.boolean().optional(),
    noninvasive_collection: z.boolean().optional(),
    noninvasive_procedure: z.boolean().optional(),
    recording_collection: z.boolean().optional(),
  })
  .strict();

export async function handleIrbReview(
  rawInput: unknown,
): Promise<ToolResult> {
  const parsed = IrbReviewSchema.safeParse(rawInput);
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

  // Cast pv_classification to the narrow shape the decision tree reads
  // from. Only `primary_category` is consumed.
  const pvCast =
    input.pv_classification &&
    typeof input.pv_classification === "object" &&
    "primary_category" in (input.pv_classification as object)
      ? {
          primary_category: String(
            (input.pv_classification as { primary_category?: unknown })
              .primary_category ?? "",
          ),
        }
      : undefined;

  const assessment: IrbAssessment = assessIrb({
    ...input,
    pv_classification: pvCast,
  });

  let audit = createAuditRecord(
    "irb.review",
    input as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "45 CFR 46 (Common Rule, 2018 revision); 21 CFR 50/56 (FDA IRB regulations); EU Regulation 536/2014 (Clinical Trials Regulation); ICH E6(R3) Good Clinical Practice; HIPAA Privacy Rule §164.514 (de-identification); GDPR Art. 9 (special-category data); ICH E2A (SAE/SUSAR definitions); PHS 42 CFR 50 Subpart F (FCOI).",
  );
  audit = addAssumption(
    audit,
    `Study classified under irb_ruleset=${IRB_RULESET} (45 CFR 46 + EU CTR 536/2014).`,
  );
  for (const w of assessment.advisory_warnings) {
    audit = addWarning(audit, w);
  }

  // ---- Build markdown ----
  const lines: string[] = [];
  lines.push(`# IRB / Ethics Committee Review — ${input.intervention} (${input.indication})`);
  lines.push("");
  lines.push("## Review Tier");
  if (assessment.review_tier_us) {
    if (assessment.review_tier_us === "exempt") {
      const cat = assessment.exempt_category_us;
      const def = EXEMPT_CATEGORIES.find((c) => c.category === cat);
      lines.push(
        `**US (45 CFR 46):** Exempt category ${cat ?? "?"} — ${def?.title ?? ""} (${def?.citation ?? ""})`,
      );
      if (def) lines.push(`> ${def.summary}`);
    } else if (assessment.review_tier_us === "expedited") {
      const cats = assessment.expedited_categories_us;
      lines.push(
        `**US (45 CFR 46):** Expedited review under 45 CFR 46.110 — categories ${cats.join(", ")}`,
      );
      for (const c of cats) {
        const def = EXPEDITED_CATEGORIES.find((e) => e.category === c);
        if (def) lines.push(`> Cat ${c} — ${def.title}: ${def.summary}`);
      }
    } else {
      lines.push(`**US (45 CFR 46):** Full Board review (45 CFR 46.108)`);
    }
  } else {
    lines.push("**US (45 CFR 46):** not applicable (no us_irb in jurisdictions)");
  }
  if (assessment.review_tier_eu) {
    if (assessment.review_tier_eu === "ctr_multi_state") {
      lines.push(
        `**EU (CTR 536/2014):** Coordinated multi-state EC review — typical timeline ${assessment.eu_cec_timeline_days} days`,
      );
    } else if (assessment.review_tier_eu === "national_only") {
      lines.push(
        `**EU (CTR 536/2014):** National-level EC review — typical timeline ${assessment.eu_cec_timeline_days} days`,
      );
    } else {
      lines.push(
        "**EU:** Non-interventional study — outside CTR 536/2014; national EC review per local non-interventional framework.",
      );
    }
  } else {
    lines.push("**EU:** not applicable (no eu_cec in jurisdictions)");
  }
  lines.push("");

  // Vulnerable populations
  if (assessment.vulnerable_population_obligations.length > 0) {
    lines.push("## Vulnerable Population Obligations");
    for (const v of assessment.vulnerable_population_obligations) {
      lines.push(`### ${v.group} — ${v.regulatory_basis}`);
      for (const o of v.obligations) lines.push(`- ${o}`);
      if (v.v2_age_tier_table_pending) {
        lines.push(
          `> ⚠️ v2: a per-jurisdiction pediatric assent age-tier table is planned for v2 of irb_review.`,
        );
      }
    }
    lines.push("");
  }

  // Data Management Plan
  lines.push("## Data Management Plan");
  lines.push(
    `- GDPR Art. 9 special-category processing: **${assessment.data_management_plan.gdpr_special_category ? "yes" : "no"}**`,
  );
  lines.push(
    `- HIPAA PHI: **${assessment.data_management_plan.hipaa_phi ? "yes" : "no"}**`,
  );
  lines.push(
    `- De-identification method: \`${assessment.data_management_plan.de_identification_method}\``,
  );
  if (
    assessment.data_management_plan.cross_border_transfer_obligations.length >
    0
  ) {
    lines.push(`- Cross-border transfer obligations:`);
    for (const x of assessment.data_management_plan
      .cross_border_transfer_obligations) {
      lines.push(`  - ${x}`);
    }
  }
  lines.push("");

  // SAE
  lines.push("## SAE Reporting Framework");
  lines.push(
    `Framework: \`${assessment.sae_reporting_obligations.framework}\``,
  );
  if (assessment.sae_reporting_obligations.timelines.length > 0) {
    lines.push("");
    lines.push("| Event type | Reporting window |");
    lines.push("|---|---|");
    for (const t of assessment.sae_reporting_obligations.timelines) {
      lines.push(`| ${t.event_type} | ${t.reporting_window} |`);
    }
  }
  lines.push("");

  // ICF + COI
  lines.push("## ICF Complexity Tier");
  lines.push(`\`${assessment.icf_complexity_tier}\``);
  lines.push("");
  lines.push("## Conflict of Interest");
  lines.push(
    `Disclosure required: **${assessment.coi_disclosure_required ? "yes" : "no"}** (framework: \`${assessment.coi_framework}\`)`,
  );
  lines.push("");

  // Rationale
  lines.push("## Rationale");
  lines.push(assessment.rationale);
  lines.push("");

  // Advisory warnings
  if (assessment.advisory_warnings.length > 0) {
    lines.push("## ⚠️ Advisory Warnings");
    for (const w of assessment.advisory_warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  // Cover letter
  lines.push("## Cover-letter template (paste-ready)");
  lines.push("");
  lines.push("```text");
  lines.push(assessment.cover_letter_template);
  lines.push("```");
  lines.push("");

  // References
  lines.push("## References");
  lines.push("- 45 CFR 46 (Common Rule, 2018 revision)");
  lines.push("- 45 CFR 46.104 — Exempt categories");
  lines.push("- 45 CFR 46.110 — Expedited review categories");
  lines.push("- EU Regulation 536/2014 (Clinical Trials Regulation), Annex III");
  lines.push("- HIPAA §164.514 — de-identification standards (Safe Harbor + Expert Determination)");
  lines.push("- GDPR Art. 9 — special-category health data");
  lines.push("- ICH E6(R3) Good Clinical Practice (2024 revision)");
  lines.push("- ICH E2A — Clinical Safety Data Management");
  lines.push("- PHS 42 CFR 50 Subpart F — Promoting Objectivity in Research");
  lines.push("");

  lines.push(auditToMarkdown(audit));

  return {
    content: lines.join("\n"),
    audit,
    irb_assessment: assessment,
  } as ToolResult & { irb_assessment: IrbAssessment };
}

export const irbReviewToolSchema = {
  name: "irb.review",
  description:
    "Classify a planned study under 45 CFR 46 (US Common Rule) + EU CTR 536/2014 to produce an IRB / Ethics Committee submission scaffold. Returns: review tier (exempt §46.104 cat 1-8 / expedited §46.110 cat 1-7 / full-board §46.108), EU CTR review path with timeline, vulnerable-population obligations (Subpart B/C/D), GDPR Art. 9 + HIPAA §164.514 data-management plan, SAE-reporting framework (CTR Annex III / FDA IND / PSUR), ICF complexity tier, COI framework (PHS 42 CFR 50 / EU CTR Art. 14), and a ready-to-paste cover letter. v1 covers EU+US; UK/Japan/Canada planned for v2. Optional pv_classification input ties IRB review to the regulatory PV category — when primary_category is PASS_imposed, SAE timelines override to CTR Annex III.",
  annotations: {
    title: "IRB / Ethics Committee Review Classifier",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      study_design: { type: "string", enum: STUDY_DESIGNS },
      intervention: { type: "string" },
      indication: { type: "string" },
      population_includes_pediatric: { type: "boolean", default: false },
      population_includes_pregnant: { type: "boolean", default: false },
      population_includes_prisoners: { type: "boolean", default: false },
      population_includes_decisionally_impaired: { type: "boolean", default: false },
      jurisdictions: {
        type: "array",
        items: { type: "string", enum: JURISDICTIONS },
        default: ["us_irb", "eu_cec"],
      },
      data_handling: { type: "string", enum: DATA_HANDLINGS },
      risk_level: { type: "string", enum: RISK_LEVELS, default: "unknown" },
      funding_source: { type: "string", enum: FUNDING_SOURCES },
      multi_site: { type: "boolean", default: false },
      expedited_category_claim: {
        type: "array",
        items: { type: "integer", minimum: 1, maximum: 7 },
        description:
          "Expedited review categories per 45 CFR 46.110 (1-7) the investigator believes apply. Tool will validate; if it disagrees, both are surfaced as advisory_warnings.",
      },
      pv_classification: {
        type: "object",
        description:
          "Optional structured output from pv_classify. Only primary_category is read; PASS_imposed triggers CTR Annex III SAE timelines.",
      },
      exempt_category_hint: {
        type: "string",
        enum: ["educational"],
        description:
          "Hint: flag this as 45 CFR 46.104(d)(1) educational practices research.",
      },
      benign_behavioural: {
        type: "boolean",
        description:
          "Set true for benign behavioural interventions in adults (45 CFR 46.104(d)(3)).",
      },
      federal_demonstration: {
        type: "boolean",
        description:
          "Set true for federally supported research / demonstration project (45 CFR 46.104(d)(5)).",
      },
      taste_test: {
        type: "boolean",
        description:
          "Set true for taste / food-quality / consumer-acceptance evaluation (45 CFR 46.104(d)(6)).",
      },
      broad_consent_obtained: {
        type: "boolean",
        description:
          "Set true when broad consent has been obtained for secondary research / specimen storage (45 CFR 46.104(d)(7-8)).",
      },
      marketed_drug: {
        type: "boolean",
        description:
          "Set true when the study uses a marketed drug per labeling (drives expedited cat 1, post-marketing PSUR framework).",
      },
      blood_draw_within_limits: {
        type: "boolean",
        description:
          "Set true for blood collection within OHRP volume limits (45 CFR 46.110 cat 2).",
      },
      noninvasive_collection: {
        type: "boolean",
        description:
          "Set true for prospective biospecimen collection by noninvasive means (45 CFR 46.110 cat 3).",
      },
      noninvasive_procedure: {
        type: "boolean",
        description:
          "Set true for noninvasive data collection (ECG, EEG, blood pressure, ultrasound) (45 CFR 46.110 cat 4).",
      },
      recording_collection: {
        type: "boolean",
        description:
          "Set true for voice / digital / image recording collection (45 CFR 46.110 cat 6).",
      },
    },
    required: [
      "study_design",
      "intervention",
      "indication",
      "data_handling",
      "funding_source",
    ],
  },
};
