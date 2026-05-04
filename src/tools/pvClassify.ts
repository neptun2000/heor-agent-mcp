/**
 * pv_classify — pharmacovigilance study classification.
 *
 * Maps a planned study's metadata onto its EMA GVP regulatory category
 * (PASS imposed/voluntary, PAES, RMP Annex 4, DUS, registry, pregnancy
 * registry, spontaneous reporting, ICH E2E plan) plus the matching GVP
 * module + ENCePP protocol template + RMP/FDA implications. Pure logic,
 * no I/O — modelled on itc_feasibility.
 *
 * See design log #11 for the decision tree and design rationale.
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
import { classifyPv } from "../pv/decisionTree.js";
import { GVP_REVISION, gvpFor } from "../pv/gvpModules.js";
import type { PvClassification } from "../pv/types.js";
import type { ToolResult } from "../providers/types.js";

export type { PvClassification } from "../pv/types.js";

const STUDY_DESIGNS = [
  "rct",
  "single_arm",
  "prospective_cohort",
  "retrospective_cohort",
  "case_control",
  "registry",
  "spontaneous_reports",
  "drug_utilization",
  "clinical_trial_extension",
  "real_world_evidence",
] as const;

const PRIMARY_OBJECTIVES = [
  "safety",
  "efficacy",
  "effectiveness",
  "drug_utilization",
  "natural_history",
  "risk_minimisation_evaluation",
] as const;

const REGULATORY_CONTEXTS = [
  "pre_authorisation",
  "post_authorisation",
  "conditional_approval",
  "accelerated_approval",
  "rmp_commitment",
] as const;

const JURISDICTIONS = ["eu", "us", "uk", "japan", "china"] as const;

const PvClassifySchema = z
  .object({
    drug: z.string().min(1, "drug is required"),
    indication: z.string().min(1, "indication is required"),
    study_design: z.enum(STUDY_DESIGNS),
    primary_objective: z.enum(PRIMARY_OBJECTIVES),
    regulatory_context: z.enum(REGULATORY_CONTEXTS),
    imposed_by_authority: z.boolean().default(false),
    population_includes_pregnant: z.boolean().default(false),
    population_includes_paediatric: z.boolean().default(false),
    multi_country: z.boolean().default(false),
    jurisdictions: z.array(z.enum(JURISDICTIONS)).default(["eu"]),
  })
  .strict();

export async function handlePvClassify(
  rawInput: unknown,
): Promise<ToolResult> {
  const parsed = PvClassifySchema.safeParse(rawInput);
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
    "pv.classify",
    input as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "EMA GVP Module VIII (Post-Authorisation Safety Studies, rev 4); GVP Module V (Risk Management Systems); GVP Module VIII Addendum I (DUS); GVP Module VI (Spontaneous Reporting); ICH E2E Pharmacovigilance Planning; EU Regulation 1235/2010 Article 107a (imposed PASS); ENCePP Code of Conduct.",
  );

  const decision = classifyPv(input);
  const mapping = gvpFor(decision.primary_category);

  audit = addAssumption(
    audit,
    `Primary verdict: ${decision.primary_category} → GVP Module ${mapping.gvp_module}.`,
  );
  if (decision.alternatives.length > 0) {
    audit = addAssumption(
      audit,
      `Alternative classifications considered: ${decision.alternatives.join(", ")}.`,
    );
  }
  if (input.population_includes_pregnant) {
    audit = addWarning(
      audit,
      "Pregnant population in scope — pregnancy registry obligations apply on top of any other classification.",
    );
  }

  const classification: PvClassification = {
    primary_category: decision.primary_category,
    alternatives: decision.alternatives,
    gvp_module: mapping.gvp_module,
    gvp_revision: GVP_REVISION,
    encepp_protocol_template: mapping.encepp_protocol_template,
    rmp_implications: mapping.rmp_implications,
    fda_analogue: mapping.fda_analogue,
    submission_obligations: mapping.submission_obligations,
    rationale: decision.rationale,
  };

  const lines: string[] = [];
  lines.push(`# PV Classification — ${input.drug} (${input.indication})`);
  lines.push("");
  lines.push(`**Primary category:** \`${decision.primary_category}\``);
  if (decision.alternatives.length > 0) {
    lines.push(
      `**Alternatives:** ${decision.alternatives.map((c) => `\`${c}\``).join(", ")}`,
    );
  }
  lines.push("");

  lines.push("## GVP Module");
  lines.push(
    `Module ${mapping.gvp_module} (EMA GVP ${GVP_REVISION.replace("_", " ")})`,
  );
  if (mapping.encepp_protocol_template) {
    lines.push(`ENCePP protocol template: \`${mapping.encepp_protocol_template}\``);
  }
  lines.push("");

  lines.push("## Rationale");
  lines.push(decision.rationale);
  lines.push("");

  lines.push("## Submission Obligations");
  for (const o of mapping.submission_obligations) {
    lines.push(`- ${o}`);
  }
  lines.push("");

  lines.push("## RMP Implications");
  for (const r of mapping.rmp_implications) {
    lines.push(`- ${r}`);
  }
  lines.push("");

  if (input.jurisdictions.includes("us")) {
    lines.push("## US (FDA) Mapping — v1 stub");
    lines.push(
      `FDA analogue: ${mapping.fda_analogue ?? "not yet mapped"}. Full FDA REMS / Sentinel / FAERS integration is planned for v2 of this tool — for now this is an indicative mapping, not a regulatory-grade FDA classification.`,
    );
    lines.push("");
    lines.push("### CMS IRA note");
    lines.push(
      "**Inflation Reduction Act (CMS IRA) excludes pharmacovigilance cost data from Medicare drug-price negotiation calculations.** PV obligations recorded here do not enter the IRA negotiation threshold; track them separately in the regulatory budget, not the HEOR cost-effectiveness model.",
    );
    lines.push("");
  }

  if (input.population_includes_pregnant) {
    lines.push("## Pregnancy Population Override");
    lines.push(
      "A pregnancy registry is required regardless of the primary classification. This adds protocol obligations beyond the primary verdict — design the study to include both arms.",
    );
    lines.push("");
  }

  lines.push("## References");
  lines.push("- EMA GVP Module VIII (Post-Authorisation Safety Studies, rev 4)");
  lines.push("- EMA GVP Module V (Risk Management Systems)");
  lines.push("- EMA GVP Module VIII Addendum I (Drug Utilisation Studies)");
  lines.push("- EU Regulation 1235/2010, Article 107a (imposed PASS)");
  lines.push("- ICH E2E — Pharmacovigilance Planning");
  lines.push("- ENCePP Code of Conduct + protocol templates");
  if (input.jurisdictions.includes("us")) {
    lines.push("- FDA REMS Guidance for Industry (2019)");
    lines.push("- FDA Sentinel Initiative documentation");
    lines.push("- 21 CFR 314.81 (FDA premarket Pharmacovigilance Plan)");
  }
  lines.push("");

  lines.push(auditToMarkdown(audit));

  return {
    content: lines.join("\n"),
    audit,
    pv_classification: classification,
  } as ToolResult & { pv_classification: PvClassification };
}

export const pvClassifyToolSchema = {
  name: "pv.classify",
  description:
    "Classify a planned study into its EMA pharmacovigilance regulatory category (PASS imposed/voluntary, PAES, RMP Annex 4, DUS, active surveillance registry, pregnancy registry, spontaneous reporting, ICH E2E plan). Returns the matching GVP module + ENCePP protocol template + submission obligations + RMP implications + FDA analogue. Use BEFORE preparing an HTA dossier or before designing a post-authorisation study. Pass the structured `pv_classification` output to `hta_dossier` to populate its Pharmacovigilance Plan section.",
  annotations: {
    title: "PV Study Classification",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      drug: { type: "string", description: "Drug name." },
      indication: { type: "string", description: "Disease/condition." },
      study_design: { type: "string", enum: STUDY_DESIGNS },
      primary_objective: { type: "string", enum: PRIMARY_OBJECTIVES },
      regulatory_context: { type: "string", enum: REGULATORY_CONTEXTS },
      imposed_by_authority: { type: "boolean", default: false },
      population_includes_pregnant: { type: "boolean", default: false },
      population_includes_paediatric: { type: "boolean", default: false },
      multi_country: { type: "boolean", default: false },
      jurisdictions: {
        type: "array",
        items: { type: "string", enum: JURISDICTIONS },
        default: ["eu"],
      },
    },
    required: [
      "drug",
      "indication",
      "study_design",
      "primary_objective",
      "regulatory_context",
    ],
  },
} as const;
