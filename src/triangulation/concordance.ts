/**
 * Pure RCT-vs-RWE concordance logic for evidence.triangulation. No I/O.
 *
 * For each outcome:
 *   1. Determine the concordance verdict from the two `favors` directions.
 *   2. When both bodies give a point estimate on the SAME measure, compare
 *      magnitude (is the real-world effect larger or smaller than trial?).
 *   3. Compose a per-outcome key message + caveats.
 *
 * Magnitude comparison normalises by benefit direction so "larger" always
 * means "larger benefit", whether the measure is lower-is-better (e.g.
 * monthly migraine days, a mean difference) or higher-is-better (e.g.
 * responder rate, a risk ratio).
 */
import type {
  EvidenceBody,
  OutcomeConcordance,
  OutcomeInput,
  TriangulationInput,
  TriangulationResult,
} from "./types.js";

/** Benefit magnitude on a common scale, sign-normalised so larger = more benefit. */
function benefitMagnitude(
  body: EvidenceBody,
  benefitLowerIsBetter: boolean,
): number | null {
  if (typeof body.effect_estimate !== "number") return null;
  const measure = (body.effect_measure ?? "").toUpperCase();
  // Ratio measures (RR/OR/HR) centre on 1; difference measures centre on 0.
  const isRatio = ["RR", "OR", "HR"].includes(measure);
  if (isRatio) {
    // Distance from 1 in the beneficial direction. For lower-is-better a
    // ratio < 1 is benefit; for higher-is-better a ratio > 1 is benefit.
    const deviation = body.effect_estimate - 1;
    return benefitLowerIsBetter ? -deviation : deviation;
  }
  // Difference measure: magnitude is the estimate, sign-flipped when lower
  // is better (a negative mean difference = benefit → positive magnitude).
  return benefitLowerIsBetter ? -body.effect_estimate : body.effect_estimate;
}

function compareMagnitude(
  rct: EvidenceBody,
  rwe: EvidenceBody,
  benefitLowerIsBetter: boolean,
  tolerance: number,
): OutcomeConcordance["magnitude"] {
  // Only comparable on the same measure.
  const rctMeasure = (rct.effect_measure ?? "").toUpperCase();
  const rweMeasure = (rwe.effect_measure ?? "").toUpperCase();
  if (
    typeof rct.effect_estimate !== "number" ||
    typeof rwe.effect_estimate !== "number" ||
    !rctMeasure ||
    !rweMeasure ||
    rctMeasure !== rweMeasure
  ) {
    return "not_comparable";
  }
  const rctBenefit = benefitMagnitude(rct, benefitLowerIsBetter);
  const rweBenefit = benefitMagnitude(rwe, benefitLowerIsBetter);
  if (rctBenefit === null || rweBenefit === null) return "not_comparable";

  const denom = Math.abs(rctBenefit);
  if (denom < 1e-9) {
    // RCT shows essentially no benefit; any RWE benefit is "larger".
    if (Math.abs(rweBenefit) < 1e-9) return "similar";
    return rweBenefit > 0 ? "larger_in_rwe" : "smaller_in_rwe";
  }
  const relDiff = (rweBenefit - rctBenefit) / denom;
  if (Math.abs(relDiff) <= tolerance) return "similar";
  return relDiff > 0 ? "larger_in_rwe" : "smaller_in_rwe";
}

function classifyOutcome(
  outcome: OutcomeInput,
  tolerance: number,
): OutcomeConcordance {
  const caveats: string[] = [];
  const benefitLowerIsBetter =
    outcome.benefit_direction === "lower_is_better";

  const rctFavors = outcome.rct?.favors ?? null;
  const rweFavors = outcome.rwe?.favors ?? null;

  // Single-source / no-evidence cases.
  if (!outcome.rct && !outcome.rwe) {
    return {
      name: outcome.name,
      verdict: "no_evidence",
      rct_favors: null,
      rwe_favors: null,
      magnitude: "not_comparable",
      key_message: `No RCT or RWE supplied for ${outcome.name}.`,
      caveats: ["No evidence provided for this outcome."],
    };
  }
  if (outcome.rct && !outcome.rwe) {
    return {
      name: outcome.name,
      verdict: "rct_only",
      rct_favors: rctFavors,
      rwe_favors: null,
      magnitude: "not_comparable",
      key_message: `Only RCT evidence available for ${outcome.name} (favours ${rctFavors}). Real-world confirmation outstanding.`,
      caveats: [
        "No real-world evidence to triangulate — efficacy shown in trials is not yet corroborated in routine practice.",
      ],
    };
  }
  if (!outcome.rct && outcome.rwe) {
    return {
      name: outcome.name,
      verdict: "rwe_only",
      rct_favors: null,
      rwe_favors: rweFavors,
      magnitude: "not_comparable",
      key_message: `Only real-world evidence available for ${outcome.name} (favours ${rweFavors}). No trial benchmark.`,
      caveats: [
        "No RCT benchmark — real-world effect is uncontrolled and subject to confounding by indication.",
      ],
    };
  }

  // Both present.
  const rct = outcome.rct as EvidenceBody;
  const rwe = outcome.rwe as EvidenceBody;
  const magnitude = compareMagnitude(
    rct,
    rwe,
    benefitLowerIsBetter,
    tolerance,
  );

  // Opposite directions → discordant.
  const opposite =
    (rctFavors === "intervention" && rweFavors === "comparator") ||
    (rctFavors === "comparator" && rweFavors === "intervention");
  if (opposite) {
    caveats.push(
      "RCT and RWE point in opposite directions — investigate population, comparator, and confounding differences before relying on either.",
    );
    return {
      name: outcome.name,
      verdict: "discordant",
      rct_favors: rctFavors,
      rwe_favors: rweFavors,
      magnitude,
      key_message: `DISCORDANT for ${outcome.name}: trials favour ${rctFavors} but real-world evidence favours ${rweFavors}.`,
      caveats,
    };
  }

  // One favours intervention, the other shows no difference → partial.
  const oneNoDiff =
    (rctFavors === "no_difference") !== (rweFavors === "no_difference");
  if (oneNoDiff) {
    const which = rctFavors === "no_difference" ? "RCT" : "RWE";
    const other = which === "RCT" ? "RWE" : "RCT";
    caveats.push(
      `${which} shows no difference while ${other} shows a benefit — directionally consistent but not fully corroborated.`,
    );
    return {
      name: outcome.name,
      verdict: "partially_concordant",
      rct_favors: rctFavors,
      rwe_favors: rweFavors,
      magnitude,
      key_message: `Partially concordant for ${outcome.name}: ${other} shows benefit, ${which} shows no clear difference.`,
      caveats,
    };
  }

  // Same direction (both intervention, both comparator, or both no_difference).
  let verdict: OutcomeConcordance["verdict"] = "concordant";
  let magMsg = "";
  if (magnitude === "larger_in_rwe") {
    verdict = "concordant_larger_in_rwe";
    magMsg =
      " The real-world effect is LARGER than in trials — consistent with longer follow-up and broader, more heterogeneous real-world populations.";
  } else if (magnitude === "smaller_in_rwe") {
    verdict = "concordant_smaller_in_rwe";
    magMsg =
      " The real-world effect is SMALLER than in trials — an efficacy–effectiveness gap (adherence, comorbidity, less-selected patients).";
  } else if (magnitude === "similar") {
    magMsg = " The real-world effect magnitude is consistent with trials.";
  }

  if (magnitude === "not_comparable" && rctFavors !== "no_difference") {
    caveats.push(
      "Effect magnitudes not directly comparable (different or missing effect measures) — concordance is directional only.",
    );
  }

  const dirText =
    rctFavors === "no_difference"
      ? "neither RCTs nor RWE show a clear difference"
      : `both RCTs and RWE favour the ${rctFavors}`;

  return {
    name: outcome.name,
    verdict,
    rct_favors: rctFavors,
    rwe_favors: rweFavors,
    magnitude,
    key_message: `Concordant for ${outcome.name}: ${dirText}.${magMsg}`,
    caveats,
  };
}

export function triangulate(
  input: TriangulationInput,
): TriangulationResult {
  const outcomes = input.outcomes.map((o) =>
    classifyOutcome(o, input.magnitude_tolerance),
  );

  const concordant = outcomes.filter((o) =>
    o.verdict.startsWith("concordant"),
  ).length;
  const discordant = outcomes.filter((o) => o.verdict === "discordant").length;
  const single_source = outcomes.filter(
    (o) => o.verdict === "rct_only" || o.verdict === "rwe_only",
  ).length;
  const larger_in_rwe = outcomes.filter(
    (o) => o.magnitude === "larger_in_rwe",
  ).length;
  const smaller_in_rwe = outcomes.filter(
    (o) => o.magnitude === "smaller_in_rwe",
  ).length;

  const warnings: string[] = [];
  if (discordant > 0) {
    warnings.push(
      `${discordant} outcome(s) are DISCORDANT between RCT and RWE — these should not be presented as corroborated; reconcile the divergence before use in a dossier.`,
    );
  }
  if (single_source > 0) {
    warnings.push(
      `${single_source} outcome(s) have only one evidence type — triangulation is incomplete; flag as RCT-only or RWE-only when reporting.`,
    );
  }
  warnings.push(
    "RWE is complementary to, not a substitute for, RCTs. Real-world effect sizes are subject to confounding and reporting differences; present triangulation as convergent (or divergent) evidence, not as a pooled estimate.",
  );

  // Overall message in the spirit of the source slide.
  const parts: string[] = [];
  if (concordant > 0) {
    parts.push(
      `${concordant}/${outcomes.length} outcomes show concordant RCT and RWE evidence`,
    );
  }
  if (larger_in_rwe > 0) {
    parts.push(
      `${larger_in_rwe} with a larger real-world effect (consistent with long-term use in broader populations)`,
    );
  }
  if (smaller_in_rwe > 0) {
    parts.push(`${smaller_in_rwe} with an efficacy–effectiveness gap`);
  }
  if (discordant > 0) {
    parts.push(`${discordant} discordant`);
  }
  const overall_message =
    parts.length > 0
      ? `For ${input.intervention} in ${input.indication}: ${parts.join("; ")}. RWE studies are complementary to RCTs.`
      : `No triangulable evidence supplied for ${input.intervention} in ${input.indication}.`;

  return {
    intervention: input.intervention,
    indication: input.indication,
    outcomes,
    summary: {
      total: outcomes.length,
      concordant,
      discordant,
      single_source,
      larger_in_rwe,
      smaller_in_rwe,
    },
    overall_message,
    warnings,
  };
}
