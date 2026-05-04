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
}

export function classifyPv(input: PvClassifyInput): Decision {
  // 1. Pre-authorisation: never PASS — characterise via ICH E2E plan.
  if (input.regulatory_context === "pre_authorisation") {
    return withPregnancyOverride(input, {
      primary_category: "ICH_E2E_pharmacovigilance_plan",
      alternatives: [],
      rationale:
        "Study is pre-authorisation. PASS designations require an existing marketing authorisation (Article 107a). Pharmacovigilance planning at this stage falls under ICH E2E and feeds the initial RMP at MAA submission.",
    });
  }

  // 2. Spontaneous reports stand alone — Module VI baseline obligation.
  if (input.study_design === "spontaneous_reports") {
    return withPregnancyOverride(input, {
      primary_category: "spontaneous_reporting_only",
      alternatives: [],
      rationale:
        "Spontaneous adverse-event reporting is the baseline PV obligation under GVP Module VI, not a designed study. Categorised as spontaneous_reporting_only.",
    });
  }

  // 3. RMP commitment context → Annex 4 listed study.
  if (input.regulatory_context === "rmp_commitment") {
    const alts: PvCategory[] = input.imposed_by_authority
      ? ["PASS_imposed"]
      : ["PASS_voluntary"];
    return withPregnancyOverride(input, {
      primary_category: "RMP_Annex_4_study",
      alternatives: alts,
      rationale:
        "Study is an explicit RMP commitment, listed in RMP Annex 4 with milestone tracking. Per EMA GVP Module V.",
    });
  }

  // 4. Imposed PASS — applies to conditional, accelerated, and standard
  //    post-authorisation contexts when the authority has imposed the
  //    obligation (Article 107n / 107a).
  if (input.imposed_by_authority) {
    return withPregnancyOverride(input, {
      primary_category: "PASS_imposed",
      alternatives: ["RMP_Annex_4_study"],
      rationale:
        "Authority-imposed obligation in a post-authorisation context (Article 107n). Falls under GVP Module VIII as a Post-Authorisation Safety Study (imposed). PRAC pre-review of the protocol is required.",
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
  };
}
