/**
 * Pure selection logic for rwe_method_select. Ranks the RWE-methodology
 * profiles against the user's research objective, data availability,
 * decision context, and required rigour. No I/O.
 *
 * Scoring (deterministic, transparent):
 *   +3  objective is in the method's served objectives
 *   +2  method's results-validity tier meets/exceeds the required rigour
 *   +1  decision context is a natural fit for the method
 *   −2  method's validity tier is below the required rigour (kept as a
 *       penalty, not an exclusion — the user may still want it as support)
 *
 * Feasibility is a hard gate, independent of score: a method is feasible
 * only if the user has at least one of its required data sources (or did
 * not declare any data, in which case feasibility is unknown and the
 * method stays a candidate with a data-needs caveat).
 */
import { ALL_RWE_METHODS, profileFor } from "./methodRegistry.js";
import {
  RIGOR_RANK,
  VALIDITY_RANK,
  type RankedMethod,
  type RweMethodProfile,
  type RweMethodSelectInput,
  type RweMethodSelection,
} from "./types.js";

function isFeasible(
  profile: RweMethodProfile,
  available: RweMethodSelectInput["available_data"],
): { feasible: boolean; dataUnknown: boolean } {
  if (available.length === 0) {
    // No data declared — we cannot rule the method out, but flag it.
    return { feasible: true, dataUnknown: true };
  }
  const feasible = profile.requires_any_data.some((d) => available.includes(d));
  return { feasible, dataUnknown: false };
}

function scoreMethod(
  profile: RweMethodProfile,
  input: RweMethodSelectInput,
): RankedMethod {
  const caveats: string[] = [];
  let score = 0;

  const objectiveMatch = profile.objectives.includes(input.research_objective);
  if (objectiveMatch) {
    score += 3;
  }

  const validityRank = VALIDITY_RANK[profile.results_validity];
  const rigorRank = RIGOR_RANK[input.rigor_required];
  if (validityRank >= rigorRank) {
    score += 2;
  } else {
    score -= 2;
    caveats.push(
      `Results-validity tier is ${profile.results_validity}, below the ${input.rigor_required} rigour requested — typically supportive/hypothesis-generating rather than confirmatory for this decision.`,
    );
  }

  if (profile.fits_contexts.includes(input.decision_context)) {
    score += 1;
  }

  const { feasible, dataUnknown } = isFeasible(profile, input.available_data);
  if (dataUnknown) {
    caveats.push(
      `Feasibility unconfirmed — requires access to: ${profile.requires_any_data.join(" or ")}. No available_data was declared.`,
    );
  } else if (!feasible) {
    caveats.push(
      `Not feasible with the declared data — requires ${profile.requires_any_data.join(" or ")}.`,
    );
  }

  // Always carry the design's intrinsic validity note as a caveat so the
  // user sees the bias profile even for a high-scoring recommendation.
  caveats.push(profile.results_validity_note);

  const rationaleParts: string[] = [];
  rationaleParts.push(
    objectiveMatch
      ? `Well-suited to ${humanObjective(input.research_objective)} (${profile.common_use.toLowerCase()}).`
      : `Not a primary design for ${humanObjective(input.research_objective)}, but can contribute supporting evidence.`,
  );
  rationaleParts.push(`${profile.decision_support}.`);

  return {
    method: profile.method,
    label: profile.label,
    score,
    feasible,
    results_validity: profile.results_validity,
    rationale: rationaleParts.join(" "),
    caveats,
    pairs_with_tools: profile.pairs_with_tools,
  };
}

function humanObjective(o: RweMethodSelectInput["research_objective"]): string {
  return o.replace(/_/g, " ");
}

export function selectRweMethod(
  input: RweMethodSelectInput,
): RweMethodSelection {
  const ranked = ALL_RWE_METHODS.map((m) => scoreMethod(profileFor(m), input));

  const feasible = ranked
    .filter((r) => r.feasible)
    .sort((a, b) => b.score - a.score || a.method.localeCompare(b.method));
  const infeasible = ranked.filter((r) => !r.feasible);

  const primary = feasible.length > 0 ? feasible[0] : null;
  const alternatives = feasible.slice(1);

  const advisory_warnings: string[] = [];

  // Rigour satisfiability: can any feasible method meet the requested rigour?
  const rigorRank = RIGOR_RANK[input.rigor_required];
  const rigor_satisfiable = feasible.some(
    (r) => VALIDITY_RANK[r.results_validity] >= rigorRank,
  );
  if (!rigor_satisfiable && feasible.length > 0) {
    advisory_warnings.push(
      `No feasible method meets the requested ${input.rigor_required} rigour with the declared data. The recommendation below is the best available but should be treated as supportive evidence; consider acquiring a higher-validity data source (e.g. a claims/EHR database or a systematic literature review) for a submission-grade design.`,
    );
  }

  // Primary recommendation whose validity falls short of the rigour bar.
  if (
    primary &&
    VALIDITY_RANK[primary.results_validity] < rigorRank
  ) {
    advisory_warnings.push(
      `Top-ranked method (${primary.label}) has ${primary.results_validity} validity but ${input.rigor_required} rigour was requested — pair it with a higher-validity design or downgrade the evidence claim accordingly.`,
    );
  }

  if (feasible.length === 0) {
    advisory_warnings.push(
      "No method is feasible with the declared data sources. Add at least one data source (claims/EHR, patient charts, survey access, published literature, or social media) and re-run.",
    );
  }

  // Triangulation hint when a second strong design is available — RWE is
  // strongest when convergent across complementary methods.
  if (primary && alternatives.length > 0 && alternatives[0].score >= 3) {
    advisory_warnings.push(
      `Consider triangulating ${primary.label} with ${alternatives[0].label} — convergent findings across complementary RWE designs strengthen the evidence and pre-empt HTA/regulatory critique of single-source RWE.`,
    );
  }

  return {
    primary,
    alternatives,
    infeasible,
    rigor_satisfiable,
    advisory_warnings,
  };
}
