/**
 * GRADE Upgrading assessment for observational evidence (Guyatt 2011).
 *
 * GRADE allows upgrading observational studies that start at "Low" certainty
 * for three specific reasons:
 *   1. Large magnitude of effect (RR < 0.5 or > 2.0 → +1; RR < 0.2 or > 5.0 → +2)
 *   2. Dose-response gradient
 *   3. Plausible confounding/bias would reduce the observed effect (i.e.,
 *      bias is biasing toward null, so the true effect is likely larger)
 *
 * Total upgrade is capped at +2 steps. Upgrading does NOT apply when the
 * starting certainty is High (RCTs) — RCTs cannot be upgraded above High.
 *
 * Reference: Guyatt GH et al. GRADE guidelines: 9. Rating up the quality
 * of evidence. J Clin Epidemiol. 2011;64(12):1311-1316.
 */

export interface UpgradingInput {
  /** Starting certainty before downgrades — "High" for RCTs, "Low" for observational. */
  start_certainty: "High" | "Low";
  /** Magnitude of effect (effect size relative to control). */
  large_effect?: "none" | "large" | "very_large";
  /** Documented dose-response gradient. */
  dose_response?: boolean;
  /** Plausible residual confounding would bias the effect toward null. */
  plausible_confounding_toward_null?: boolean;
}

export interface UpgradingAssessment {
  upgrade_steps: 0 | 1 | 2;
  rationale: string;
}

export function assessUpgrading(input: UpgradingInput): UpgradingAssessment {
  if (input.start_certainty === "High") {
    return {
      upgrade_steps: 0,
      rationale: "Upgrading not applicable — RCT evidence already starts High",
    };
  }

  const reasons: string[] = [];
  let raw = 0;

  if (input.large_effect === "very_large") {
    raw += 2;
    reasons.push("very large effect (RR < 0.2 or > 5.0)");
  } else if (input.large_effect === "large") {
    raw += 1;
    reasons.push("large effect (RR < 0.5 or > 2.0)");
  }

  if (input.dose_response) {
    raw += 1;
    reasons.push("dose-response gradient");
  }

  if (input.plausible_confounding_toward_null) {
    raw += 1;
    reasons.push("plausible confounding biases toward null");
  }

  const capped = Math.min(raw, 2) as 0 | 1 | 2;

  if (raw === 0) {
    return {
      upgrade_steps: 0,
      rationale: "No upgrading criteria met (Guyatt 2011)",
    };
  }

  return {
    upgrade_steps: capped,
    rationale:
      reasons.join("; ") + (raw > capped ? " (capped at +2 per GRADE)" : ""),
  };
}
