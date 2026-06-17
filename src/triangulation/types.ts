/**
 * Types for evidence.triangulation — per-outcome RCT-vs-RWE concordance.
 *
 * Encodes the "literature review of RCTs and RWE — key messages per
 * relevant outcome" view: for each outcome, compare what the randomised
 * trials show against what real-world evidence shows, classify whether
 * they agree (and if the real-world effect is larger or smaller), and
 * surface the efficacy–effectiveness gap narrative.
 *
 * See design log #18.
 */

/** Which direction of the effect estimate represents patient benefit. */
export type BenefitDirection = "lower_is_better" | "higher_is_better";

/** Which arm an evidence body favours. */
export type Favors = "intervention" | "comparator" | "no_difference";

export type ConcordanceVerdict =
  | "concordant" // same direction of benefit
  | "concordant_larger_in_rwe" // agree; real-world effect bigger
  | "concordant_smaller_in_rwe" // agree; real-world effect smaller
  | "partially_concordant" // one favours intervention, the other shows no difference
  | "discordant" // opposite directions
  | "rct_only" // only RCT evidence supplied
  | "rwe_only" // only RWE evidence supplied
  | "no_evidence"; // neither supplied

export interface EvidenceBody {
  favors: Favors;
  /** Optional point estimate (used for magnitude comparison when measures match). */
  effect_estimate?: number;
  /** Optional effect measure, e.g. "MD", "SMD", "RR", "OR", "HR", "%". */
  effect_measure?: string;
  n_studies?: number;
  n_patients?: number;
  summary?: string;
}

export interface OutcomeInput {
  name: string;
  benefit_direction: BenefitDirection;
  rct?: EvidenceBody;
  rwe?: EvidenceBody;
}

export interface OutcomeConcordance {
  name: string;
  verdict: ConcordanceVerdict;
  rct_favors: Favors | null;
  rwe_favors: Favors | null;
  /** Relative magnitude of the RWE effect vs RCT, when both estimates + matching measures exist. */
  magnitude: "larger_in_rwe" | "smaller_in_rwe" | "similar" | "not_comparable";
  key_message: string;
  caveats: string[];
}

export interface TriangulationResult {
  intervention: string;
  indication: string;
  outcomes: OutcomeConcordance[];
  summary: {
    total: number;
    concordant: number; // any "concordant*" verdict
    discordant: number;
    single_source: number; // rct_only + rwe_only
    larger_in_rwe: number;
    smaller_in_rwe: number;
  };
  overall_message: string;
  warnings: string[];
}

export interface TriangulationInput {
  intervention: string;
  indication: string;
  outcomes: OutcomeInput[];
  /** Relative tolerance for calling two effect estimates "similar" (default 0.15 = 15%). */
  magnitude_tolerance: number;
}
