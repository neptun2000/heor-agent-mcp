import { z } from "zod";
import type { ToolResult } from "../providers/types.js";
import {
  createAuditRecord,
  addAssumption,
  addWarning,
  setMethodology,
} from "../audit/builder.js";
import { auditToMarkdown } from "../formatters/markdown.js";

/**
 * ITC Feasibility Checker
 *
 * Walks through the three ITC assumptions (exchangeability / homogeneity /
 * consistency) and recommends an appropriate method. Decision logic based on
 * published frameworks — Cope 2014, NICE DSU TSD 18, Signorovitch 2023,
 * Cochrane Handbook Ch 11.
 */

const FeasibilitySchema = z.object({
  connected_network: z
    .boolean()
    .describe(
      "True if there is a connected evidence network (at least one common comparator links the treatments of interest).",
    ),
  h2h_available: z
    .boolean()
    .default(false)
    .describe(
      "True if at least one head-to-head RCT directly compares the treatments of interest.",
    ),
  ipd_available_for_intervention: z
    .boolean()
    .default(false)
    .describe(
      "True if individual patient data (IPD) are available from the sponsor's trial.",
    ),
  effect_modifiers_identified: z
    .boolean()
    .default(false)
    .describe(
      "True if effect modifiers have been identified through clinical input or literature review.",
    ),
  effect_modifier_imbalance: z
    .enum(["none", "minor", "major", "unknown"])
    .default("unknown")
    .describe(
      "Severity of imbalance in identified effect modifiers across trial populations.",
    ),
  heterogeneity_i2_pct: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe(
      "I² statistic (%) across trials of the same comparison, if available (e.g., from evidence.indirect tool).",
    ),
  n_studies_per_comparison: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Number of studies available for each pairwise comparison (minimum across pairs).",
    ),
  subgroup_data_available: z
    .boolean()
    .default(false)
    .describe(
      "True if subgroup data are available in the comparator trials to adjust for effect modifiers.",
    ),
  outcome_type: z
    .enum(["binary", "continuous", "time_to_event"])
    .optional()
    .describe("Primary outcome type — guides which estimator to recommend."),
});

type FeasibilityParams = z.infer<typeof FeasibilitySchema>;

type Verdict =
  | "direct_comparison_preferred"
  | "full_nma"
  | "bucher_anchored"
  | "anchored_maic_stc"
  | "unanchored_maic_stc"
  | "ml_nmr_recommended"
  | "nmr_subgroup_meta_regression"
  | "infeasible";

interface FeasibilityOutput {
  verdict: Verdict;
  summary: string;
  exchangeability: string;
  homogeneity: string;
  consistency: string;
  caveats: string[];
  next_step: string;
  citations: string[];
}

function decide(p: FeasibilityParams): FeasibilityOutput {
  const citations = [
    "Cope et al. 2014 — A process for assessing the feasibility of a network meta-analysis. BMC Med 12:93.",
    "NICE DSU TSD 18 (Phillippo et al. 2016, updated 2020) — Methods for population-adjusted indirect comparisons in submissions to NICE.",
    "Signorovitch et al. 2023 — MAIC results confirmed by head-to-head trials: a case study in psoriasis. J Dermatol Treatment 34(1).",
    "Cochrane Handbook Ch. 10 (heterogeneity) and Ch. 11 (undertaking network meta-analyses).",
  ];

  // 1. No network → only unanchored/direct options or infeasible
  if (!p.connected_network) {
    if (p.h2h_available) {
      return {
        verdict: "direct_comparison_preferred",
        summary:
          "Head-to-head RCT evidence is available — direct comparison is preferred over any ITC method.",
        exchangeability:
          "Not applicable — direct comparison bypasses the exchangeability assumption.",
        homogeneity: "Assess within-trial; heterogeneity across H2H trials via standard meta-analysis if multiple.",
        consistency: "Not applicable — no indirect evidence being combined.",
        caveats: [
          "Ensure the H2H trial matches the target decision problem (population, setting, outcomes).",
        ],
        next_step:
          "Use standard pairwise meta-analysis on H2H trials. ITC is not required.",
        citations,
      };
    }
    if (p.ipd_available_for_intervention && p.effect_modifiers_identified) {
      return {
        verdict: "unanchored_maic_stc",
        summary:
          "No connected network — only unanchored MAIC/STC is possible. This is the weakest ITC approach and requires very strong assumptions.",
        exchangeability:
          "All prognostic factors AND effect modifiers must be identified and balanced — not just effect modifiers. Residual confounding risk is high.",
        homogeneity: "Cannot be formally tested without a common comparator.",
        consistency:
          "Cannot be assessed — no direct evidence to compare against.",
        caveats: [
          "Unanchored MAIC/STC assumes the absolute outcome is fully explained by identified covariates — usually implausible.",
          "Rarely accepted by NICE without strong justification (TSD 18 §4.2).",
          "Sensitivity analysis with different covariate sets is essential.",
        ],
        next_step:
          "Run evidence.population_adjusted with method='maic' or 'stc'. Label results EXPERIMENTAL. Plan extensive sensitivity analysis.",
        citations,
      };
    }
    return {
      verdict: "infeasible",
      summary:
        "No connected network and no IPD + identified effect modifiers for unanchored comparison. ITC is not feasible.",
      exchangeability:
        "Cannot be assessed without a common comparator or adjustment covariates.",
      homogeneity: "Not applicable.",
      consistency: "Not applicable.",
      caveats: [
        "Consider running a systematic literature review to identify additional studies with shared comparators.",
        "If the indication is rare, consider external control arms from RWE with appropriate causal adjustment.",
      ],
      next_step:
        "Report that ITC is infeasible. Recommend additional evidence generation (pragmatic trial, RWE external control, or dose comparator study) to the stakeholder.",
      citations,
    };
  }

  // 2. Connected network + H2H available → direct preferred but may still want NMA to place H2H in context
  if (p.h2h_available) {
    return {
      verdict: "direct_comparison_preferred",
      summary:
        "Connected network AND direct H2H evidence — use direct comparison as primary analysis. NMA can supplement to place H2H results in context.",
      exchangeability:
        "Trials should still be comparable if NMA is run alongside; assess effect modifier balance.",
      homogeneity: "Standard meta-analytic assumption — test with I² statistic across H2H studies.",
      consistency:
        "Can be formally tested via node-splitting or inconsistency models when combining direct + indirect.",
      caveats: [
        "If H2H and indirect estimates diverge materially, favour H2H and investigate the cause.",
      ],
      next_step:
        "Use direct meta-analysis as primary. Optionally run evidence.indirect with method='frequentist_nma' to check consistency via node-splitting.",
      citations,
    };
  }

  // 3. Major effect modifier imbalance → population adjustment needed
  if (p.effect_modifier_imbalance === "major") {
    if (p.ipd_available_for_intervention) {
      return {
        verdict: "anchored_maic_stc",
        summary:
          "Connected network exists but major effect modifier imbalance requires population adjustment. IPD available → anchored MAIC or STC is recommended.",
        exchangeability:
          "Anchored MAIC/STC adjusts for identified effect modifiers only (not all prognostic factors) — a weaker assumption than unanchored.",
        homogeneity: "Assess across trials of the same pairwise comparison post-adjustment.",
        consistency:
          "Test via comparison against unadjusted Bucher/NMA as sensitivity analysis.",
        caveats: [
          "MAIC loses effective sample size — report ESS and sensitivity to covariate set.",
          "STC is less sensitive to near-zero weights but requires correctly specified outcome model.",
          "Both require that ALL effect modifiers be identified and measured.",
        ],
        next_step:
          "Run evidence.population_adjusted with method='maic' (or 'stc'). Report ESS, balance diagnostics, and compare to unadjusted evidence.indirect as sensitivity.",
        citations,
      };
    }
    return {
      verdict: "ml_nmr_recommended",
      summary:
        "Major effect modifier imbalance but no IPD — population-adjusted methods not directly available. Multi-level network meta-regression (ML-NMR) recommended if aggregate covariate data permit.",
      exchangeability:
        "Unadjusted NMA would violate exchangeability given major imbalance.",
      homogeneity: "Expected to be poor without covariate adjustment.",
      consistency: "At risk due to population differences across trials.",
      caveats: [
        "ML-NMR is methodologically complex (Phillippo 2020); requires hierarchical Bayesian modelling and IPD for at least one study.",
        "Alternative: subgroup meta-regression if aggregate subgroup data are available.",
        "If neither is possible, report results with explicit caveats and consider the comparison EXPERIMENTAL.",
      ],
      next_step:
        "Commission external ML-NMR analysis, OR run evidence.indirect with documented caveats, OR pursue subgroup analysis if data permit.",
      citations,
    };
  }

  // 4. Connected network, no major imbalance — choose between Bucher and NMA by network size
  const nStudies = p.n_studies_per_comparison ?? 1;
  const i2 = p.heterogeneity_i2_pct ?? 0;

  if (i2 > 75) {
    return {
      verdict: "nmr_subgroup_meta_regression",
      summary:
        "Connected network with considerable heterogeneity (I² > 75%). Pooling across heterogeneous studies is unsafe — investigate sources before running NMA.",
      exchangeability:
        "Heterogeneity may indicate effect modifier imbalance not yet captured.",
      homogeneity: `Fails: I² = ${i2.toFixed(1)}% (considerable heterogeneity).`,
      consistency: "Premature to assess until homogeneity issues are resolved.",
      caveats: [
        "Consider network meta-regression with study-level covariates.",
        "Subgroup analysis may reveal the source.",
        "Random-effects pooling mitigates but does not eliminate the problem.",
      ],
      next_step:
        "Run meta-regression on suspected modifiers before attempting ITC. If modifiers cannot be adjusted, report unpooled results.",
      citations,
    };
  }

  if (nStudies >= 2 || (p.effect_modifiers_identified && i2 <= 60)) {
    return {
      verdict: "full_nma",
      summary:
        "Connected network, acceptable homogeneity, multiple studies per comparison — full NMA is appropriate.",
      exchangeability: p.effect_modifiers_identified
        ? "Effect modifiers identified with minor/no imbalance — exchangeability assumption plausible."
        : "Effect modifiers have not been formally assessed — recommend clinical expert review.",
      homogeneity:
        i2 > 0
          ? `I² = ${i2.toFixed(1)}% → acceptable for random-effects NMA.`
          : "Not yet computed — run evidence.indirect first to quantify.",
      consistency:
        "Test via node-splitting or inconsistency model (frequentist_nma output).",
      caveats: [
        "Report both fixed-effect and random-effects estimates when heterogeneity is moderate.",
        "Document the network diagram (see evidence.network tool).",
      ],
      next_step:
        "Run evidence.indirect with method='frequentist_nma'. Report I², Cochran Q, and consistency diagnostics.",
      citations,
    };
  }

  // Single-study-per-comparison fallback — Bucher
  return {
    verdict: "bucher_anchored",
    summary:
      "Connected network with only one study per pairwise comparison — Bucher anchored ITC is appropriate. NMA is possible but no gain over Bucher when there are no loops.",
    exchangeability: p.effect_modifiers_identified
      ? "Effect modifiers identified; assumption requires clinical review of comparability."
      : "No effect modifier assessment documented — strongly recommended before proceeding.",
    homogeneity:
      "Cannot be tested with a single study per arm; rely on clinical judgment.",
    consistency: "Not assessable without a closed loop in the network.",
    caveats: [
      "Bucher assumes transitivity — populations across the A-vs-B and B-vs-C trials must be exchangeable.",
      "No formal heterogeneity test is possible with k=1 per edge.",
    ],
    next_step:
      "Run evidence.indirect with method='bucher'. Document the transitivity assumption explicitly in the submission.",
    citations,
  };
}

function formatOutput(
  params: FeasibilityParams,
  decision: FeasibilityOutput,
): string {
  const lines: string[] = [];
  lines.push(`## ITC Feasibility Assessment`);
  lines.push(``);
  lines.push(`**Verdict:** \`${decision.verdict}\``);
  lines.push(``);
  lines.push(decision.summary);
  lines.push(``);
  lines.push(`### Input summary`);
  lines.push(`| Input | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Connected network | ${params.connected_network} |`);
  lines.push(`| Head-to-head trial available | ${params.h2h_available} |`);
  lines.push(`| IPD available (intervention) | ${params.ipd_available_for_intervention} |`);
  lines.push(`| Effect modifiers identified | ${params.effect_modifiers_identified} |`);
  lines.push(`| Effect modifier imbalance | ${params.effect_modifier_imbalance} |`);
  if (params.heterogeneity_i2_pct !== undefined) {
    lines.push(`| Heterogeneity I² | ${params.heterogeneity_i2_pct}% |`);
  }
  if (params.n_studies_per_comparison !== undefined) {
    lines.push(`| Studies per comparison (min) | ${params.n_studies_per_comparison} |`);
  }
  if (params.outcome_type) {
    lines.push(`| Outcome type | ${params.outcome_type} |`);
  }
  lines.push(``);
  lines.push(`### Three-assumption assessment`);
  lines.push(``);
  lines.push(`**Exchangeability.** ${decision.exchangeability}`);
  lines.push(``);
  lines.push(`**Homogeneity.** ${decision.homogeneity}`);
  lines.push(``);
  lines.push(`**Consistency.** ${decision.consistency}`);
  lines.push(``);
  if (decision.caveats.length > 0) {
    lines.push(`### Caveats`);
    for (const c of decision.caveats) {
      lines.push(`- ${c}`);
    }
    lines.push(``);
  }
  lines.push(`### Next step`);
  lines.push(decision.next_step);
  lines.push(``);
  lines.push(`### References`);
  for (const c of decision.citations) {
    lines.push(`- ${c}`);
  }
  lines.push(``);
  lines.push(
    `> This tool is a decision aid based on published frameworks. Final method choice requires clinical, statistical, and methodological judgment.`,
  );
  return lines.join("\n");
}

export async function handleItcFeasibility(
  rawParams: unknown,
): Promise<ToolResult> {
  const params = FeasibilitySchema.parse(rawParams);
  let audit = createAuditRecord(
    "evidence.itc",
    params as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "ITC feasibility framework per Cope 2014, NICE DSU TSD 18, Signorovitch 2023, Cochrane Handbook Ch 11.",
  );

  const decision = decide(params);
  audit = addAssumption(audit, `Verdict: ${decision.verdict}`);
  if (decision.verdict === "infeasible") {
    audit = addWarning(
      audit,
      "ITC is infeasible under current data availability.",
    );
  }
  if (
    decision.verdict === "unanchored_maic_stc" ||
    decision.verdict === "ml_nmr_recommended"
  ) {
    audit = addWarning(
      audit,
      "Recommended method relies on strong assumptions or methodology beyond standard tool support.",
    );
  }

  const body = formatOutput(params, decision);
  return { content: body + "\n" + auditToMarkdown(audit), audit };
}

export const itcFeasibilityToolSchema = {
  name: "evidence.itc",
  description:
    "Assess the feasibility of an indirect treatment comparison (ITC) by walking through the three core assumptions (exchangeability, homogeneity, consistency) and recommending an appropriate method: direct comparison, Bucher, full NMA, anchored MAIC/STC, unanchored MAIC/STC, ML-NMR, NMR/subgroup meta-regression, or infeasible. Cites Cope 2014 (BMC Med), NICE DSU TSD 18 (Phillippo), Signorovitch 2023 (J Dermatol Treatment), and Cochrane Handbook Ch 10-11. Use this BEFORE running evidence.indirect or evidence.population_adjusted to select the right method.",
  annotations: {
    title: "ITC Feasibility Checker",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      connected_network: {
        type: "boolean",
        description:
          "True if there is a connected evidence network linking the treatments of interest via at least one common comparator.",
      },
      h2h_available: {
        type: "boolean",
        description:
          "True if at least one head-to-head RCT compares the treatments directly. Default false.",
      },
      ipd_available_for_intervention: {
        type: "boolean",
        description:
          "True if individual patient data (IPD) are available from the sponsor's trial. Default false.",
      },
      effect_modifiers_identified: {
        type: "boolean",
        description:
          "True if effect modifiers have been identified through clinical input or literature review. Default false.",
      },
      effect_modifier_imbalance: {
        type: "string",
        enum: ["none", "minor", "major", "unknown"],
        description:
          "Severity of imbalance in identified effect modifiers across trial populations. Default 'unknown'.",
      },
      heterogeneity_i2_pct: {
        type: "number",
        description:
          "Optional: I² statistic (%) across studies of the same comparison. If absent, homogeneity is assessed qualitatively.",
      },
      n_studies_per_comparison: {
        type: "number",
        description:
          "Optional: minimum number of studies per pairwise comparison. Informs choice between Bucher (k=1) and NMA (k≥2).",
      },
      subgroup_data_available: {
        type: "boolean",
        description:
          "True if subgroup data are available in comparator trials for adjustment. Default false.",
      },
      outcome_type: {
        type: "string",
        enum: ["binary", "continuous", "time_to_event"],
        description: "Primary outcome type — guides estimator recommendations.",
      },
    },
    required: ["connected_network"],
  },
};
