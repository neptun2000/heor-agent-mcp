/**
 * Pure decision logic for pv_classify. Maps a study's metadata onto its
 * EMA regulatory category. See design log #11 for the decision-tree
 * diagram and rationale per branch.
 *
 * Order matters:
 *   1. Pre-authorisation overrides everything → ICH E2E plan.
 *   2. Spontaneous reports stand alone (not a study).
 *   3. RMP commitment context → Annex 4 study.
 *   4. Imposed by authority + post-MA → PASS imposed.
 *   5. Otherwise classify by primary objective + study design.
 *   6. Pregnancy population overrides the primary verdict (keeps it as
 *      an alternative for transparency).
 */
import type { PvCategory, PvClassifyInput } from "./types.js";

interface Decision {
  primary_category: PvCategory;
  alternatives: PvCategory[];
  rationale: string;
  /** Optional advisory warnings surfaced from edge cases — handler attaches to audit. */
  advisory_warnings?: string[];
}

export function classifyPv(input: PvClassifyInput): Decision {
  // 1. Pre-authorisation: never PASS — characterise via ICH E2E plan
  //    (which is an ICH guideline, NOT a GVP module). The plan informs
  //    the initial RMP that's submitted at MA grant under GVP Module V.
  if (input.regulatory_context === "pre_authorisation") {
    return withPregnancyOverride(input, {
      primary_category: "ICH_E2E_pharmacovigilance_plan",
      alternatives: [],
      rationale:
        "Study is pre-authorisation. PASS designations require an existing marketing authorisation (Article 107a). Pharmacovigilance planning at this stage falls under ICH E2E — note that ICH E2E is a standalone ICH guideline, not a GVP module; the GVP Module V reference reflects the downstream RMP that the E2E plan informs at MAA submission, not a direct mapping.",
    });
  }

  // 2. Spontaneous reports stand alone — Module VI baseline obligation.
  //    imposed_by_authority is contradictory here (spontaneous reporting
  //    is an inherent obligation, not something an authority can impose
  //    as a study) — surface a warning rather than silently dropping the
  //    flag.
  if (input.study_design === "spontaneous_reports") {
    const warnings = input.imposed_by_authority
      ? [
          "Contradictory inputs: study_design='spontaneous_reports' AND imposed_by_authority=true. Spontaneous adverse-event reporting is an inherent PV obligation under GVP Module VI, not a designed study an authority can impose. The imposed_by_authority flag has been ignored.",
        ]
      : undefined;
    return withPregnancyOverride(input, {
      primary_category: "spontaneous_reporting_only",
      alternatives: [],
      rationale:
        "Spontaneous adverse-event reporting is the baseline PV obligation under GVP Module VI, not a designed study. Categorised as spontaneous_reporting_only.",
      advisory_warnings: warnings,
    });
  }

  // 3. Imposed PASS takes precedence over plain RMP_Annex_4_study —
  //    Article 107n imposition outranks Annex 4 listing. The Annex 4
  //    listing is then a downstream consequence of the imposition.
  if (input.imposed_by_authority) {
    const warnings: string[] = [];
    if (
      (input.regulatory_context === "conditional_approval" ||
        input.regulatory_context === "accelerated_approval") &&
      !input.imposed_by_authority
    ) {
      // dead branch (imposed=true above) — guarded for clarity if reordered
    }
    return withPregnancyOverride(input, {
      primary_category: "PASS_imposed",
      alternatives:
        input.regulatory_context === "rmp_commitment"
          ? ["RMP_Annex_4_study"]
          : ["RMP_Annex_4_study"],
      rationale:
        input.regulatory_context === "rmp_commitment"
          ? "Authority-imposed obligation that is also tracked as an RMP Annex 4 commitment. Article 107n imposition is the primary classification — the Annex 4 listing is a consequence, not the primary route. Falls under GVP Module VIII (PASS imposed); PRAC pre-review of the protocol is required."
          : "Authority-imposed obligation in a post-authorisation context (Article 107n). Falls under GVP Module VIII as a Post-Authorisation Safety Study (imposed). PRAC pre-review of the protocol is required.",
      advisory_warnings: warnings.length > 0 ? warnings : undefined,
    });
  }

  // 4. RMP commitment context → Annex 4 listed study (when not imposed).
  if (input.regulatory_context === "rmp_commitment") {
    return withPregnancyOverride(input, {
      primary_category: "RMP_Annex_4_study",
      alternatives: ["PASS_voluntary"],
      rationale:
        "Study is an explicit RMP commitment, listed in RMP Annex 4 with milestone tracking. Per EMA GVP Module V.",
    });
  }

  // 4a. Conditional / accelerated approval WITHOUT imposed_by_authority —
  //     warn about Specific Obligations (CMA SOBs) per Article 14-a.
  //     Falling through to objective-based classification but the user
  //     should confirm whether the obligation is actually imposed.
  if (
    (input.regulatory_context === "conditional_approval" ||
      input.regulatory_context === "accelerated_approval") &&
    !input.imposed_by_authority
  ) {
    const out = classifyByObjective(input);
    return withPregnancyOverride(input, {
      ...out,
      advisory_warnings: [
        ...(out.advisory_warnings ?? []),
        `regulatory_context='${input.regulatory_context}' typically carries Specific Obligations (CMA Article 14-a / accelerated-approval SOBs) that function as an imposed PASS even without imposed_by_authority=true. Confirm SOB status with regulatory affairs; if confirmed, re-run with imposed_by_authority=true to get the correct PASS_imposed classification + Module VIII PRAC pre-review obligations.`,
      ],
    });
  }

  // 5. Otherwise classify by primary objective + study design.
  switch (input.primary_objective) {
    case "safety":
      return withPregnancyOverride(input, {
        primary_category: "PASS_voluntary",
        alternatives: ["active_surveillance_registry"],
        rationale:
          "Safety-objective post-authorisation study without an imposed obligation → voluntary PASS under GVP Module VIII. ENCePP registration and a final report to EMA are encouraged but not mandatory.",
      });

    case "efficacy":
    case "effectiveness":
      return withPregnancyOverride(input, {
        primary_category: "PAES",
        alternatives: ["PASS_voluntary"],
        rationale:
          "Effectiveness/efficacy-objective post-authorisation study → Post-Authorisation Efficacy Study (PAES). May trigger MA variation if results diverge from the MA effectiveness assumptions.",
      });

    case "drug_utilization":
      return withPregnancyOverride(input, {
        primary_category: "DUS",
        alternatives: ["PASS_voluntary"],
        rationale:
          "Drug utilisation objective → DUS under GVP Module VIII Addendum I. Used to characterise prescribing patterns and assess risk-minimisation measure effectiveness.",
      });

    case "natural_history":
      return withPregnancyOverride(input, {
        primary_category: "active_surveillance_registry",
        alternatives: ["PASS_voluntary"],
        rationale:
          "Natural history / disease epidemiology objective → active surveillance registry. Provides denominator data for PV signal detection.",
      });

    case "risk_minimisation_evaluation":
      return withPregnancyOverride(input, {
        primary_category: "PASS_voluntary",
        alternatives: ["DUS"],
        rationale:
          "Evaluation of risk-minimisation measure effectiveness → categorised as PASS (voluntary unless imposed). DUS is a valid alternative if the focus is utilisation rather than outcomes.",
      });
  }
}

function withPregnancyOverride(
  input: PvClassifyInput,
  decision: Decision,
): Decision {
  if (!input.population_includes_pregnant) return decision;
  if (decision.primary_category === "ICH_E2E_pharmacovigilance_plan") {
    // Pre-authorisation pregnancy planning still routes through ICH E2E
    // but flag the pregnancy-registry follow-up as the post-MA step.
    return {
      primary_category: "ICH_E2E_pharmacovigilance_plan",
      alternatives: ["pregnancy_registry"],
      rationale:
        decision.rationale +
        " Pregnancy population: a pregnancy registry will be required as a post-authorisation commitment per ICH E2E and EMA pregnancy-registry guidance.",
      advisory_warnings: decision.advisory_warnings,
    };
  }
  if (decision.primary_category === "pregnancy_registry") return decision;
  // Pregnancy override: keep the would-be primary as an alternative for
  // transparency, promote pregnancy_registry to the primary verdict.
  return {
    primary_category: "pregnancy_registry",
    alternatives: [decision.primary_category, ...decision.alternatives].filter(
      (c, i, a) => a.indexOf(c) === i && c !== "pregnancy_registry",
    ),
    rationale:
      "Pregnancy population in scope → pregnancy registry takes priority over the primary classification. " +
      decision.rationale +
      " The original classification is retained as an alternative for protocol-design context.",
    advisory_warnings: decision.advisory_warnings,
  };
}

/**
 * Pure classification by primary_objective. Extracted so the
 * conditional_approval / accelerated_approval branch can reuse it without
 * duplicating the switch.
 */
function classifyByObjective(input: PvClassifyInput): Decision {
  switch (input.primary_objective) {
    case "safety":
      return {
        primary_category: "PASS_voluntary",
        alternatives: ["active_surveillance_registry"],
        rationale:
          "Safety-objective post-authorisation study without an imposed obligation → voluntary PASS under GVP Module VIII.",
      };
    case "efficacy":
    case "effectiveness":
      return {
        primary_category: "PAES",
        alternatives: ["PASS_voluntary"],
        rationale:
          "Effectiveness/efficacy-objective post-authorisation study → Post-Authorisation Efficacy Study (PAES).",
      };
    case "drug_utilization":
      return {
        primary_category: "DUS",
        alternatives: ["PASS_voluntary"],
        rationale:
          "Drug utilisation objective → DUS under GVP Module VIII Addendum I.",
      };
    case "natural_history":
      return {
        primary_category: "active_surveillance_registry",
        alternatives: ["PASS_voluntary"],
        rationale:
          "Natural history / disease epidemiology objective → active surveillance registry.",
      };
    case "risk_minimisation_evaluation":
      return {
        primary_category: "PASS_voluntary",
        alternatives: ["DUS"],
        rationale:
          "Evaluation of risk-minimisation measure effectiveness → categorised as PASS (voluntary unless imposed).",
      };
  }
}
