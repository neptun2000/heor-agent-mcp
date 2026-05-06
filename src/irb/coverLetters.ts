/**
 * Cover-letter template for irb_review.
 *
 * Returns a single paragraph string (~200 words) ready to paste into an IRB /
 * EC submission portal. Includes drug, indication, review tier, COI status,
 * data-handling approach, and SAE framework. Customer pastes and edits in
 * place — we don't try to produce a finished submission, only the structural
 * scaffold so the human knows what sections must be present.
 */

import type {
  CoiFramework,
  IrbReviewInput,
  ReviewTierEu,
  ReviewTierUs,
  SaeFramework,
} from "./types.js";

const TIER_LABEL_US: Record<ReviewTierUs, string> = {
  exempt: "Exempt determination under 45 CFR 46.104",
  expedited: "Expedited review under 45 CFR 46.110",
  full_board: "Full Board review under 45 CFR 46.108",
  not_applicable: "(US IRB tier not applicable)",
};

const TIER_LABEL_EU: Record<ReviewTierEu, string> = {
  national_only: "National-level Ethics Committee review",
  ctr_multi_state:
    "Coordinated Multi-State EC Review under EU Regulation 536/2014 (CTR)",
  non_interventional_only:
    "EC review under national non-interventional study framework (CTR 536/2014 not applicable)",
};

const SAE_LABEL: Record<SaeFramework, string> = {
  ctr_536_2014: "EU CTR 536/2014 Annex III SUSAR / SAE timelines",
  fda_ind_safety: "FDA IND Safety Reporting (21 CFR 312.32)",
  post_marketing_psur:
    "Periodic Safety Update Reports (PSUR) and EudraVigilance ICSRs",
  none: "No SAE-reporting framework (study design not subject to expedited safety reporting)",
};

const COI_LABEL: Record<CoiFramework, string> = {
  phs_42_cfr_50:
    "PHS 42 CFR 50 Subpart F (Promoting Objectivity in Research)",
  eu_ctr_article_14:
    "EU CTR 536/2014 Article 14 (transparency and conflict-of-interest disclosure)",
  both:
    "PHS 42 CFR 50 Subpart F (US) and EU CTR 536/2014 Article 14 (EU)",
  none: "No conflict-of-interest framework triggered (non-industry funding)",
};

export function buildCoverLetter(args: {
  input: IrbReviewInput;
  reviewTierUs: ReviewTierUs | null;
  reviewTierEu: ReviewTierEu | null;
  saeFramework: SaeFramework;
  coiFramework: CoiFramework;
  coiRequired: boolean;
}): string {
  const { input, reviewTierUs, reviewTierEu, saeFramework, coiFramework } =
    args;

  const tierUs = reviewTierUs ? TIER_LABEL_US[reviewTierUs] : null;
  const tierEu = reviewTierEu ? TIER_LABEL_EU[reviewTierEu] : null;
  const tiers = [tierUs, tierEu].filter(Boolean).join(" + ");
  const saeText = SAE_LABEL[saeFramework];
  const coiText = COI_LABEL[coiFramework];

  const populationCaveats: string[] = [];
  if (input.population_includes_pediatric)
    populationCaveats.push("paediatric subjects (45 CFR 46 Subpart D)");
  if (input.population_includes_pregnant)
    populationCaveats.push("pregnant subjects (45 CFR 46 Subpart B)");
  if (input.population_includes_prisoners)
    populationCaveats.push("incarcerated subjects (45 CFR 46 Subpart C)");
  if (input.population_includes_decisionally_impaired)
    populationCaveats.push("subjects with diminished decision-making capacity");
  const populationLine =
    populationCaveats.length > 0
      ? `The study population includes ${populationCaveats.join(", ")}, and the protocol incorporates the additional safeguards required for these vulnerable groups. `
      : "";

  return [
    `Dear Members of the Institutional Review Board / Ethics Committee,`,
    ``,
    `We are submitting the attached protocol and supporting materials for your review of a planned study of ${input.intervention} in ${input.indication}. The study is designed as a ${input.study_design.replace(/_/g, " ")}, and the requested review pathway is: ${tiers || "(jurisdiction-specific tiers not established)"}.`,
    ``,
    `Risk classification: ${input.risk_level}. The data-handling approach is "${input.data_handling}" — the Data Management Plan section of this submission details the de-identification and cross-border transfer obligations as applicable. ${populationLine}Safety monitoring will follow ${saeText}, with the SAE / SUSAR reporting timelines tabulated in the protocol.`,
    ``,
    `Conflict-of-interest disclosures: this study is funded by ${input.funding_source}. The applicable framework is ${coiText}, and individual investigator disclosures are filed with this submission. ${input.multi_site ? "This is a multi-site study, and coordination across sites follows the lead site's framework with local-site ethics oversight where required. " : ""}`,
    ``,
    `We confirm that the protocol, ICF, and supporting documents have undergone scientific review and are ready for ethics review. We are available to address any questions or to revise the submission per Committee feedback. Thank you for your consideration.`,
    ``,
    `Sincerely,`,
    `[Principal Investigator]`,
    `[Institution]`,
    `[Date]`,
  ].join("\n");
}
