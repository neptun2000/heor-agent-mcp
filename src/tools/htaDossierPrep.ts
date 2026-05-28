import { z } from "zod";
import type {
  DossierParams,
  ToolResult,
  LiteratureResult,
  PicoDefinition,
} from "../providers/types.js";
import {
  LiteratureResultSchema,
  RobResultsSchema,
  CEModelResultSchema,
} from "../schemas/dossierInputSchemas.js";
import {
  detectMismatch,
  extractTaNumber,
  findPrecedents,
} from "../data/niceTaPrecedents.js";
import {
  MFN_BASKET_2026,
  MFN_BASKET_REVISION,
  MFN_COUNTRY_NAMES,
  computeMfnCeiling,
  type CountryIso2,
} from "../data/mfnBasket.js";
import { routeGvdSections } from "./htaDossier/gvdSectionRouter.js";
import { caseInsensitiveEnum } from "../util/caseInsensitive.js";

const DossierSchema = z.object({
  hta_body: caseInsensitiveEnum([
    "nice",
    "ema",
    "fda",
    "iqwig",
    "has",
    "jca",
    "gvd",
  ] as const),
  submission_type: caseInsensitiveEnum([
    "sta",
    "mta",
    "early_access",
    "initial",
    "renewal",
    "variation",
  ] as const),
  drug_name: z.string().min(1),
  indication: z.string().min(1),
  evidence_summary: z
    .union([z.string(), z.array(LiteratureResultSchema)])
    .optional(),
  model_results: CEModelResultSchema.optional(),
  picos: z
    .array(
      z.object({
        id: z.string(),
        population: z.string(),
        comparator: z.string(),
        outcomes: z.array(z.string()),
      }),
    )
    .optional(),
  output_format: caseInsensitiveEnum([
    "text",
    "json",
    "docx",
  ] as const).optional(),
  project: z.string().optional(),
  rob_results: RobResultsSchema.optional(),
  heterogeneity_per_outcome: z
    .record(
      z.string(),
      z.object({
        i_squared_pct: z.number().min(0).max(100),
        n_studies: z.number().int().min(1),
      }),
    )
    .optional()
    .describe(
      "Optional: I² and study count per outcome (from evidence_indirect tool). When provided, GRADE inconsistency is computed from I² instead of heuristic. Example: { 'overall survival': { i_squared_pct: 45, n_studies: 6 } }",
    ),
  upgrading_per_outcome: z
    .record(
      z.string(),
      z.object({
        large_effect: z.enum(["none", "large", "very_large"]).optional(),
        dose_response: z.boolean().optional(),
        plausible_confounding_toward_null: z.boolean().optional(),
      }),
    )
    .optional()
    .describe(
      "Optional: GRADE upgrading flags per outcome for observational evidence (Guyatt 2011). 'large_effect' rates effect magnitude (large=RR<0.5 or >2.0; very_large=RR<0.2 or >5.0). 'dose_response' = documented gradient. 'plausible_confounding_toward_null' = bias would reduce effect. Capped at +2 steps. Ignored for RCT evidence (already High).",
    ),
  severity_modifier: z
    .object({
      absolute_qaly_shortfall: z.number().min(0).optional(),
      proportional_qaly_shortfall: z.number().min(0).max(1).optional(),
    })
    .optional()
    .describe(
      "NICE PMG36 severity modifier inputs (replaced the end-of-life modifier in April 2022 in opportunity-cost-neutral form). Provide either absolute QALY shortfall (years), proportional shortfall (0-1), or both. Modifier weight is the higher of the two: <12 absolute and <0.85 proportional → 1.0×; 12-18 or 0.85-0.95 → 1.2×; ≥18 or ≥0.95 → 1.7×.",
    ),
  health_inequalities: z
    .object({
      affected_groups: z.array(z.string()).default([]),
      baseline_disparity_evidence: z.string().optional(),
      intervention_impact: caseInsensitiveEnum([
        "narrows",
        "neutral",
        "widens",
        "unknown",
      ] as const).default("unknown"),
      mitigation_plan: z.string().optional(),
    })
    .optional()
    .describe(
      "Health inequalities evidence per the NICE PMG36 May 2025 modular update. List affected populations, baseline disparity evidence, and the intervention's expected impact on inequality (narrows/neutral/widens). Required by NICE for any intervention that affects disadvantaged groups.",
    ),
  pv_classification: z
    .object({
      primary_category: z.enum([
        "PASS_imposed",
        "PASS_voluntary",
        "PAES",
        "RMP_Annex_4_study",
        "DUS",
        "active_surveillance_registry",
        "pregnancy_registry",
        "spontaneous_reporting_only",
        "ICH_E2E_pharmacovigilance_plan",
        "not_pv_study",
      ]),
      alternatives: z
        .array(
          z.enum([
            "PASS_imposed",
            "PASS_voluntary",
            "PAES",
            "RMP_Annex_4_study",
            "DUS",
            "active_surveillance_registry",
            "pregnancy_registry",
            "spontaneous_reporting_only",
            "ICH_E2E_pharmacovigilance_plan",
            "not_pv_study",
          ]),
        )
        .optional()
        .default([]),
      gvp_module: z.enum(["V", "VI", "VIII", "VIII_Addendum_I"]),
      gvp_revision: z.literal("rev_4"),
      encepp_study_category: z.string().optional(),
      rmp_implications: z.array(z.string()).default([]),
      fda_analogue: z.string().optional(),
      submission_obligations: z.array(z.string()).default([]),
      rationale: z.string().optional().default(""),
    })
    .optional()
    .describe(
      "Optional: structured PV classification from the pv_classify tool. When provided, the dossier output includes a Pharmacovigilance Plan section with the GVP module, ENCePP template, submission obligations, and RMP implications. When omitted, the section is replaced with a one-line note flagging the gap.",
    ),
  unmet_need_summary: z
    .string()
    .optional()
    .describe(
      "Optional: 1-paragraph unmet need synthesis from the evidence.unmet_need tool. When provided and hta_body='nice', prepended to the Unmet Need section (NICE STA Section B). When hta_body='gvd', prepended to the 'Unmet Need' section (GVD Section 4). Pipe evidence.unmet_need result.unmet_need_summary here.",
    ),
  // Design log #26: accept regulatory_landscape from hta_workflow Phase 3.6
  regulatory_landscape: z
    .array(z.unknown())
    .optional()
    .describe(
      "Optional: array of RegulatoryStatusResult objects from regulatory.status_check (via hta_workflow Phase 3.6). When provided and hta_body in {nice, jca, gvd, amcp}, renders a 'Regulatory Landscape' section with a comparator × region × status table before the gap analysis. Design log #26.",
    ),
  // Design log #27: MFN (Most-Favored-Nation) pricing context.
  // Auto-rendered for hta_body:"amcp" (US dossiers always); opt-in for
  // other bodies (renders when basket_prices is supplied). The basket
  // is the 19-country CMS GUARD/GLOBE OECD reference set (see
  // src/data/mfnBasket.ts).
  mfn_context: z
    .object({
      basket_prices: z
        .record(z.string(), z.number().nonnegative().finite())
        .optional()
        .describe(
          "Map of ISO 3166-1 alpha-2 country code → net price in basket country, e.g. { DE: 100, FR: 95, GB: 110 }. Unsupplied countries are reported as missing in the dossier section.",
        ),
      us_current_net_price: z
        .number()
        .nonnegative()
        .finite()
        .optional()
        .describe(
          "Optional: current US net price for context. When supplied alongside basket_prices, the section quantifies the gap to the projected MFN ceiling.",
        ),
      basket_revision: z
        .string()
        .optional()
        .describe(
          "Optional override of the basket revision stamp. Defaults to the constant in src/data/mfnBasket.ts (currently 2026-03).",
        ),
      excluded_countries: z
        .array(z.string())
        .optional()
        .describe(
          "Optional: ISO-2 country codes to exclude from the ceiling computation (e.g. drug not marketed there). Filters down from the 19-country basket.",
        ),
    })
    .optional()
    .describe(
      "Optional: Most-Favored-Nation pricing context. Auto-renders for hta_body='amcp' (US dossiers); opt-in for other bodies via basket_prices presence. Adds 'MFN Exposure' section per CMS GUARD/GLOBE rules. Design log #27.",
    ),
});
import {
  createAuditRecord,
  addAssumption,
  addWarning,
  setMethodology,
} from "../audit/builder.js";
import { assessInconsistency } from "../grade/inconsistency.js";
import { assessUpgrading } from "../grade/upgrading.js";
import { auditToMarkdown } from "../formatters/markdown.js";
import { extractDisclosureLevel } from "../formatters/disclosure.js";
import { contentToDocx } from "../formatters/docx.js";
import { saveReport } from "../knowledge/index.js";
import { saveDossier } from "../knowledge/index.js";

const NICE_STA_SECTIONS = [
  "Population",
  "Intervention",
  "Comparators",
  "Outcomes (PICO)",
  "Clinical Evidence Summary",
  "Economic Evidence Summary",
  "Unmet Need",
  "Place in Therapy",
];

const EMA_SECTIONS = [
  "Product Description",
  "Clinical Pharmacology",
  "Efficacy Data",
  "Safety Data",
  "Risk-Benefit Assessment",
];

const FDA_SECTIONS = [
  "Indication",
  "Clinical Studies",
  "Adverse Reactions",
  "Dosage and Administration",
  "Clinical Pharmacology",
];

const JCA_SECTIONS = [
  "Scope Confirmation",
  "Population and Disease Context",
  "Intervention",
  "Comparators",
  "Outcomes",
  "Comparative Clinical Effectiveness",
  "Indirect Treatment Comparison",
  "Comparative Safety",
  "Evidence Certainty (GRADE)",
  "Evidence Gaps and Uncertainty",
];

const GVD_SECTIONS = [
  "Executive Summary",
  "Disease Background and Epidemiology",
  "Current Standard of Care",
  "Unmet Need",
  "Product Description and Mechanism of Action",
  "Clinical Evidence",
  "Comparative Effectiveness",
  "Safety Profile",
  "Health Economic Summary",
  "Patient Reported Outcomes and Quality of Life",
  "Policy Environment and Market Access Landscape",
  "Implementation Considerations",
  "Evidence Gaps and Ongoing Studies",
];

const SECTIONS_BY_BODY: Record<string, string[]> = {
  nice: NICE_STA_SECTIONS,
  ema: EMA_SECTIONS,
  fda: FDA_SECTIONS,
  iqwig: NICE_STA_SECTIONS,
  has: NICE_STA_SECTIONS,
  jca: JCA_SECTIONS,
  gvd: GVD_SECTIONS,
};

const METHODOLOGY_BY_BODY: Record<string, string> = {
  nice: "NICE STA guidance v3.0 (2022)",
  ema: "EMA Common Technical Document format",
  fda: "FDA Prescribing Information format",
  iqwig: "IQWiG Methods v6.1",
  has: "HAS transparency committee dossier format",
  jca: "EUHTA Regulation (EU) 2021/2282 — Joint Clinical Assessment",
  gvd: "Global Value Dossier — cross-market foundational evidence document (ISPOR GVD best practices)",
};

/**
 * Auto-generate GRADE evidence quality assessment from literature results.
 *
 * GRADE domains: Risk of bias, Inconsistency, Indirectness, Imprecision, Publication bias
 * Ratings: High, Moderate, Low, Very Low
 *
 * Uses study type counts and basic heuristics from the evidence set.
 */
interface RobResultsSummary {
  rob_judgment: string;
  downgrade: boolean;
  rationale: string;
}

interface RobResults {
  summary: RobResultsSummary;
  overall_certainty_start: "High" | "Low";
}

type HeterogeneityPerOutcome = Record<
  string,
  { i_squared_pct: number; n_studies: number }
>;

type UpgradingPerOutcome = Record<
  string,
  {
    large_effect?: "none" | "large" | "very_large";
    dose_response?: boolean;
    plausible_confounding_toward_null?: boolean;
  }
>;

type PvClassificationInput = z.infer<typeof DossierSchema>["pv_classification"];
type SeverityModifierInput = z.infer<typeof DossierSchema>["severity_modifier"];
type HealthInequalitiesInput = z.infer<
  typeof DossierSchema
>["health_inequalities"];

/**
 * NICE PMG36 severity modifier weight per absolute and proportional QALY
 * shortfall. The higher of the two thresholds wins. Replaced the
 * end-of-life modifier in April 2022 in opportunity-cost-neutral form.
 */
function severityModifierWeight(
  absolute?: number,
  proportional?: number,
): { weight: 1.0 | 1.2 | 1.7; band: string } {
  const weights: Array<1.0 | 1.2 | 1.7> = [1.0];
  if ((absolute ?? 0) >= 12 || (proportional ?? 0) >= 0.85) weights.push(1.2);
  if ((absolute ?? 0) >= 18 || (proportional ?? 0) >= 0.95) weights.push(1.7);
  const weight = weights[weights.length - 1];
  if (weight === 1.7) return { weight, band: "Severe" };
  if (weight === 1.2) return { weight, band: "Moderate" };
  return { weight: 1.0, band: "No modifier" };
}

function appendSeverityModifierSection(
  lines: string[],
  sm: SeverityModifierInput,
): void {
  if (!sm) return;
  const { weight, band } = severityModifierWeight(
    sm.absolute_qaly_shortfall,
    sm.proportional_qaly_shortfall,
  );
  lines.push("## Severity Modifier (NICE PMG36)");
  lines.push(
    `**Replaced the end-of-life modifier in April 2022** in an opportunity-cost-neutral form (PMG36 §4.4).`,
  );
  if (sm.absolute_qaly_shortfall !== undefined) {
    lines.push(
      `- Absolute QALY shortfall: **${sm.absolute_qaly_shortfall.toFixed(1)} QALYs**`,
    );
  }
  if (sm.proportional_qaly_shortfall !== undefined) {
    lines.push(
      `- Proportional QALY shortfall: **${(sm.proportional_qaly_shortfall * 100).toFixed(0)}%**`,
    );
  }
  lines.push("");
  lines.push(`**Severity band:** ${band}`);
  lines.push(`**QALY weight applied:** ×${weight.toFixed(1)}`);
  lines.push("");
  lines.push(
    "Effective WTP threshold = nominal WTP × QALY weight. With the standard NICE £20-30K/QALY threshold this yields:",
  );
  lines.push("");
  lines.push("| Band | Weight | Effective £/QALY threshold |");
  lines.push("|------|--------|----------------------------|");
  lines.push("| No modifier | ×1.0 | £20,000-30,000 |");
  lines.push("| Moderate | ×1.2 | £24,000-36,000 |");
  lines.push("| Severe | ×1.7 | £34,000-51,000 |");
  lines.push("");
}

function appendHealthInequalitiesSection(
  lines: string[],
  hi: HealthInequalitiesInput,
): void {
  lines.push("## Health Inequalities (NICE PMG36 May 2025 update)");
  if (!hi) {
    lines.push(
      "*Health Inequalities not provided. NICE's May 2025 inequalities methods update requires evidence on whether the technology narrows, leaves unchanged, or widens disparities for affected populations. Add `health_inequalities` to the dossier inputs to populate this section.*",
    );
    lines.push("");
    return;
  }
  lines.push(
    `*Per NICE PMG36 May 2025 modular update on the approach to providing evidence on the impact of health inequalities.*`,
  );
  lines.push("");
  if (hi.affected_groups.length > 0) {
    lines.push("**Affected groups:**");
    for (const g of hi.affected_groups) lines.push(`- ${g}`);
    lines.push("");
  }
  if (hi.baseline_disparity_evidence) {
    lines.push("**Baseline disparity evidence:**");
    lines.push(`> ${hi.baseline_disparity_evidence}`);
    lines.push("");
  }
  const impactLabels: Record<
    NonNullable<HealthInequalitiesInput>["intervention_impact"],
    string
  > = {
    narrows: "✅ **Narrows** — intervention reduces disparity",
    neutral: "⚪ **Neutral** — intervention does not change disparity",
    widens: "⚠️ **Widens** — intervention increases disparity (warning)",
    unknown: "❓ **Unknown** — disparity impact not assessed",
  };
  lines.push(
    `**Intervention impact:** ${impactLabels[hi.intervention_impact]}`,
  );
  lines.push("");
  if (hi.mitigation_plan) {
    lines.push("**Mitigation plan:**");
    lines.push(hi.mitigation_plan);
    lines.push("");
  }
}

function appendPvPlanSection(lines: string[], pv: PvClassificationInput): void {
  if (!pv) {
    lines.push("## Pharmacovigilance Plan");
    lines.push(
      "*PV plan not provided — call `pv_classify` first and pass the structured `pv_classification` to populate this section.*",
    );
    lines.push("");
    return;
  }
  lines.push("## Pharmacovigilance Plan");
  lines.push(`**Primary category:** \`${pv.primary_category}\``);
  if (pv.alternatives && pv.alternatives.length > 0) {
    lines.push(
      `**Alternatives:** ${pv.alternatives.map((c) => `\`${c}\``).join(", ")}`,
    );
  }
  lines.push(
    `**GVP Module:** Module ${pv.gvp_module} (EMA GVP ${pv.gvp_revision.replace("_", " ")})`,
  );
  if (pv.encepp_study_category) {
    lines.push(`**ENCePP category:** ${pv.encepp_study_category}`);
  }
  if (pv.fda_analogue) {
    lines.push(`**FDA analogue:** ${pv.fda_analogue}`);
  }
  lines.push("");
  if (pv.rationale) {
    lines.push(`*${pv.rationale}*`);
    lines.push("");
  }
  if (pv.submission_obligations && pv.submission_obligations.length > 0) {
    lines.push("### Submission Obligations");
    for (const o of pv.submission_obligations) lines.push(`- ${o}`);
    lines.push("");
  }
  if (pv.rmp_implications && pv.rmp_implications.length > 0) {
    lines.push("### RMP Implications");
    for (const r of pv.rmp_implications) lines.push(`- ${r}`);
    lines.push("");
  }
}

function generateGradeTable(
  evidence: LiteratureResult[],
  outcomes: string[],
  robResults?: RobResults,
  heterogeneityPerOutcome?: HeterogeneityPerOutcome,
  upgradingPerOutcome?: UpgradingPerOutcome,
): string {
  if (evidence.length === 0) return "";

  // Count study types
  const rctCount = evidence.filter(
    (r) =>
      r.study_type?.toLowerCase().includes("rct") ||
      r.study_type?.toLowerCase().includes("randomized") ||
      r.study_type?.toLowerCase().includes("randomised"),
  ).length;
  const maCount = evidence.filter(
    (r) =>
      r.study_type?.toLowerCase().includes("meta") ||
      r.study_type?.toLowerCase().includes("systematic"),
  ).length;
  const obsCount = evidence.filter(
    (r) =>
      r.study_type?.toLowerCase().includes("observational") ||
      r.study_type?.toLowerCase().includes("cohort") ||
      r.study_type?.toLowerCase().includes("case"),
  ).length;

  // Base certainty: RCTs start High, observational starts Low
  const hasRCTs = rctCount > 0;
  const hasMAs = maCount > 0;

  function assessOutcome(outcome: string): {
    certainty: string;
    rob: string;
    inconsistency: string;
    indirectness: string;
    imprecision: string;
    pub_bias: string;
    rationale: string;
  } {
    // Check if any evidence mentions this outcome
    const relevant = evidence.filter(
      (r) =>
        r.title?.toLowerCase().includes(outcome.toLowerCase()) ||
        r.abstract?.toLowerCase().includes(outcome.toLowerCase()),
    );
    const nRelevant = relevant.length;

    // Risk of bias — use structured assessment when available, else heuristic
    const rob = robResults
      ? robResults.summary.rob_judgment
      : hasRCTs || hasMAs
        ? "Low"
        : "High";

    // Inconsistency: prefer I² from heterogeneity tool; fall back to k-based
    // assessment that correctly returns "not_assessable" for k≤1 (single
    // study cannot be inconsistent with itself — Cochrane Handbook 10.10).
    const heteroForOutcome = heterogeneityPerOutcome?.[outcome];
    const inconsistencyAssessment = heteroForOutcome
      ? assessInconsistency(
          heteroForOutcome.n_studies,
          heteroForOutcome.i_squared_pct,
        )
      : assessInconsistency(nRelevant, null);
    const inconsistency = inconsistencyAssessment.level;

    // Indirectness: assume moderate unless direct evidence exists
    const indirectness = nRelevant > 0 ? "Low" : "Serious";

    // Imprecision: based on study count
    const imprecision =
      nRelevant >= 3 ? "Low" : nRelevant >= 1 ? "Moderate" : "Serious";

    // Publication bias
    const pub_bias = hasMAs ? "Low" : nRelevant >= 5 ? "Low" : "Suspected";

    // Overall certainty — use principled downgrade_steps from inconsistency
    // assessment (0/1/2) instead of binary string match
    let downgrades = 0;
    if (rob === "High") downgrades++;
    downgrades += inconsistencyAssessment.downgrade_steps;
    if (indirectness === "Serious") downgrades++;
    if (imprecision === "Serious") downgrades++;
    if (pub_bias === "Suspected") downgrades++;

    // GRADE upgrading (Guyatt 2011) — only applies to observational evidence
    // (start_certainty = Low). Capped at +2.
    const startCertainty: "High" | "Low" = robResults
      ? robResults.overall_certainty_start
      : hasRCTs
        ? "High"
        : "Low";
    const upgradeFlags = upgradingPerOutcome?.[outcome];
    const upgradingAssessment = upgradeFlags
      ? assessUpgrading({ start_certainty: startCertainty, ...upgradeFlags })
      : { upgrade_steps: 0 as 0 | 1 | 2, rationale: "" };

    const baseLevel = startCertainty === "High" ? 4 : 2; // High=4, Low=2
    // Apply downgrades, then upgrades (GRADE order). Cap at [1, 4].
    const finalLevel = Math.min(
      4,
      Math.max(1, baseLevel - downgrades + upgradingAssessment.upgrade_steps),
    );
    const certainty =
      finalLevel >= 4
        ? "High"
        : finalLevel >= 3
          ? "Moderate"
          : finalLevel >= 2
            ? "Low"
            : "Very Low";

    const rationale = [
      rob !== "Low" ? `RoB: ${rob}` : "",
      inconsistency !== "Low" && inconsistency !== "not_assessable"
        ? `Inconsistency: ${inconsistencyAssessment.rationale}`
        : "",
      indirectness !== "Low" ? `Indirectness: ${indirectness}` : "",
      imprecision !== "Low" ? `Imprecision: ${imprecision}` : "",
      upgradingAssessment.upgrade_steps > 0
        ? `Upgraded +${upgradingAssessment.upgrade_steps}: ${upgradingAssessment.rationale}`
        : "",
      pub_bias !== "Low" ? `Pub. bias: ${pub_bias}` : "",
    ]
      .filter(Boolean)
      .join("; ");

    return {
      certainty,
      rob,
      inconsistency,
      indirectness,
      imprecision,
      pub_bias,
      rationale: rationale || "No downgrading",
    };
  }

  // Auto-merge: if the user passed upgrading_per_outcome or
  // heterogeneity_per_outcome with a custom outcome key (e.g., "mortality",
  // "MACE composite"), include that outcome in the GRADE table iteration
  // so the flag actually fires. Without this, the flag was silently dropped.
  const customOutcomeKeys = new Set<string>([
    ...Object.keys(upgradingPerOutcome ?? {}),
    ...Object.keys(heterogeneityPerOutcome ?? {}),
  ]);
  const baseOutcomes =
    outcomes.length > 0
      ? outcomes
      : [
          "overall survival",
          "progression-free survival",
          "quality of life",
          "adverse events",
        ];
  // Merge while preserving order and de-duplicating (case-insensitive).
  const seenLower = new Set<string>();
  const assessedOutcomes: string[] = [];
  for (const o of [...baseOutcomes, ...customOutcomeKeys]) {
    const k = o.toLowerCase();
    if (!seenLower.has(k)) {
      seenLower.add(k);
      assessedOutcomes.push(o);
    }
  }

  const lines: string[] = [
    `### GRADE Evidence Quality Assessment`,
    ``,
    `Based on ${evidence.length} studies (${rctCount} RCTs, ${maCount} systematic reviews/meta-analyses, ${obsCount} observational):`,
    ``,
    `| Outcome | Certainty | RoB | Inconsistency | Indirectness | Imprecision | Pub. Bias | Rationale |`,
    `|---------|-----------|-----|---------------|-------------|-------------|-----------|-----------|`,
  ];

  for (const outcome of assessedOutcomes) {
    const a = assessOutcome(outcome);
    const certIcon =
      a.certainty === "High"
        ? "++++"
        : a.certainty === "Moderate"
          ? "+++-"
          : a.certainty === "Low"
            ? "++--"
            : "+---";
    lines.push(
      `| ${outcome} | **${a.certainty}** ${certIcon} | ${a.rob} | ${a.inconsistency} | ${a.indirectness} | ${a.imprecision} | ${a.pub_bias} | ${a.rationale} |`,
    );
  }

  lines.push(``);
  const robSource = robResults
    ? "structured Risk of Bias assessment (RoB 2/ROBINS-I/AMSTAR-2)"
    : "study counts and types (heuristic — run `evidence.risk_of_bias` tool for structured assessment)";
  lines.push(
    `> **Note:** RoB domain sourced from ${robSource}. All other domains are automated estimates. A definitive GRADE evaluation requires clinical expert judgment. See [GRADE Handbook](https://gdt.gradepro.org/app/handbook/handbook.html).`,
  );
  lines.push(``);

  return lines.join("\n");
}

function buildSection(
  name: string,
  drugName: string,
  indication: string,
  evidenceSummary?: string | LiteratureResult[],
): { content: string; status: "complete" | "partial" | "missing" } {
  const evidence =
    typeof evidenceSummary === "string"
      ? evidenceSummary
      : Array.isArray(evidenceSummary) && evidenceSummary.length > 0
        ? evidenceSummary
            .map((r) => `- ${r.title} (${r.source}, ${r.date})`)
            .join("\n")
        : null;

  switch (name) {
    case "Population":
      return {
        content: `Adult patients with ${indication} requiring pharmacological treatment.`,
        status: "complete",
      };
    case "Intervention":
      return {
        content: `${drugName} as described in the Summary of Product Characteristics (SmPC).`,
        status: "complete",
      };
    case "Comparators":
      return {
        content: `⚠️ Comparators not specified — provide current standard of care and relevant licensed alternatives for ${indication}.`,
        status: "missing",
      };
    case "Outcomes (PICO)":
      return {
        content: `⚠️ Define primary and secondary outcomes for ${indication}. Typically includes a clinical effectiveness endpoint, mortality/survival where applicable, quality of life (EQ-5D or disease-specific PROs), hospitalization rate, and adverse events. Confirm selection with clinical advisor and HTA scoping decision.`,
        status: "missing",
      };
    case "Clinical Evidence Summary":
      return evidence
        ? { content: evidence, status: "complete" }
        : {
            content: `⚠️ Clinical evidence not provided. Pipe output from literature.search to populate this section.`,
            status: "missing",
          };
    case "Economic Evidence Summary":
      return {
        content: `⚠️ Economic model results not provided. Run models.cost_effectiveness and pipe results here.`,
        status: "missing",
      };
    default:
      return {
        content: `⚠️ ${name} — populate with submission-specific content.`,
        status: "missing",
      };
  }
}

function buildJCASection(
  name: string,
  drugName: string,
  indication: string,
  pico: PicoDefinition,
  evidenceSummary?: string | LiteratureResult[],
): { content: string; status: "complete" | "partial" | "missing" } {
  const evidence =
    typeof evidenceSummary === "string"
      ? evidenceSummary
      : Array.isArray(evidenceSummary) && evidenceSummary.length > 0
        ? evidenceSummary
            .map((r) => `- ${r.title} (${r.source}, ${r.date})`)
            .join("\n")
        : null;

  switch (name) {
    case "Scope Confirmation":
      return {
        content:
          `**PICO ${pico.id}** — Scope as confirmed by HTA Coordination Group.\n` +
          `Population: ${pico.population}\nIntervention: ${drugName}\nComparator: ${pico.comparator}\n` +
          `Outcomes: ${pico.outcomes.join(", ")}`,
        status: "complete",
      };
    case "Population and Disease Context":
      return {
        content:
          `${pico.population} with ${indication}.\n` +
          `⚠️ Provide epidemiology, disease burden, and unmet need across relevant EU member states.`,
        status: "partial",
      };
    case "Intervention":
      return {
        content:
          `${drugName} as per EMA-approved Summary of Product Characteristics (SmPC).\n` +
          `⚠️ Reference the exact label wording — scope is tied to the approved indication.`,
        status: "complete",
      };
    case "Comparators":
      return {
        content:
          `**Primary comparator:** ${pico.comparator}\n` +
          `⚠️ Verify comparator relevance across all 27 EU member states. Include all nationally relevant alternatives identified during scoping.`,
        status: "partial",
      };
    case "Outcomes":
      return {
        content:
          pico.outcomes.length > 0
            ? `Assessed outcomes:\n${pico.outcomes.map((o) => `- ${o}`).join("\n")}`
            : `⚠️ No outcomes specified for this PICO. Provide primary and secondary endpoints as per scoping decision.`,
        status: pico.outcomes.length > 0 ? "complete" : "missing",
      };
    case "Comparative Clinical Effectiveness":
      return evidence
        ? {
            content:
              `Relative effects of ${drugName} vs ${pico.comparator}:\n${evidence}\n` +
              `⚠️ Express results as relative risk (RR), hazard ratio (HR), or mean difference (MD) with 95% CI.`,
            status: "partial",
          }
        : {
            content: `⚠️ No clinical evidence provided. Pipe output from literature.search to populate relative effects for ${pico.comparator}.`,
            status: "missing",
          };
    case "Indirect Treatment Comparison":
      return {
        content:
          `**ITC Feasibility Assessment:**\n` +
          `⚠️ Assess whether a connected evidence network exists between ${drugName} and ${pico.comparator}.\n` +
          `- If direct head-to-head evidence exists: state this and provide summary.\n` +
          `- If only indirect evidence: specify method (MAIC, STC, or NMA) and justify selection.\n` +
          `- JCA strongly prefers anchored indirect comparisons. Unanchored MAIC requires explicit justification.\n` +
          `- Note any heterogeneity in effect modifiers across included studies.`,
        status: "missing",
      };
    case "Comparative Safety":
      return {
        content:
          `Comparative safety of ${drugName} vs ${pico.comparator}:\n` +
          `⚠️ Provide: serious adverse events (SAEs), treatment discontinuations, adverse events of special interest (AESIs).\n` +
          `Express as relative risk with 95% CI where possible.`,
        status: "missing",
      };
    case "Evidence Certainty (GRADE)":
      return {
        content:
          `GRADE certainty assessment for ${pico.id}:\n` +
          `| Outcome | Certainty | Rationale |\n` +
          `|---|---|---|\n` +
          pico.outcomes
            .map(
              (o) =>
                `| ${o} | ⚠️ TBC | Assess risk of bias, inconsistency, indirectness, imprecision |`,
            )
            .join("\n") +
          `\n\n⚠️ Complete GRADE table with clinical advisor.`,
        status: "missing",
      };
    case "Evidence Gaps and Uncertainty":
      return {
        content:
          `Known evidence gaps for PICO ${pico.id}:\n` +
          `- ⚠️ List data limitations (immature survival data, missing subgroups, short follow-up)\n` +
          `- ⚠️ Flag patient populations not represented in trials\n` +
          `- ⚠️ Note impact of evidence gaps on certainty of results\n` +
          `This section will be referenced by national HTA bodies conducting cost-effectiveness analyses.`,
        status: "missing",
      };
    default:
      return {
        content: `⚠️ ${name} — populate with JCA submission-specific content for PICO ${pico.id}.`,
        status: "missing",
      };
  }
}

async function handleJCADossier(
  params: DossierParams,
  audit: ReturnType<typeof createAuditRecord>,
  disclosureLevel: import("../formatters/disclosure.js").AiDisclosureLevel = "submission",
): Promise<ToolResult> {
  // Default single PICO if none provided
  const picos: PicoDefinition[] =
    params.picos && params.picos.length > 0
      ? params.picos
      : [
          {
            id: "PICO-1",
            population: `Adults with ${params.indication}`,
            comparator: "Current standard of care",
            outcomes: [
              "Overall survival",
              "Progression-free survival",
              "Quality of life (EQ-5D)",
              "Adverse events",
            ],
          },
        ];

  audit = addAssumption(
    audit,
    `EUHTA Regulation (EU) 2021/2282 — Joint Clinical Assessment`,
  );
  audit = addAssumption(audit, `${picos.length} PICO(s) assessed`);
  audit = addAssumption(
    audit,
    `JCA covers comparative clinical effectiveness and safety only. National cost-effectiveness assessment remains at member state level.`,
  );
  if (picos.length === 1 && (!params.picos || params.picos.length === 0)) {
    audit = addWarning(
      audit,
      `No PICOs provided — generated default PICO. Provide picos[] array for accurate JCA structure reflecting actual scoping decisions.`,
    );
  }
  if (picos.length > 10) {
    audit = addWarning(
      audit,
      `${picos.length} PICOs — complex submission. Ensure each PICO has dedicated evidence package.`,
    );
  }

  const lines: string[] = [];
  lines.push(`## EU Joint Clinical Assessment (JCA) Dossier Draft`);
  lines.push(
    `**Drug:** ${params.drug_name} | **Indication:** ${params.indication}`,
  );
  lines.push(
    `**Regulation:** EUHTA (EU) 2021/2282 | **PICOs:** ${picos.length}`,
  );
  lines.push(`**Submission type:** ${params.submission_type.toUpperCase()}`);
  lines.push(
    `\n> ⚠️ JCA covers comparative clinical effectiveness and safety **only**. Economic evaluation (cost-effectiveness) remains at national level.\n`,
  );

  const allGaps: string[] = [];

  for (const pico of picos) {
    lines.push(`---\n## ${pico.id}: ${pico.population} vs ${pico.comparator}`);
    for (const sectionName of JCA_SECTIONS) {
      const { content, status } = buildJCASection(
        sectionName,
        params.drug_name,
        params.indication,
        pico,
        params.evidence_summary,
      );
      lines.push(`### ${sectionName}`);
      lines.push(content);
      lines.push("");
      if (status === "missing") {
        const gap = `[${pico.id}] ${sectionName}`;
        allGaps.push(gap);
        audit = addWarning(
          audit,
          `Section "${sectionName}" (${pico.id}) requires additional input`,
        );
      }
    }
  }

  // Design log #26: Regulatory Landscape for JCA path
  if (
    params.regulatory_landscape &&
    params.regulatory_landscape.length > 0 &&
    REGULATORY_LANDSCAPE_BODIES.has(params.hta_body)
  ) {
    const regSection = renderRegulatoryLandscapeSection(
      params.regulatory_landscape,
      params.indication,
    );
    if (regSection) {
      lines.push("---");
      lines.push(regSection);
      audit = addAssumption(
        audit,
        `Regulatory Landscape section rendered for ${params.regulatory_landscape.length} comparator/region combination(s). Design log #26.`,
      );
    }
  }

  if (allGaps.length > 0) {
    lines.push(
      `---\n## Gap Analysis (${allGaps.length} sections require input)`,
    );
    allGaps.forEach((g) => lines.push(`- ⚠️ ${g}`));
    lines.push("");
  }

  lines.push(
    auditToMarkdown(audit, {
      disclosure: { level: disclosureLevel },
    }),
  );

  const outputFormat = params.output_format ?? "text";
  const jcaTextContent = lines.join("\n");

  if (params.project) {
    try {
      await saveDossier(
        params.project,
        params.hta_body,
        params.submission_type,
        { drug_name: params.drug_name, indication: params.indication },
        jcaTextContent,
      );
    } catch {}
  }

  if (outputFormat === "docx") {
    const base64 = await contentToDocx(
      `JCA ${params.submission_type.toUpperCase()} Dossier`,
      jcaTextContent,
      audit,
    );
    const filenameStem = `jca-${params.submission_type}-${params.drug_name.slice(0, 30)}-${params.indication.slice(0, 30)}`;
    const savedPath = await saveReport(base64, filenameStem, params.project);
    const sizeKb = Math.round(base64.length / 1024);
    return {
      content: `## DOCX Report Generated\n\n**File:** \`${savedPath}\`\n**Size:** ${sizeKb} KB\n**Type:** JCA ${params.submission_type.toUpperCase()} Dossier\n**Drug:** ${params.drug_name}\n**Indication:** ${params.indication}\n\nOpen with: \`open "${savedPath}"\``,
      audit,
    };
  }

  return { content: jcaTextContent, audit };
}

// ── Design log #27: MFN Exposure section ─────────────────────────────────

// Bodies for which the MFN section may render. v1.11.0 ships opt-in only
// across every live body — render when basket_prices is supplied. The
// "amcp" body is reserved per design log #24 (AMCP Format 4.1); when it
// ships, add it to MFN_AUTO_BODIES so US dossiers always show MFN
// context regardless of whether basket_prices was supplied.
const MFN_AUTO_BODIES = new Set<string>([]); // intentionally empty in v1.11.0
const MFN_OPTIN_BODIES = new Set([
  "nice",
  "jca",
  "gvd",
  "iqwig",
  "has",
  "ema",
  "fda",
]);

function renderMfnExposureSection(
  ctx: NonNullable<DossierParams["mfn_context"]>,
  hta_body: string,
): string {
  const revision = ctx.basket_revision ?? MFN_BASKET_REVISION;
  const excluded = (ctx.excluded_countries ?? []).filter(
    (c): c is CountryIso2 => (MFN_BASKET_2026 as readonly string[]).includes(c),
  );
  const prices = (ctx.basket_prices ?? {}) as Partial<
    Record<CountryIso2, number>
  >;
  const { ceiling, contributing_countries, missing_countries } =
    computeMfnCeiling(prices, { excluded_countries: excluded });

  const lines: string[] = [];
  lines.push(`## MFN Exposure (basket revision ${revision})`);
  lines.push("");
  lines.push(
    `Under the CMS proposed payment models (GUARD = Medicare Part D MFN; GLOBE = Medicare Part B MFN), the US net price for an MFN-eligible drug is bounded by the minimum net price observed across a basket of ${MFN_BASKET_2026.length} OECD countries (PPP-adjusted GDP per capita ≥ 60% of US AND total GDP ≥ $400B).`,
  );
  lines.push("");

  // Price table — every basket country, with user-supplied price or "not provided".
  lines.push("| Country | ISO | Net price | Status |");
  lines.push("|---|---|---:|---|");
  for (const code of MFN_BASKET_2026) {
    const name = MFN_COUNTRY_NAMES[code];
    const isExcluded = excluded.includes(code);
    const price = prices[code];
    if (isExcluded) {
      lines.push(`| ${name} | ${code} | — | excluded by caller |`);
    } else if (price === undefined) {
      lines.push(`| ${name} | ${code} | — | not provided |`);
    } else {
      const isMin = ceiling !== null && price === ceiling;
      lines.push(
        `| ${name} | ${code} | ${price} | ${isMin ? "**minimum (sets ceiling)**" : "supplied"} |`,
      );
    }
  }
  lines.push("");

  // Ceiling summary.
  if (ceiling === null) {
    lines.push(
      `**Projected US net price ceiling:** insufficient basket data (no prices supplied for any of the ${MFN_BASKET_2026.length - excluded.length} active basket countries).`,
    );
  } else {
    lines.push(
      `**Projected US net price ceiling:** ${ceiling} (minimum of ${contributing_countries.length} supplied basket price${contributing_countries.length === 1 ? "" : "s"}; ${missing_countries.length} country price${missing_countries.length === 1 ? "" : "s"} not provided).`,
    );
    if (ctx.us_current_net_price !== undefined) {
      const gap = ctx.us_current_net_price - ceiling;
      const pctDown =
        ctx.us_current_net_price > 0
          ? ((gap / ctx.us_current_net_price) * 100).toFixed(1)
          : "n/a";
      const direction =
        gap > 0
          ? `requires a ${pctDown}% reduction from current US net price (${ctx.us_current_net_price} → ${ceiling})`
          : gap < 0
            ? `is already above current US net price — no MFN-driven reduction required at this basket`
            : `equals current US net price exactly`;
      lines.push("");
      lines.push(`**Gap to current US:** ${direction}.`);
    }
  }
  lines.push("");

  // Risk callouts — only when we actually have a ceiling to defend against.
  if (ceiling !== null) {
    lines.push("**Mitigation recommendations:**");
    lines.push(
      "- **Anchor evidence to the strictest HTA in basket** (NICE / IQWiG / HAS define the global value-based price ceiling).",
    );
    lines.push(
      "- **Align comparator strategy early** via HTA scientific advice and supportive real-world evidence on the local standard of care.",
    );
    lines.push(
      "- **Ensure robust EQ-5D utility data** with sufficient follow-up to reduce modelling uncertainty (use `utility_value_set` for the appropriate value set).",
    );
    lines.push(
      "- **Sequence launches carefully** — early low-price markets cascade downward through IRP baskets and reset the global price floor independently of evidence.",
    );
    lines.push("");
  }

  // Body-specific framing.
  if (MFN_AUTO_BODIES.has(hta_body)) {
    lines.push(
      `*Auto-rendered for US dossier (hta_body=${hta_body}). MFN is in scope by default per CMS rulemaking.*`,
    );
  } else {
    lines.push(
      `*Rendered for hta_body=${hta_body} because basket_prices were supplied; MFN exposure drives the US ceiling for the same asset under CMS GUARD/GLOBE rules.*`,
    );
  }

  return lines.join("\n");
}

// ── Design log #26: Regulatory Landscape section renderer ────────────────

const REGULATORY_LANDSCAPE_BODIES = new Set(["nice", "jca", "gvd", "amcp"]);

interface RegulatoryStatusResultShape {
  drug?: string;
  region?: string;
  current_status?: string;
  approved_indications?: Array<{
    indication_text_verbatim?: string;
    population?: string;
    approval_date?: string | null;
  }>;
  source_urls?: Array<{ source?: string; url?: string }>;
  data_fetched_at?: string;
  api_error?: { message?: string };
}

function isRegulatoryResult(x: unknown): x is RegulatoryStatusResultShape {
  return typeof x === "object" && x !== null;
}

function renderRegulatoryLandscapeSection(
  regulatoryLandscape: unknown[],
  indication: string,
): string {
  const rows: string[] = [];
  const fetchedAt =
    regulatoryLandscape
      .map((r) => (isRegulatoryResult(r) ? r.data_fetched_at : undefined))
      .filter(Boolean)[0]
      ?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

  const header = [
    `### Regulatory Landscape`,
    ``,
    `Current label state for comparators in ${indication}, retrieved from primary-source databases on ${fetchedAt} UTC:`,
    ``,
    `| Comparator | Region | Status | Population (verbatim) | Approval date | Source |`,
    `|------------|--------|--------|------------------------|---------------|--------|`,
  ];

  for (const item of regulatoryLandscape) {
    if (!isRegulatoryResult(item)) continue;

    const drug = item.drug ?? "Unknown";
    const region = (item.region ?? "").toUpperCase();
    const status = item.current_status ?? "unknown";

    let population = "";
    let approvalDate = "—";
    let sourceCell = "—";

    if (status === "approved" && item.approved_indications?.length) {
      const ind = item.approved_indications[0];
      const raw = ind.indication_text_verbatim ?? ind.population ?? "";
      // Truncate to ~120 chars
      population =
        raw.length > 120 ? raw.slice(0, 120).replace(/\s+\S*$/, "") + "…" : raw;
      approvalDate = ind.approval_date ?? "—";
    } else if (status === "unknown") {
      population = "Unknown — primary-source verification needed";
    } else if (status === "api_error") {
      population = `API error: ${item.api_error?.message ?? "unknown error"}`;
    }

    if (item.source_urls?.length) {
      const src = item.source_urls[0];
      sourceCell = src.url
        ? `[${src.source ?? "Source"}](${src.url})`
        : (src.source ?? "—");
    }

    const statusLabel =
      status === "approved"
        ? "Approved"
        : status === "unknown"
          ? "Unknown"
          : status === "api_error"
            ? "API error"
            : status;

    rows.push(
      `| ${drug} | ${region} | ${statusLabel} | ${population} | ${approvalDate} | ${sourceCell} |`,
    );
  }

  if (rows.length === 0) return "";

  return [...header, ...rows, ""].join("\n");
}

export async function handleHtaDossierPrep(
  rawParams: unknown,
): Promise<ToolResult> {
  const params = DossierSchema.parse(rawParams) as DossierParams;
  const outputFormat = params.output_format ?? "text";
  let audit = createAuditRecord(
    "hta.dossier",
    params as unknown as Record<string, unknown>,
    outputFormat,
  );
  const methodology =
    METHODOLOGY_BY_BODY[params.hta_body] ?? "Unknown HTA body";
  audit = setMethodology(audit, methodology);
  audit = addAssumption(audit, `Template: ${methodology}`);
  audit = addAssumption(
    audit,
    `Submission type: ${params.submission_type.toUpperCase()}`,
  );

  // JCA: generate per-PICO sections
  if (params.hta_body === "jca") {
    return handleJCADossier(
      params,
      audit,
      extractDisclosureLevel(rawParams, "submission"),
    );
  }

  const sections = SECTIONS_BY_BODY[params.hta_body] ?? NICE_STA_SECTIONS;
  const lines: string[] = [];

  lines.push(
    `## ${params.hta_body.toUpperCase()} ${params.submission_type.toUpperCase()} Dossier Draft`,
  );
  lines.push(
    `**Drug:** ${params.drug_name} | **Indication:** ${params.indication}`,
  );
  lines.push(`**Template:** ${methodology}\n`);

  // ── NICE TA precedent surfacing (closes the TA902/TA679 gap
  //    revealed by the management benchmark — see design log #16).
  //    For NICE submissions, we look up the canonical TA for the
  //    drug-indication and emit it upfront. If the user passed a
  //    different TA number anywhere in their evidence_summary
  //    prose, we flag the mismatch with both URLs so the user
  //    can choose the correct one rather than silently overriding.
  if (params.hta_body === "nice") {
    const matches = findPrecedents(params.drug_name, params.indication);
    if (matches.length > 0) {
      const top = matches[0];
      lines.push(`### Relevant NICE Technology Appraisal`);
      lines.push(`- **${top.ta_number}** — ${top.title}`);
      lines.push(`- Date: ${top.date} · URL: ${top.url}`);
      if (top.notes) lines.push(`- ⚠️ ${top.notes}`);
      lines.push("");
      audit = addAssumption(
        audit,
        `Canonical NICE TA precedent surfaced: ${top.ta_number} (${top.title}).`,
      );
      // Scan user-supplied evidence prose for a competing TA number.
      // This catches the "cite TA902 for HFrEF" prompt error pattern.
      if (typeof params.evidence_summary === "string") {
        const userTa = extractTaNumber(params.evidence_summary);
        if (userTa) {
          const mismatch = detectMismatch(
            params.drug_name,
            params.indication,
            userTa,
          );
          if (mismatch) {
            lines.push(
              `> ⚠️ **TA mismatch detected.** ${mismatch.explanation}`,
            );
            lines.push("");
            audit = addWarning(
              audit,
              `User-supplied TA ${mismatch.user_supplied} does not match canonical ${mismatch.canonical} for "${params.drug_name} ${params.indication}".`,
            );
          }
        }
      }
    }
  }

  // ── GVD: delegate to GvdSectionRouter for section-specific prose generators
  if (params.hta_body === "gvd") {
    const {
      lines: gvdLines,
      gaps: gvdGaps,
      gvd_evidence_pack,
    } = routeGvdSections(params);

    for (const line of gvdLines) {
      lines.push(line);
    }

    const gvdGapsList = gvdGaps;
    if (gvdGapsList.length > 0) {
      lines.push(`---`);
      lines.push(`## Gap Analysis`);
      lines.push(
        `The following ${gvdGapsList.length} section(s) require additional information:`,
      );
      gvdGapsList.forEach((g) => lines.push(`- ⚠️ ${g}`));
      lines.push("");
      for (const g of gvdGapsList) {
        audit = addWarning(
          audit,
          `GVD Section "${g}" requires additional input`,
        );
      }
    }

    // Design log #26: Regulatory Landscape for GVD path
    if (params.regulatory_landscape && params.regulatory_landscape.length > 0) {
      const regSection = renderRegulatoryLandscapeSection(
        params.regulatory_landscape,
        params.indication,
      );
      if (regSection) {
        lines.push("---");
        lines.push(regSection);
        audit = addAssumption(
          audit,
          `Regulatory Landscape section rendered for ${params.regulatory_landscape.length} comparator/region combination(s). Design log #26.`,
        );
      }
    }

    // Design log #27: MFN Exposure for GVD path (opt-in via basket_prices).
    // GVD's early-return path skips the shared wire-in lower in the file, so
    // we mirror the check here. Opt-in across every body in v1.11.0.
    const gvdMfnPrices = params.mfn_context?.basket_prices;
    if (gvdMfnPrices && Object.keys(gvdMfnPrices).length > 0) {
      const mfnSection = renderMfnExposureSection(
        params.mfn_context ?? {},
        params.hta_body,
      );
      lines.push("---");
      lines.push(mfnSection);
      audit = addAssumption(
        audit,
        `MFN Exposure section rendered for hta_body=gvd with ${Object.keys(gvdMfnPrices).length} basket price${Object.keys(gvdMfnPrices).length === 1 ? "" : "s"} supplied. Design log #27.`,
      );
    }

    // Append gvd_evidence_pack as a JSON code block for downstream consumption
    lines.push(`---`);
    lines.push(`## GVD Evidence Pack`);
    lines.push(
      `The following structured evidence pack (\`gvd_evidence_pack\`) can be piped into country-specific \`hta_dossier\` calls to pre-fill clinical evidence sections:`,
    );
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(gvd_evidence_pack, null, 2));
    lines.push("```");

    return {
      content: lines.join("\n"),
      audit,
    };
  }

  const gaps: string[] = [];
  for (const sectionName of sections) {
    const { content, status } = buildSection(
      sectionName,
      params.drug_name,
      params.indication,
      params.evidence_summary,
    );
    lines.push(`### ${sectionName}`);
    // Inject unmet_need_summary into the "Unmet Need" section for NICE
    if (
      sectionName === "Unmet Need" &&
      params.unmet_need_summary &&
      params.hta_body === "nice"
    ) {
      lines.push(params.unmet_need_summary);
      lines.push("");
    }
    lines.push(content);
    lines.push("");
    if (status === "missing") {
      gaps.push(sectionName);
      audit = addWarning(
        audit,
        `Section "${sectionName}" requires additional input`,
      );
    }
  }

  // Auto-generate GRADE table when evidence is provided as LiteratureResult[]
  if (
    Array.isArray(params.evidence_summary) &&
    params.evidence_summary.length > 0
  ) {
    const gradeTable = generateGradeTable(
      params.evidence_summary as LiteratureResult[],
      [],
      params.rob_results as RobResults | undefined,
      params.heterogeneity_per_outcome,
      params.upgrading_per_outcome,
    );
    if (gradeTable) {
      lines.push(gradeTable);
      audit = addAssumption(
        audit,
        "GRADE evidence quality assessment auto-generated from literature search results",
      );
    }
  }

  // Design log #26: Regulatory Landscape section for nice/jca/gvd/amcp
  if (
    params.regulatory_landscape &&
    params.regulatory_landscape.length > 0 &&
    REGULATORY_LANDSCAPE_BODIES.has(params.hta_body)
  ) {
    const regSection = renderRegulatoryLandscapeSection(
      params.regulatory_landscape,
      params.indication,
    );
    if (regSection) {
      lines.push("---");
      lines.push(regSection);
      audit = addAssumption(
        audit,
        `Regulatory Landscape section rendered for ${params.regulatory_landscape.length} comparator/region combination(s). Design log #26.`,
      );
    }
  }

  // Design log #27: MFN Exposure section.
  // Auto-renders for hta_body:"amcp" regardless of basket_prices presence
  // (US dossier — MFN is in scope by default per CMS rulemaking; the
  // section then renders with "insufficient basket data" guidance).
  // Opt-in for other bodies via basket_prices presence.
  const isAmcp = MFN_AUTO_BODIES.has(params.hta_body);
  const isOptInWithPrices =
    MFN_OPTIN_BODIES.has(params.hta_body) &&
    params.mfn_context?.basket_prices !== undefined &&
    Object.keys(params.mfn_context.basket_prices).length > 0;
  if (isAmcp || isOptInWithPrices) {
    const mfnSection = renderMfnExposureSection(
      params.mfn_context ?? {},
      params.hta_body,
    );
    lines.push("---");
    lines.push(mfnSection);
    const supplied = Object.keys(
      params.mfn_context?.basket_prices ?? {},
    ).length;
    audit = addAssumption(
      audit,
      `MFN Exposure section rendered for hta_body=${params.hta_body} with ${supplied} basket price${supplied === 1 ? "" : "s"} supplied. Design log #27.`,
    );
  }

  if (gaps.length > 0) {
    lines.push(`---`);
    lines.push(`## Gap Analysis`);
    lines.push(
      `The following ${gaps.length} section(s) require additional information:`,
    );
    gaps.forEach((g) => lines.push(`- ⚠️ ${g}`));
    lines.push("");
  }

  if (params.hta_body === "nice") {
    lines.push(`---`);
    lines.push(`## ⚠️ UK EQ-5D-5L Value Set Transition (2026)`);
    lines.push(
      `NICE consultation on adopting the **new UK EQ-5D-5L value set** is open **2026-04-15 to 2026-05-13**. This replaces the interim DSU 3L→5L mapping algorithm.`,
    );
    lines.push(``);
    lines.push(
      `**Anticipated impact** (Biz, Hernández Alava, Wailoo 2026, *Value in Health* forthcoming — 39 decisions across 37 NICE TAs):`,
    );
    lines.push(``);
    lines.push(`| Indication type | ΔQALY (median) | ΔICER (median) |`);
    lines.push(`|---|---|---|`);
    lines.push(
      `| Cancer, life-extending | +13.7% | −12% (more cost-effective) |`,
    );
    lines.push(
      `| Non-cancer, QoL-only (migraine, UC, atopic dermatitis, HS, plaque psoriasis) | **−37%** | **+59%** (less cost-effective) |`,
    );
    lines.push(`| Non-cancer, life-extending | mixed | −9.6% |`);
    lines.push(``);
    lines.push(
      `**Action items:** (1) Confirm whether trial collected native EQ-5D-5L or only 3L; (2) if only 3L, check whether direct UK 5L mapping algorithm exists (DSU mapping algorithm derives 3L via indirect crosswalk, not 5L directly); (3) run hta.utility (action="estimate_impact") with your indication type to quantify expected ICER change; (4) consider requesting existing NICE flexibilities (e.g., non-EQ-5D evidence where instrument is demonstrably inappropriate).`,
    );
    lines.push(``);
    audit = addAssumption(
      audit,
      "UK EQ-5D-5L value set transition flagged (NICE consultation 2026-04-15 to 2026-05-13)",
    );
  }

  if (params.hta_body === "nice") {
    appendSeverityModifierSection(lines, params.severity_modifier);
    appendHealthInequalitiesSection(lines, params.health_inequalities);
  }

  appendPvPlanSection(lines, params.pv_classification);

  lines.push(
    auditToMarkdown(audit, {
      disclosure: { level: extractDisclosureLevel(rawParams, "submission") },
    }),
  );

  const dossierTextContent = lines.join("\n");

  if (params.project) {
    try {
      await saveDossier(
        params.project,
        params.hta_body,
        params.submission_type,
        { drug_name: params.drug_name, indication: params.indication },
        dossierTextContent,
      );
    } catch {}
  }

  if (outputFormat === "docx") {
    const base64 = await contentToDocx(
      `${params.hta_body.toUpperCase()} ${params.submission_type.toUpperCase()} Dossier`,
      dossierTextContent,
      audit,
    );
    const filenameStem = `${params.hta_body}-${params.submission_type}-${params.drug_name.slice(0, 30)}`;
    const savedPath = await saveReport(base64, filenameStem, params.project);
    const sizeKb = Math.round(base64.length / 1024);
    return {
      content: `## DOCX Report Generated\n\n**File:** \`${savedPath}\`\n**Size:** ${sizeKb} KB\n**Type:** ${params.hta_body.toUpperCase()} ${params.submission_type.toUpperCase()}\n**Drug:** ${params.drug_name}\n**Indication:** ${params.indication}\n\nOpen with: \`open "${savedPath}"\``,
      audit,
    };
  }

  return { content: dossierTextContent, audit };
}

export const htaDossierPrepToolSchema = {
  name: "hta.dossier",
  description:
    'Structure evidence into HTA body-specific submission format (NICE STA, EMA, FDA, IQWiG, HAS, EU JCA, or Global Value Dossier). Produces draft sections with gap analysis and auto-GRADE evidence quality tables. Accepts output from literature.search and models.cost_effectiveness. Enum values are case-insensitive — `"NICE"`/`"nice"`, `"STA"`/`"sta"` etc. all work.',
  annotations: {
    title: "HTA Dossier Preparation",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      hta_body: {
        type: "string",
        enum: ["nice", "ema", "fda", "iqwig", "has", "jca", "gvd"],
        description:
          "HTA body/dossier format. 'nice'=UK NICE STA; 'ema'=EMA CTD; 'fda'=FDA prescribing info; 'iqwig'=Germany AMNOG; 'has'=France transparency committee; 'jca'=EU Joint Clinical Assessment (Reg. 2021/2282); 'gvd'=Global Value Dossier (cross-market foundational document).",
      },
      submission_type: {
        type: "string",
        enum: ["sta", "mta", "early_access", "initial", "renewal", "variation"],
        description:
          "Submission type. 'sta'/'mta' for NICE; 'initial'/'renewal'/'variation' for JCA; 'early_access' for accelerated pathways.",
      },
      drug_name: {
        type: "string",
        description: "Generic or brand name of the drug/intervention.",
      },
      indication: {
        type: "string",
        description:
          "Disease or condition being treated (e.g., 'type 2 diabetes', 'non-small cell lung cancer').",
      },
      evidence_summary: {
        description:
          "Clinical evidence input. Accepts: a text summary string, OR a JSON array of LiteratureResult objects from literature.search (use output_format='json'). When passed as array, auto-generates a GRADE evidence quality table.",
      },
      model_results: {
        description:
          "JSON output from models.cost_effectiveness — used to populate the Economic Evidence Summary section.",
      },
      picos: {
        type: "array",
        description:
          "JCA-specific: list of PICOs from the scoping decision. Each PICO generates its own dossier section. If omitted, a default single PICO is generated.",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "PICO identifier, e.g. 'PICO-1'",
            },
            population: {
              type: "string",
              description: "Target patient subpopulation for this PICO.",
            },
            comparator: {
              type: "string",
              description: "Comparator treatment for this PICO.",
            },
            outcomes: {
              type: "array",
              items: { type: "string" },
              description: "Outcomes of interest for this PICO.",
            },
          },
          required: ["id", "population", "comparator", "outcomes"],
        },
      },
      output_format: {
        type: "string",
        enum: ["text", "json", "docx"],
        description:
          "Output format. 'text' returns markdown; 'json' returns structured sections; 'docx' generates a Word document and saves to disk.",
      },
      project: {
        type: "string",
        description:
          "Project ID for knowledge base persistence. When set, dossier draft is saved to ~/.heor-agent/projects/{project}/raw/dossiers/",
      },
      rob_results: {
        description:
          "Output from the evidence.risk_of_bias tool. When provided, the GRADE Risk of Bias domain uses the structured judgment (rob_judgment, downgrade, rationale) instead of a heuristic estimate.",
      },
      unmet_need_summary: {
        type: "string",
        description:
          "Optional: 1-paragraph unmet need synthesis from the evidence.unmet_need tool. Pipe evidence.unmet_need result.unmet_need_summary here. Prepended to the Unmet Need section for NICE (Section B) and GVD (Section 4).",
      },
      heterogeneity_per_outcome: {
        type: "object",
        description:
          "Optional: I² and study count per outcome (from evidence_indirect tool). When provided, GRADE inconsistency is computed from I² instead of heuristic. Example: { 'overall survival': { i_squared_pct: 45, n_studies: 6 } }",
        additionalProperties: {
          type: "object",
          properties: {
            i_squared_pct: { type: "number" },
            n_studies: { type: "number" },
          },
          required: ["i_squared_pct", "n_studies"],
        },
      },
      upgrading_per_outcome: {
        type: "object",
        description:
          "Optional: GRADE upgrading flags per outcome for observational evidence (Guyatt 2011). Keys are outcome names; values specify large_effect ('none'/'large'/'very_large'), dose_response (boolean), and plausible_confounding_toward_null (boolean). Ignored for RCT evidence. Capped at +2 steps.",
        additionalProperties: {
          type: "object",
          properties: {
            large_effect: {
              type: "string",
              enum: ["none", "large", "very_large"],
            },
            dose_response: { type: "boolean" },
            plausible_confounding_toward_null: { type: "boolean" },
          },
        },
      },
      severity_modifier: {
        type: "object",
        description:
          "NICE PMG36 severity modifier inputs (replaced end-of-life modifier, April 2022). Provide absolute_qaly_shortfall (years) and/or proportional_qaly_shortfall (0-1). Modifier weight: <12 absolute AND <0.85 proportional → 1.0×; 12-18 or 0.85-0.95 → 1.2×; ≥18 or ≥0.95 → 1.7×.",
        properties: {
          absolute_qaly_shortfall: { type: "number" },
          proportional_qaly_shortfall: { type: "number" },
        },
      },
      health_inequalities: {
        type: "object",
        description:
          "Health inequalities evidence per NICE PMG36 May 2025 modular update. Required by NICE for interventions affecting disadvantaged groups. intervention_impact: 'narrows'/'neutral'/'widens'/'unknown'.",
        properties: {
          affected_groups: {
            type: "array",
            items: { type: "string" },
          },
          baseline_disparity_evidence: { type: "string" },
          intervention_impact: {
            type: "string",
            enum: ["narrows", "neutral", "widens", "unknown"],
          },
          mitigation_plan: { type: "string" },
        },
      },
      pv_classification: {
        type: "object",
        description:
          "Optional: structured PV classification from the pv_classify tool. When provided, the dossier includes a Pharmacovigilance Plan section with GVP module, ENCePP template, submission obligations, and RMP implications. Pipe pv_classify output here.",
        properties: {
          primary_category: { type: "string" },
          alternatives: { type: "array", items: { type: "string" } },
          gvp_module: { type: "string" },
          gvp_revision: { type: "string" },
          encepp_study_category: { type: "string" },
          rmp_implications: { type: "array", items: { type: "string" } },
          fda_analogue: { type: "string" },
          submission_obligations: { type: "array", items: { type: "string" } },
          rationale: { type: "string" },
        },
        required: ["primary_category", "gvp_module", "gvp_revision"],
      },
      regulatory_landscape: {
        type: "array",
        description:
          "Optional: array of RegulatoryStatusResult objects from regulatory.status_check (via hta_workflow Phase 3.6). When provided and hta_body in {nice, jca, gvd}, renders a Regulatory Landscape section with a comparator × region × status table. Design log #26.",
        items: { type: "object" },
      },
      mfn_context: {
        type: "object",
        description:
          "Optional MFN pricing context. When basket_prices is supplied and hta_body is one of {nice, ema, fda, iqwig, has, jca, gvd}, renders an MFN Exposure section with ceiling math and gap-to-US analysis. Design log #27.",
        properties: {
          basket_prices: {
            type: "object",
            description:
              'Map of ISO country code → net price (USD equivalent). E.g. {"DE": 95, "FR": 88, "GB": 102}. Ceiling = min(values).',
            additionalProperties: { type: "number" },
          },
          us_current_net_price: {
            type: "number",
            description:
              "Drug's current US net price (USD). Used to compute gap-to-ceiling.",
          },
        },
      },
    },
    ai_disclosure_level: {
      type: "string",
      enum: ["off", "standard", "submission"],
      description:
        'AI assistance disclosure level. "off" = no disclosure; "standard" = default (model/tools/sources/date + human-review reminder); "submission" = adds ISPOR ELEVATE-GenAI citation. Default is tool-specific.',
    },
    required: ["hta_body", "submission_type", "drug_name", "indication"],
  },
};
