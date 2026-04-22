import { z } from "zod";
import type { ToolResult } from "../providers/types.js";
import {
  createAuditRecord,
  addAssumption,
  addWarning,
  setMethodology,
} from "../audit/builder.js";
import { auditToMarkdown } from "../formatters/markdown.js";
import {
  EQ5D_VALUE_SETS,
  BIZ_2026_IMPACT,
  getValueSet,
  getImpactEstimate,
  type ValueSetId,
  type IndicationType,
} from "../data/eq5dValueSets.js";

/**
 * Utility Value Set Tool
 *
 * Reference data + impact estimator for the UK EQ-5D-5L transition.
 *
 * Actions:
 *   - lookup: return characteristics of a specific value set
 *   - compare: return the four-value-set comparison table
 *   - estimate_impact: estimate ICER/QALY change when switching 3L → new UK 5L
 *
 * Source: OHE/EuroQol public data + Biz, Hernández Alava, Wailoo (2026) Value in Health.
 */

const UtilityValueSetSchema = z
  .object({
    action: z
      .enum(["lookup", "compare", "estimate_impact"])
      .describe(
        "'lookup' returns a single value set's details; 'compare' returns all four side-by-side; 'estimate_impact' returns ICER/QALY change estimates for a given indication type.",
      ),
    value_set: z
      .enum(["uk_3l", "england_5l", "uk_5l_new", "dsu_mapping"])
      .optional()
      .describe(
        "Value set identifier (required for 'lookup'). 'uk_3l'=MVH 1997; 'england_5l'=Devlin 2018 (rejected); 'dsu_mapping'=NICE DSU 2022 interim; 'uk_5l_new'=new UK 5L under consultation 2026.",
      ),
    indication_type: z
      .enum([
        "cancer_life_extending",
        "non_cancer_life_extending",
        "non_cancer_qol_only",
      ])
      .optional()
      .describe(
        "Indication category (required for 'estimate_impact'). 'non_cancer_qol_only' covers chronic QoL-only conditions — migraine, ulcerative colitis, atopic dermatitis, hidradenitis suppurativa, plaque psoriasis — which see the biggest ICER increase (+59% median).",
      ),
    base_icer: z
      .number()
      .positive()
      .optional()
      .describe(
        "Optional: current ICER (in local currency, typically £/QALY) to project forward under new UK 5L.",
      ),
    base_incremental_qaly: z
      .number()
      .positive()
      .optional()
      .describe(
        "Optional: current incremental QALY gain to project forward under new UK 5L.",
      ),
  })
  .strict();

type UtilityValueSetParams = z.infer<typeof UtilityValueSetSchema>;

function formatLookup(id: ValueSetId): string {
  const v = getValueSet(id);
  if (!v) return `No value set found with id "${id}".`;

  const lines: string[] = [];
  lines.push(`## ${v.name}`);
  lines.push(`**Country:** ${v.country}`);
  lines.push(
    `**Version:** EQ-5D-${v.version === "mapped_3L" ? "5L → 3L (mapped)" : v.version}`,
  );
  lines.push(
    `**Valuation year:** ${v.valuation_year} | **Publication year:** ${v.publication_year}`,
  );
  lines.push(`**Protocol:** ${v.protocol}`);
  lines.push(`**Methods:** ${v.methods.join(", ")}`);
  lines.push(
    `**Respondents:** ${v.n_respondents.toLocaleString()} | **States valued:** ${v.n_states_valued.toLocaleString()}`,
  );
  lines.push(`**NICE status:** ${v.nice_status}`);
  lines.push(``);
  lines.push(`### Distribution of utilities`);
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Full health | ${v.full_health_value} |`);
  lines.push(
    `| Mildest "slight" state | ${v.mildest_slight_state ?? "N/A (3L has no 'slight' level)"} |`,
  );
  lines.push(`| Moderate state | ${v.moderate_state_value} |`);
  lines.push(`| Worst state | ${v.worst_state_value} |`);
  lines.push(`| % states worse than dead | ${v.pct_states_worse_than_dead}% |`);
  lines.push(``);
  lines.push(`### Relative importance of dimensions`);
  lines.push(`| Dimension | Weight |`);
  lines.push(`|---|---|`);
  lines.push(`| Mobility | ${v.dimension_weights.mobility}% |`);
  lines.push(`| Self-care | ${v.dimension_weights.self_care}% |`);
  lines.push(`| Usual activities | ${v.dimension_weights.usual_activities}% |`);
  lines.push(`| Pain/discomfort | ${v.dimension_weights.pain_discomfort}% |`);
  lines.push(
    `| Anxiety/depression | ${v.dimension_weights.anxiety_depression}% |`,
  );
  lines.push(``);
  lines.push(`**Notes:** ${v.notes}`);
  lines.push(``);
  lines.push(`**Reference:** ${v.reference_url}`);
  return lines.join("\n");
}

function formatCompare(): string {
  const lines: string[] = [];
  lines.push(`## EQ-5D Value Sets — Side-by-Side Comparison`);
  lines.push(``);
  lines.push(`### Valuation study details`);
  lines.push(`| | UK 3L | England 5L | UK 5L (NEW) | UK 3L via DSU Mapping |`);
  lines.push(`|---|---|---|---|---|`);

  const order: ValueSetId[] = [
    "uk_3l",
    "england_5l",
    "uk_5l_new",
    "dsu_mapping",
  ];
  const vs = order.map((id) => getValueSet(id)!);

  lines.push(`| Country | ${vs.map((v) => v.country).join(" | ")} |`);
  lines.push(
    `| Methods | ${vs.map((v) => v.methods.join(" + ")).join(" | ")} |`,
  );
  lines.push(
    `| Valuation year | ${vs.map((v) => v.valuation_year).join(" | ")} |`,
  );
  lines.push(
    `| Respondents | ${vs.map((v) => v.n_respondents.toLocaleString()).join(" | ")} |`,
  );
  lines.push(`| Protocol | ${vs.map((v) => v.protocol).join(" | ")} |`);
  lines.push(
    `| States valued | ${vs.map((v) => v.n_states_valued.toLocaleString()).join(" | ")} |`,
  );
  lines.push(`| NICE status | ${vs.map((v) => v.nice_status).join(" | ")} |`);
  lines.push(``);
  lines.push(`### Distribution of utilities`);
  lines.push(`| | UK 3L | England 5L | UK 5L (NEW) | UK 3L via DSU Mapping |`);
  lines.push(`|---|---|---|---|---|`);
  lines.push(
    `| Full health | ${vs.map((v) => v.full_health_value).join(" | ")} |`,
  );
  lines.push(
    `| Mildest "slight" | ${vs.map((v) => v.mildest_slight_state ?? "N/A").join(" | ")} |`,
  );
  lines.push(
    `| Moderate state | ${vs.map((v) => v.moderate_state_value).join(" | ")} |`,
  );
  lines.push(
    `| Worst state | ${vs.map((v) => v.worst_state_value).join(" | ")} |`,
  );
  lines.push(
    `| % worse than dead | ${vs.map((v) => `${v.pct_states_worse_than_dead}%`).join(" | ")} |`,
  );
  lines.push(``);
  lines.push(`### Relative importance of dimensions`);
  lines.push(
    `| Dimension | UK 3L | England 5L | UK 5L (NEW) | UK 3L via DSU Mapping |`,
  );
  lines.push(`|---|---|---|---|---|`);

  const dims: Array<[string, keyof (typeof vs)[0]["dimension_weights"]]> = [
    ["Mobility", "mobility"],
    ["Self-care", "self_care"],
    ["Usual activities", "usual_activities"],
    ["Pain/discomfort", "pain_discomfort"],
    ["Anxiety/depression", "anxiety_depression"],
  ];
  for (const [label, key] of dims) {
    lines.push(
      `| ${label} | ${vs.map((v) => `${v.dimension_weights[key]}%`).join(" | ")} |`,
    );
  }
  lines.push(``);
  lines.push(
    `> **Key shift (UK 3L → UK 5L new):** mobility ↓ 25.2→17.8%, self-care ↓ 17.2→13.1%, usual activities ↑ 7.6→13.5%, anxiety/depression ↑ 19.0→25.0%. Pain/discomfort broadly stable.`,
  );
  lines.push(``);
  lines.push(
    `> **NICE consultation:** 2026-04-15 to 2026-05-13 on adopting the new UK 5L value set.`,
  );
  return lines.join("\n");
}

function formatImpact(params: UtilityValueSetParams): string {
  const indication = params.indication_type!;
  const est = getImpactEstimate(indication);
  if (!est) return `No impact estimate available for "${indication}".`;

  const lines: string[] = [];
  lines.push(
    `## Anticipated Impact of UK 5L Transition — ${indication.replace(/_/g, " ")}`,
  );
  lines.push(``);
  lines.push(
    `Based on Biz, Hernández Alava, Wailoo (2026). *Switching from EQ-5D-3L to EQ-5D-5L in England: the impact in NICE technology appraisals.* Value in Health (forthcoming). N = 39 decisions across 37 NICE TAs.`,
  );
  lines.push(``);
  lines.push(`| Metric | Median change |`);
  lines.push(`|---|---|`);
  lines.push(
    `| Incremental QALY | ${est.median_qaly_change_pct > 0 ? "+" : ""}${est.median_qaly_change_pct}% |`,
  );
  lines.push(
    `| ICER | ${est.median_icer_change_pct > 0 ? "+" : ""}${est.median_icer_change_pct}% |`,
  );
  lines.push(`| Direction | ${est.direction.replace(/_/g, " ")} |`);
  lines.push(``);
  lines.push(
    `**Typical indications in this category:** ${est.examples.join(", ")}`,
  );
  lines.push(``);
  lines.push(`**Caveat:** ${est.caveat}`);
  lines.push(``);

  // Projections if base values provided
  if (params.base_icer || params.base_incremental_qaly) {
    lines.push(`### Projected values under new UK 5L`);
    if (params.base_icer) {
      const newIcer = params.base_icer * (1 + est.median_icer_change_pct / 100);
      lines.push(
        `- Current ICER: **${params.base_icer.toLocaleString()} /QALY** → projected: **~${Math.round(newIcer).toLocaleString()} /QALY** (median shift).`,
      );
    }
    if (params.base_incremental_qaly) {
      const newQaly =
        params.base_incremental_qaly * (1 + est.median_qaly_change_pct / 100);
      lines.push(
        `- Current incremental QALY: **${params.base_incremental_qaly.toFixed(3)}** → projected: **~${newQaly.toFixed(3)}** (median shift).`,
      );
    }
    lines.push(``);
    lines.push(
      `> ⚠️ These are **median** projections from a cross-TA analysis — your specific submission may differ substantially. Individual TA results ranged widely within each category.`,
    );
    lines.push(``);
  }

  if (indication === "non_cancer_qol_only") {
    lines.push(
      `> 🚨 **High-impact category.** If your submission is for a chronic QoL-only indication and the NICE 5L transition takes effect before your appraisal committee, expect material ICER deterioration. Consider: (a) collecting native EQ-5D-5L data if possible; (b) requesting NICE flexibilities (ECD16 allows non-EQ-5D evidence where instrument is demonstrably inappropriate); (c) running scenario analysis in cost_effectiveness_model with both value sets.`,
    );
    lines.push(``);
  }

  lines.push(`**Further reading:**`);
  lines.push(
    `- OHE — https://www.ohe.org/themes/measuring-and-valuing-outcomes/`,
  );
  lines.push(
    `- NICE position statement on EQ-5D-5L (ECD16) — https://www.nice.org.uk/corporate/ecd16`,
  );
  lines.push(`- EuroQol value set registry — https://euroqol.org`);
  return lines.join("\n");
}

export async function handleUtilityValueSet(
  rawParams: unknown,
): Promise<ToolResult> {
  const params = UtilityValueSetSchema.parse(rawParams);
  let audit = createAuditRecord(
    "utility_value_set",
    params as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "Static reference data (OHE / EuroQol / Biz et al. 2026) — no external fetches.",
  );
  audit = addAssumption(
    audit,
    `Total value sets in catalogue: ${EQ5D_VALUE_SETS.length}`,
  );
  audit = addAssumption(
    audit,
    `Impact estimates cover ${BIZ_2026_IMPACT.length} indication categories`,
  );

  let body: string;

  switch (params.action) {
    case "lookup":
      if (!params.value_set) {
        audit = addWarning(audit, "action=lookup requires value_set");
        body = `Error: action="lookup" requires \`value_set\` parameter. Valid values: uk_3l, england_5l, uk_5l_new, dsu_mapping.`;
      } else {
        body = formatLookup(params.value_set);
        audit = addAssumption(
          audit,
          `Looked up value set: ${params.value_set}`,
        );
      }
      break;
    case "compare":
      body = formatCompare();
      audit = addAssumption(audit, "Compared all four reference value sets");
      break;
    case "estimate_impact":
      if (!params.indication_type) {
        audit = addWarning(
          audit,
          "action=estimate_impact requires indication_type",
        );
        body = `Error: action="estimate_impact" requires \`indication_type\` parameter. Valid values: cancer_life_extending, non_cancer_life_extending, non_cancer_qol_only.`;
      } else {
        body = formatImpact(params);
        audit = addAssumption(
          audit,
          `Applied Biz et al. 2026 impact estimates for ${params.indication_type}`,
        );
        if (params.base_icer) {
          audit = addAssumption(
            audit,
            `Projected base ICER of ${params.base_icer} to new UK 5L`,
          );
        }
      }
      break;
  }

  return { content: body + "\n" + auditToMarkdown(audit), audit };
}

export const utilityValueSetToolSchema = {
  name: "utility_value_set",
  description:
    "Look up EQ-5D value set characteristics (UK 3L, England 5L, new UK 5L 2026, NICE DSU mapping) or estimate the ICER/QALY impact of the new UK EQ-5D-5L value set for a given indication type. Cites Biz, Hernández Alava, Wailoo (2026) Value in Health. Use when user asks about NICE 5L transition, UK utility value sets, or impact on NICE STA submissions.",
  annotations: {
    title: "EQ-5D Value Set Reference & Impact Estimator",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["lookup", "compare", "estimate_impact"],
        description:
          "'lookup' returns a single value set; 'compare' returns all four side-by-side; 'estimate_impact' returns ICER/QALY change estimates for an indication type.",
      },
      value_set: {
        type: "string",
        enum: ["uk_3l", "england_5l", "uk_5l_new", "dsu_mapping"],
        description:
          "Value set id (required for 'lookup'). 'uk_5l_new' is the 2026 one under NICE consultation.",
      },
      indication_type: {
        type: "string",
        enum: [
          "cancer_life_extending",
          "non_cancer_life_extending",
          "non_cancer_qol_only",
        ],
        description:
          "Indication category (required for 'estimate_impact'). 'non_cancer_qol_only' = chronic QoL-only conditions (migraine, UC, atopic dermatitis, HS, plaque psoriasis) — sees the biggest ICER increase.",
      },
      base_icer: {
        type: "number",
        description:
          "Optional: current ICER to project forward under new UK 5L.",
      },
      base_incremental_qaly: {
        type: "number",
        description:
          "Optional: current incremental QALY gain to project forward under new UK 5L.",
      },
    },
    required: ["action"],
  },
};
