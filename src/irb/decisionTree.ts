/**
 * Pure decision logic for irb_review (design log #21).
 *
 * Computes US 45 CFR 46 review tier (exempt / expedited / full-board), EU
 * CTR 536/2014 review path, vulnerable-population obligations, GDPR/HIPAA
 * data-management plan, SAE-reporting framework, ICF complexity tier, COI
 * framework, and a ready-to-paste cover-letter template.
 *
 * Order of checks (top-down):
 *   1. risk_level=unknown + interventional → conservative full-board (A3).
 *   2. Hint flags (educational, benign_behavioural, federal_demonstration,
 *      taste_test, broad_consent_obtained, marketed_drug,
 *      blood_draw_within_limits, noninvasive_collection,
 *      noninvasive_procedure, recording_collection) — explicit signals
 *      from the investigator override the default tree.
 *   3. By study_design + data_handling.
 *   4. pv_classification.primary_category="PASS_imposed" overrides the SAE
 *      framework to CTR Annex III regardless of jurisdiction.
 *
 * See verification criteria 1-10 in design log #21 §"Verification Criteria".
 */
import { buildCoverLetter } from "./coverLetters.js";
import {
  CTR_536_2014_TIMELINES,
  FDA_IND_TIMELINES,
  PSUR_TIMELINES,
  VULNERABLE_OBLIGATIONS,
} from "./rulesets.js";
import {
  IRB_RULESET,
  type CoiFramework,
  type DataManagementPlan,
  type DeIdMethod,
  type IcfTier,
  type IrbAssessment,
  type IrbReviewInput,
  type ReviewTierEu,
  type ReviewTierUs,
  type SaeReportingObligations,
  type VulnerablePopulationObligation,
} from "./types.js";

interface UsTier {
  tier: ReviewTierUs;
  exempt_category: number | null;
  expedited_categories: number[];
  rationale: string;
}

const NON_INTERVENTIONAL_DESIGNS = new Set([
  "questionnaire_only",
  "non_interventional_prospective",
  "retrospective_chart_review",
  "secondary_data_analysis",
  "specimen_repository",
  "registry",
]);

function isAnonymous(input: IrbReviewInput): boolean {
  return (
    input.data_handling === "anonymized_safe_harbor" ||
    input.data_handling === "anonymized_expert_determination" ||
    input.data_handling === "aggregate_only"
  );
}

function isIdentifiable(input: IrbReviewInput): boolean {
  return (
    input.data_handling === "fully_identifiable" ||
    input.data_handling === "pseudonymized"
  );
}

function classifyUs(input: IrbReviewInput, warnings: string[]): UsTier | null {
  if (!input.jurisdictions.includes("us_irb")) return null;

  // Conservative full-board when risk_level missing on interventional (A3).
  if (
    input.study_design === "interventional" &&
    input.risk_level === "unknown"
  ) {
    warnings.push(
      "risk_level was 'unknown'/missing on an interventional study — defaulted conservatively to full-board review per 45 CFR 46.108. Re-run with risk_level set when the protocol risk classification is finalised.",
    );
    return {
      tier: "full_board",
      exempt_category: null,
      expedited_categories: [],
      rationale:
        "Risk classification was unknown for an interventional study; defaulted to full-board review under 45 CFR 46.108 (most protective).",
    };
  }

  // Surface contradictory hint inputs upfront — the hint switch below
  // silently ignores hints that don't match the study_design, which
  // confuses callers who set them deliberately.
  if (input.benign_behavioural && input.study_design !== "interventional") {
    warnings.push(
      `benign_behavioural=true requires study_design='interventional' per 45 CFR 46.104(d)(3); hint ignored because study_design is '${input.study_design}'.`,
    );
  }

  // Hint-driven exempt categories (highest specificity first).
  // Precedence: educational → benign_behavioural → federal_demonstration →
  // taste_test → broad_consent_obtained × 2. Only one hint should be set
  // per call; if multiple are set, the first match in this order wins.
  if (input.exempt_category_hint === "educational") {
    return {
      tier: "exempt",
      exempt_category: 1,
      expedited_categories: [],
      rationale:
        "Educational practices in established educational settings (45 CFR 46.104(d)(1)).",
    };
  }
  if (
    input.benign_behavioural &&
    input.study_design === "interventional" &&
    input.risk_level === "minimal"
  ) {
    return {
      tier: "exempt",
      exempt_category: 3,
      expedited_categories: [],
      rationale:
        "Benign behavioural intervention in adults with prospective consent (45 CFR 46.104(d)(3)).",
    };
  }
  if (input.federal_demonstration) {
    return {
      tier: "exempt",
      exempt_category: 5,
      expedited_categories: [],
      rationale:
        "Federally supported research / demonstration project under public benefit / service program (45 CFR 46.104(d)(5)).",
    };
  }
  if (input.taste_test) {
    return {
      tier: "exempt",
      exempt_category: 6,
      expedited_categories: [],
      rationale:
        "Taste / food-quality / consumer-acceptance evaluation (45 CFR 46.104(d)(6)).",
    };
  }
  if (
    input.broad_consent_obtained &&
    input.study_design === "specimen_repository"
  ) {
    return {
      tier: "exempt",
      exempt_category: 7,
      expedited_categories: [],
      rationale:
        "Storage / maintenance of identifiable biospecimens for secondary research with broad consent (45 CFR 46.104(d)(7)).",
    };
  }
  if (
    input.broad_consent_obtained &&
    input.study_design === "secondary_data_analysis"
  ) {
    return {
      tier: "exempt",
      exempt_category: 8,
      expedited_categories: [],
      rationale:
        "Secondary research using identifiable info / biospecimens for which broad consent was obtained (45 CFR 46.104(d)(8)).",
    };
  }

  // By study_design.
  switch (input.study_design) {
    case "questionnaire_only": {
      if (isAnonymous(input)) {
        return {
          tier: "exempt",
          exempt_category: 2,
          expedited_categories: [],
          rationale:
            "Educational tests, surveys, interviews, or public observation with non-identifiable responses (45 CFR 46.104(d)(2), first prong).",
        };
      }
      // Identifiable survey/interview → expedited cat 7.
      // §46.104(d)(2) has a SECOND prong (no-disclosure-risk) we don't
      // mechanise — surface as advisory so the IRB can apply it manually
      // for non-sensitive identifiable surveys.
      warnings.push(
        "Questionnaire with identifiable responses classified as expedited cat 7. §46.104(d)(2) has a second prong (exempt if disclosure of responses outside research could not reasonably place subjects at risk) that this tool does not mechanise — confirm with the IRB whether exempt cat 2 may apply.",
      );
      return {
        tier: "expedited",
        exempt_category: null,
        expedited_categories: [7],
        rationale:
          "Survey / interview / focus-group research in adults at minimal risk with identifiable responses → expedited review under 45 CFR 46.110 cat 7.",
      };
    }

    case "secondary_data_analysis": {
      if (isAnonymous(input)) {
        return {
          tier: "exempt",
          exempt_category: 4,
          expedited_categories: [],
          rationale:
            "Secondary research using non-identifiable / publicly available data (45 CFR 46.104(d)(4)).",
        };
      }
      if (input.data_handling === "fully_identifiable") {
        return {
          tier: "full_board",
          exempt_category: null,
          expedited_categories: [],
          rationale:
            "Secondary research with fully identifiable private information without broad consent → full-board review (45 CFR 46.108).",
        };
      }
      // Pseudonymized minimal-risk → expedited cat 5.
      return {
        tier: "expedited",
        exempt_category: null,
        expedited_categories: [5],
        rationale:
          "Research using existing data / records collected for non-research purposes (45 CFR 46.110 cat 5).",
      };
    }

    case "specimen_repository": {
      if (isAnonymous(input)) {
        return {
          tier: "exempt",
          exempt_category: 4,
          expedited_categories: [],
          rationale:
            "Specimen repository using non-identifiable biospecimens (45 CFR 46.104(d)(4)).",
        };
      }
      if (input.data_handling === "fully_identifiable") {
        return {
          tier: "full_board",
          exempt_category: null,
          expedited_categories: [],
          rationale:
            "Specimen repository with fully identifiable specimens without broad consent → full-board review.",
        };
      }
      return {
        tier: "expedited",
        exempt_category: null,
        expedited_categories: [5],
        rationale:
          "Pseudonymized specimen repository at minimal risk (45 CFR 46.110 cat 5).",
      };
    }

    case "retrospective_chart_review": {
      if (isAnonymous(input)) {
        return {
          tier: "exempt",
          exempt_category: 4,
          expedited_categories: [],
          rationale:
            "Retrospective chart review using non-identifiable / de-identified records (45 CFR 46.104(d)(4)).",
        };
      }
      if (input.risk_level === "minimal") {
        return {
          tier: "expedited",
          exempt_category: null,
          expedited_categories: [5],
          rationale:
            "Retrospective chart review using identifiable existing records at minimal risk (45 CFR 46.110 cat 5).",
        };
      }
      if (input.risk_level === "unknown") {
        warnings.push(
          "risk_level was 'unknown' on a retrospective chart review with identifiable records — defaulted conservatively to full-board review. Re-run with risk_level set when finalised.",
        );
      }
      return {
        tier: "full_board",
        exempt_category: null,
        expedited_categories: [],
        rationale:
          "Retrospective chart review at greater-than-minimal risk → full-board review.",
      };
    }

    case "non_interventional_prospective": {
      if (input.marketed_drug && input.risk_level === "minimal") {
        return {
          tier: "expedited",
          exempt_category: null,
          expedited_categories: [1],
          rationale:
            "Post-marketing observational study of a marketed drug at minimal risk per labeling (45 CFR 46.110 cat 1).",
        };
      }
      if (input.blood_draw_within_limits) {
        return {
          tier: "expedited",
          exempt_category: null,
          expedited_categories: [2],
          rationale:
            "Blood collection by venipuncture within OHRP volume limits (45 CFR 46.110 cat 2).",
        };
      }
      if (input.noninvasive_collection) {
        return {
          tier: "expedited",
          exempt_category: null,
          expedited_categories: [3],
          rationale:
            "Prospective collection of biospecimens by noninvasive means (45 CFR 46.110 cat 3).",
        };
      }
      if (input.noninvasive_procedure) {
        return {
          tier: "expedited",
          exempt_category: null,
          expedited_categories: [4],
          rationale:
            "Data collection through noninvasive procedures routinely employed in clinical practice (45 CFR 46.110 cat 4).",
        };
      }
      if (input.recording_collection) {
        return {
          tier: "expedited",
          exempt_category: null,
          expedited_categories: [6],
          rationale:
            "Voice / digital / image recording collection (45 CFR 46.110 cat 6).",
        };
      }
      if (input.risk_level === "greater_than_minimal") {
        if (input.marketed_drug) {
          warnings.push(
            "marketed_drug=true was supplied but risk_level=greater_than_minimal — expedited cat 1 requires minimal risk. Defaulting to full-board; PSUR SAE framework still applies via marketed_drug flag.",
          );
        }
        return {
          tier: "full_board",
          exempt_category: null,
          expedited_categories: [],
          rationale:
            "Non-interventional prospective study at greater-than-minimal risk → full-board review (45 CFR 46.108).",
        };
      }
      if (input.risk_level === "unknown") {
        warnings.push(
          "risk_level was 'unknown' on a non-interventional prospective study — defaulted conservatively to full-board review. Re-run with risk_level set when finalised.",
        );
        return {
          tier: "full_board",
          exempt_category: null,
          expedited_categories: [],
          rationale:
            "Non-interventional prospective study with unknown risk classification → conservative full-board review.",
        };
      }
      return {
        tier: "expedited",
        exempt_category: null,
        expedited_categories: [4],
        rationale:
          "Non-interventional prospective minimal-risk study (default expedited cat 4).",
      };
    }

    case "registry": {
      if (isAnonymous(input)) {
        return {
          tier: "exempt",
          exempt_category: 4,
          expedited_categories: [],
          rationale:
            "Registry of non-identifiable / aggregate data (45 CFR 46.104(d)(4)).",
        };
      }
      if (input.risk_level === "minimal") {
        return {
          tier: "expedited",
          exempt_category: null,
          expedited_categories: [5],
          rationale:
            "Registry using identifiable existing data at minimal risk (45 CFR 46.110 cat 5).",
        };
      }
      if (input.risk_level === "unknown") {
        warnings.push(
          "risk_level was 'unknown' on a registry — defaulted conservatively to full-board review. Re-run with risk_level set when finalised.",
        );
      }
      return {
        tier: "full_board",
        exempt_category: null,
        expedited_categories: [],
        rationale: "Registry at greater-than-minimal risk → full-board review.",
      };
    }

    case "interventional": {
      if (input.marketed_drug && input.risk_level === "minimal") {
        return {
          tier: "expedited",
          exempt_category: null,
          expedited_categories: [1],
          rationale:
            "Interventional study of a marketed drug at minimal risk per labeling (45 CFR 46.110 cat 1).",
        };
      }
      // Default: interventional → full-board. Rationale text branches on
      // the actual risk_level so the report doesn't falsely claim
      // "greater-than-minimal" when the user supplied "minimal" — earlier
      // version always asserted the former, which read as a misclassification
      // back to the user.
      return {
        tier: "full_board",
        exempt_category: null,
        expedited_categories: [],
        rationale:
          input.risk_level === "minimal"
            ? "Interventional study at minimal risk but no marketed-drug/device hint supplied — defaulted to full-board review under 45 CFR 46.108. If the product is a marketed drug or device used per labeling with no IND/IDE required, set marketed_drug=true to unlock expedited cat 1."
            : "Interventional drug / device / behavioural-intervention study at greater-than-minimal risk → full-board review under 45 CFR 46.108.",
      };
    }
  }
}

function classifyEu(
  input: IrbReviewInput,
): { tier: ReviewTierEu; timeline_days: number | null } | null {
  if (!input.jurisdictions.includes("eu_cec")) return null;
  if (input.study_design === "interventional") {
    if (input.multi_site) {
      return { tier: "ctr_multi_state", timeline_days: 60 };
    }
    return { tier: "national_only", timeline_days: 45 };
  }
  return { tier: "non_interventional_only", timeline_days: null };
}

function buildVulnerable(
  input: IrbReviewInput,
): VulnerablePopulationObligation[] {
  const out: VulnerablePopulationObligation[] = [];
  if (input.population_includes_pregnant) {
    out.push({
      group: "pregnant",
      regulatory_basis: VULNERABLE_OBLIGATIONS.pregnant.regulatory_basis,
      obligations: [...VULNERABLE_OBLIGATIONS.pregnant.obligations],
      v2_age_tier_table_pending: false,
    });
  }
  if (input.population_includes_prisoners) {
    out.push({
      group: "prisoners",
      regulatory_basis: VULNERABLE_OBLIGATIONS.prisoners.regulatory_basis,
      obligations: [...VULNERABLE_OBLIGATIONS.prisoners.obligations],
      v2_age_tier_table_pending: false,
    });
  }
  if (input.population_includes_pediatric) {
    out.push({
      group: "pediatric",
      regulatory_basis: VULNERABLE_OBLIGATIONS.pediatric.regulatory_basis,
      obligations: [...VULNERABLE_OBLIGATIONS.pediatric.obligations],
      v2_age_tier_table_pending: true,
    });
  }
  if (input.population_includes_decisionally_impaired) {
    out.push({
      group: "decisionally_impaired",
      regulatory_basis:
        VULNERABLE_OBLIGATIONS.decisionally_impaired.regulatory_basis,
      obligations: [
        ...VULNERABLE_OBLIGATIONS.decisionally_impaired.obligations,
      ],
      v2_age_tier_table_pending: false,
    });
  }
  return out;
}

function buildDmp(input: IrbReviewInput): DataManagementPlan {
  const onEu = input.jurisdictions.includes("eu_cec");
  const onUs = input.jurisdictions.includes("us_irb");
  const gdpr = onEu && !isAnonymous(input);
  const hipaaPhi = onUs && isIdentifiable(input);

  let deid: DeIdMethod;
  if (input.data_handling === "fully_identifiable") deid = "must_implement";
  else if (input.data_handling === "pseudonymized") deid = "pseudonymization";
  else if (input.data_handling === "anonymized_safe_harbor")
    deid = "safe_harbor";
  else if (input.data_handling === "anonymized_expert_determination")
    deid = "expert_determination";
  else deid = "not_required";

  const xfer: string[] = [];
  if (gdpr) {
    xfer.push(
      "GDPR Art. 9(2) lawful basis required for special-category health data (Art. 9(2)(j) for scientific research is the typical basis).",
    );
    if (onUs) {
      xfer.push(
        "EU→US transfer obligation: Standard Contractual Clauses (SCCs) with Transfer Impact Assessment, OR participation in the EU-US Data Privacy Framework.",
      );
    }
  }
  if (hipaaPhi) {
    xfer.push(
      "HIPAA §164.514(b)(2) Safe Harbor (18-identifier removal) or §164.514(b)(1) Expert Determination required prior to data sharing outside the covered entity.",
    );
  }

  return {
    gdpr_special_category: gdpr,
    hipaa_phi: hipaaPhi,
    de_identification_method: deid,
    cross_border_transfer_obligations: xfer,
  };
}

function buildSae(input: IrbReviewInput): SaeReportingObligations {
  // PASS_imposed override — CTR Annex III regardless of jurisdiction.
  const pvCat = input.pv_classification?.primary_category;
  if (pvCat === "PASS_imposed") {
    return {
      framework: "ctr_536_2014",
      timelines: [...CTR_536_2014_TIMELINES],
    };
  }

  const onEu = input.jurisdictions.includes("eu_cec");

  if (input.study_design === "interventional") {
    if (onEu) {
      return {
        framework: "ctr_536_2014",
        timelines: [...CTR_536_2014_TIMELINES],
      };
    }
    return { framework: "fda_ind_safety", timelines: [...FDA_IND_TIMELINES] };
  }

  if (
    input.study_design === "non_interventional_prospective" &&
    input.marketed_drug
  ) {
    return { framework: "post_marketing_psur", timelines: [...PSUR_TIMELINES] };
  }
  if (input.study_design === "registry" && input.marketed_drug) {
    return { framework: "post_marketing_psur", timelines: [...PSUR_TIMELINES] };
  }

  return { framework: "none", timelines: [] };
}

function computeIcfTier(
  input: IrbReviewInput,
  vulnerable: VulnerablePopulationObligation[],
): IcfTier {
  if (vulnerable.length > 0) return "complex";
  if (
    input.study_design === "interventional" &&
    (input.risk_level === "greater_than_minimal" ||
      input.risk_level === "unknown")
  ) {
    return "complex";
  }
  const isMinimal = input.risk_level === "minimal";
  const isNonInt = NON_INTERVENTIONAL_DESIGNS.has(input.study_design);
  // Benign-behavioural minimal-risk interventional studies (§46.104(d)(3)
  // exempt cat 3) warrant a basic ICF — the intervention is by definition
  // brief, harmless, and painless, so the consent is no more complex than
  // a non-interventional minimal-risk study.
  if (isMinimal && (isNonInt || input.benign_behavioural)) return "basic";
  return "standard";
}

function computeCoi(input: IrbReviewInput): {
  required: boolean;
  framework: CoiFramework;
} {
  const onUs = input.jurisdictions.includes("us_irb");
  const onEu = input.jurisdictions.includes("eu_cec");
  // PHS 42 CFR 50 Subpart F (FCOI regulation) applies to ALL Public Health
  // Service-funded research — NIH, AHRQ, CDC, HRSA, FDA, IHS, SAMHSA — plus
  // industry-funded US studies subject to the same disclosure obligations
  // when the institution is a PHS grantee. Pre-fix, this only fired for
  // industry funding, leaving NIH/CDC/AHRQ-funded studies with
  // coi_framework="none" — a real legal gap.
  const phsApplies =
    onUs &&
    (input.funding_source === "industry" ||
      input.funding_source === "nih" ||
      input.funding_source === "other_government");
  // EU CTR 536/2014 Annex I §M Point 66 disclosure of investigator economic
  // interests / institutional affiliations applies to industry-sponsored
  // trials (academic and government-funded EU trials are covered by national
  // ethics frameworks rather than CTR-specific COI sections).
  const euCtrApplies = onEu && input.funding_source === "industry";

  if (phsApplies && euCtrApplies) return { required: true, framework: "both" };
  if (phsApplies) return { required: true, framework: "phs_42_cfr_50" };
  if (euCtrApplies)
    return { required: true, framework: "eu_ctr_annex_i_point_66" };
  return { required: false, framework: "none" };
}

function reconcileExpeditedClaim(
  input: IrbReviewInput,
  derivedCategories: number[],
  warnings: string[],
): void {
  const claim = input.expedited_category_claim;
  if (!claim || claim.length === 0) return;
  const claimSet = new Set(claim);
  const derivedSet = new Set(derivedCategories);
  // Check if any claimed cat is missing from derived OR vice versa.
  const claimMissing = claim.filter((c) => !derivedSet.has(c));
  const derivedMissing = derivedCategories.filter((c) => !claimSet.has(c));
  if (claimMissing.length === 0 && derivedMissing.length === 0) return;

  const claimStr = claim.join(", ");
  const derivedStr =
    derivedCategories.length > 0 ? derivedCategories.join(", ") : "none";
  warnings.push(
    `expedited_category_claim mismatch: investigator claimed cat [${claimStr}], decision tree derived cat [${derivedStr}]. Surfacing both — confirm which classification fits the protocol with the IRB. Reference: 45 CFR 46.110 (OHRP expedited categories).`,
  );
}

export function assessIrb(input: IrbReviewInput): IrbAssessment {
  const warnings: string[] = [];

  const us = classifyUs(input, warnings);
  const eu = classifyEu(input);
  const vulnerable = buildVulnerable(input);
  const dmp = buildDmp(input);
  const sae = buildSae(input);
  const icf = computeIcfTier(input, vulnerable);
  const coi = computeCoi(input);

  if (us?.tier === "expedited") {
    reconcileExpeditedClaim(input, us.expedited_categories, warnings);
  } else if (input.expedited_category_claim?.length) {
    warnings.push(
      `expedited_category_claim was provided (cat [${input.expedited_category_claim.join(", ")}]) but the decision tree did not classify this study as expedited. Re-evaluate the claim against the actual review tier.`,
    );
  }

  // Build rationale — concatenate US + EU reasoning + PV/PASS_imposed link.
  const rationaleParts: string[] = [];
  if (us) rationaleParts.push(`US: ${us.rationale}`);
  if (eu) {
    if (eu.tier === "ctr_multi_state") {
      rationaleParts.push(
        `EU: Coordinated multi-state EC review under CTR 536/2014 (typical timeline: ${eu.timeline_days} days).`,
      );
    } else if (eu.tier === "national_only") {
      rationaleParts.push(
        `EU: National-level EC review under CTR 536/2014 (typical timeline: ${eu.timeline_days} days).`,
      );
    } else {
      rationaleParts.push(
        "EU: Non-interventional study — outside CTR 536/2014 scope; national EC review per local non-interventional framework.",
      );
    }
  }
  const pvCat = input.pv_classification?.primary_category;
  if (pvCat === "PASS_imposed") {
    rationaleParts.push(
      "PV: pv_classification.primary_category = PASS_imposed — Article 107n imposed PASS triggers CTR 536/2014 Annex III SAE reporting timelines on top of any jurisdiction-specific obligations.",
    );
  } else if (pvCat) {
    rationaleParts.push(
      `PV: pv_classification.primary_category = ${pvCat} (post-authorisation context — see GVP module mapping for downstream RMP and submission obligations).`,
    );
  }

  const coverLetter = buildCoverLetter({
    input,
    reviewTierUs: us?.tier ?? null,
    reviewTierEu: eu?.tier ?? null,
    saeFramework: sae.framework,
    coiFramework: coi.framework,
    coiRequired: coi.required,
  });

  return {
    review_tier_us: us?.tier ?? null,
    exempt_category_us: us?.exempt_category ?? null,
    expedited_categories_us: us?.expedited_categories ?? [],
    review_tier_eu: eu?.tier ?? null,
    eu_cec_timeline_days: eu?.timeline_days ?? null,
    vulnerable_population_obligations: vulnerable,
    data_management_plan: dmp,
    sae_reporting_obligations: sae,
    icf_complexity_tier: icf,
    coi_disclosure_required: coi.required,
    coi_framework: coi.framework,
    cover_letter_template: coverLetter,
    rationale: rationaleParts.join(" "),
    advisory_warnings: warnings,
    irb_ruleset: IRB_RULESET,
  };
}
