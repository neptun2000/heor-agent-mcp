/**
 * Static regulatory data tables for irb_review.
 *
 * - 45 CFR 46.104 exempt categories (1-8) — Common Rule 2018 revision.
 * - 45 CFR 46.110 expedited categories (1-7) — OHRP expedited review list.
 * - CTR 536/2014 Annex III SUSAR/SAE timelines.
 * - FDA IND safety reporting timelines (21 CFR 312.32).
 * - PSUR post-marketing schedule.
 *
 * Verified against the regulatory texts directly. Indication of source with
 * each table so future maintainers can audit them.
 */

export interface ExemptCategoryDef {
  category: number;
  title: string;
  citation: string; // "45 CFR 46.104(d)(N)"
  summary: string;
}

export const EXEMPT_CATEGORIES: ReadonlyArray<ExemptCategoryDef> = [
  {
    category: 1,
    title: "Educational practices in established educational settings",
    citation: "45 CFR 46.104(d)(1)",
    summary:
      "Research conducted in established or commonly accepted educational settings, involving normal educational practices.",
  },
  {
    category: 2,
    title:
      "Educational tests, surveys, interviews, public observation",
    citation: "45 CFR 46.104(d)(2)",
    summary:
      "Educational tests, surveys, interviews, or observation of public behavior — when responses are recorded such that identification is not readily ascertainable, or disclosure outside research would not place subjects at risk.",
  },
  {
    category: 3,
    title: "Benign behavioural interventions in adults",
    citation: "45 CFR 46.104(d)(3)",
    summary:
      "Benign behavioral interventions with adult subjects who prospectively agree, when interventions are brief, harmless, painless, not physically invasive, and not likely to have significant adverse impact.",
  },
  {
    category: 4,
    title: "Secondary research using identifiable info or biospecimens",
    citation: "45 CFR 46.104(d)(4)",
    summary:
      "Secondary research using identifiable private information or identifiable biospecimens — when information was collected for non-research purposes, or is publicly available, or is recorded so subjects cannot be readily identified.",
  },
  {
    category: 5,
    title:
      "Federal demonstration projects under benefit / service programs",
    citation: "45 CFR 46.104(d)(5)",
    summary:
      "Research and demonstration projects conducted or supported by a Federal department or agency to study or evaluate public benefit / service programs.",
  },
  {
    category: 6,
    title: "Taste and food quality / consumer acceptance evaluations",
    citation: "45 CFR 46.104(d)(6)",
    summary:
      "Taste and food quality evaluations and consumer acceptance studies, when wholesome foods without additives are consumed, or when foods contain ingredients at or below safe levels established by FDA / USDA / EPA.",
  },
  {
    category: 7,
    title:
      "Storage / maintenance of identifiable info or biospecimens for secondary research with broad consent",
    citation: "45 CFR 46.104(d)(7)",
    summary:
      "Storage or maintenance of identifiable private information or identifiable biospecimens for potential secondary research, when broad consent has been obtained and IRB documents the consent.",
  },
  {
    category: 8,
    title: "Secondary research with broad consent",
    citation: "45 CFR 46.104(d)(8)",
    summary:
      "Secondary research using identifiable private information or biospecimens for which broad consent was obtained, IRB conducts limited review and confirms documentation.",
  },
];

export interface ExpeditedCategoryDef {
  category: number;
  title: string;
  citation: string; // "45 CFR 46.110, Cat N"
  summary: string;
}

export const EXPEDITED_CATEGORIES: ReadonlyArray<ExpeditedCategoryDef> = [
  {
    category: 1,
    title: "Drug / device research at minimal risk for marketed product",
    citation: "45 CFR 46.110, OHRP Expedited Review Cat 1",
    summary:
      "Clinical studies of drugs or medical devices: drugs for which an IND application is not required, or devices for which IDE is not required, where the only involvement of human subjects is the use of the marketed product per labeling.",
  },
  {
    category: 2,
    title: "Blood collection within prescribed limits",
    citation: "45 CFR 46.110, Cat 2",
    summary:
      "Collection of blood samples by venipuncture, within volume / frequency limits per OHRP guidance (≤550 mL / 8 weeks for healthy non-pregnant adults; lesser for other groups).",
  },
  {
    category: 3,
    title: "Prospective collection of biological specimens by noninvasive means",
    citation: "45 CFR 46.110, Cat 3",
    summary:
      "Prospective collection of biological specimens for research purposes by noninvasive means (e.g., hair, nail clippings, saliva, expectorated sputum).",
  },
  {
    category: 4,
    title: "Data collection through noninvasive procedures",
    citation: "45 CFR 46.110, Cat 4",
    summary:
      "Collection of data through noninvasive procedures (e.g., ECG, EEG, blood pressure, ultrasound) routinely employed in clinical practice.",
  },
  {
    category: 5,
    title:
      "Research using existing data / documents / records / specimens",
    citation: "45 CFR 46.110, Cat 5",
    summary:
      "Research involving materials (data, documents, records, specimens) that have been collected, or will be collected solely for non-research purposes.",
  },
  {
    category: 6,
    title: "Voice / digital / image recordings for research",
    citation: "45 CFR 46.110, Cat 6",
    summary:
      "Collection of data from voice, video, digital, or image recordings made for research purposes.",
  },
  {
    category: 7,
    title:
      "Survey / interview / oral history / program evaluation / focus group research",
    citation: "45 CFR 46.110, Cat 7",
    summary:
      "Research on individual or group characteristics or behavior (perception, cognition, motivation, identity) — surveys, interviews, oral history, focus groups, program evaluation, human factors evaluation.",
  },
];

/** CTR 536/2014 Annex III — SUSAR/SAE expedited reporting timelines. */
export const CTR_536_2014_TIMELINES: ReadonlyArray<{
  event_type: string;
  reporting_window: string;
}> = [
  {
    event_type: "Fatal or life-threatening SUSAR",
    reporting_window: "≤7 days (initial), ≤8 days follow-up",
  },
  {
    event_type: "Other SUSARs",
    reporting_window: "≤15 days",
  },
  {
    event_type: "Annual safety report (DSUR)",
    reporting_window: "Annually for the duration of the trial",
  },
];

/** FDA IND Safety Reporting timelines (21 CFR 312.32). */
export const FDA_IND_TIMELINES: ReadonlyArray<{
  event_type: string;
  reporting_window: string;
}> = [
  {
    event_type: "Unexpected fatal or life-threatening suspected adverse reaction",
    reporting_window: "≤7 calendar days (initial)",
  },
  {
    event_type: "Other serious unexpected suspected adverse reactions",
    reporting_window: "≤15 calendar days",
  },
  {
    event_type: "IND annual report",
    reporting_window: "Annually",
  },
];

/** PSUR post-marketing reporting cadence. */
export const PSUR_TIMELINES: ReadonlyArray<{
  event_type: string;
  reporting_window: string;
}> = [
  {
    event_type: "Periodic Safety Update Report (PSUR)",
    reporting_window:
      "Every 6 months for first 2 years post-MA, annually for next 2, then 3-yearly (or per RMP).",
  },
  {
    event_type: "Individual case safety reports (ICSRs) — serious",
    reporting_window: "≤15 days to EudraVigilance",
  },
  {
    event_type: "Individual case safety reports (ICSRs) — non-serious",
    reporting_window: "≤90 days to EudraVigilance",
  },
];

/** Subpart B/C/D obligations text (concise). */
export const VULNERABLE_OBLIGATIONS = {
  pregnant: {
    regulatory_basis: "45 CFR 46 Subpart B (pregnant women, fetuses, neonates)",
    obligations: [
      "Risk to the fetus must be the least possible to achieve study objectives.",
      "Both parents' consent required when research holds no direct benefit, except where father is unavailable / unable / not reasonably available, or pregnancy resulted from rape or incest.",
      "No financial inducements to terminate pregnancy.",
      "EU CTR 536/2014 Article 33 — additional EC scrutiny for pregnant subjects in interventional trials.",
    ],
  },
  prisoners: {
    regulatory_basis: "45 CFR 46 Subpart C (prisoners)",
    obligations: [
      "Research must fall into one of the four permitted prisoner-research categories (§46.306) — practices that may improve health/well-being of prisoners as a class is the broadest.",
      "IRB composition must include a prisoner advocate (≥1 IRB member must be a prisoner or prisoner representative).",
      "Risks must be commensurate with risks accepted by non-prisoner volunteers.",
      "Parole considerations cannot be tied to study participation; living conditions during study must be considered.",
    ],
  },
  pediatric: {
    regulatory_basis: "45 CFR 46 Subpart D (children)",
    obligations: [
      "Risk-tier classification: §46.404 (minimal risk), §46.405 (greater-than-minimal with prospect of direct benefit), §46.406 (minor increase over minimal, no direct benefit), §46.407 (otherwise unapprovable, requires HHS Secretary panel review).",
      "Permission of parents (one parent for §46.404/405; both for §46.406/407 unless waived).",
      "Assent of the child when capable — IRB determines capability based on age and condition.",
      "EU CTR 536/2014 Article 32 — additional protections for paediatric subjects; Paediatric Investigation Plan (PIP) under EMA Reg. 1901/2006 may apply.",
      "v2_age_tier_table_pending: full state-by-state pediatric assent age table coming in v2.",
    ],
  },
  decisionally_impaired: {
    regulatory_basis:
      "45 CFR 46.111(b) — additional safeguards for vulnerable subjects with diminished decision-making capacity",
    obligations: [
      "Capacity assessment by an independent clinician (not the investigator).",
      "Surrogate / Legally Authorized Representative (LAR) consent per state law (US) or national law (EU).",
      "Re-consent when capacity is regained.",
      "Particular caution for studies where impairment is part of the inclusion criteria — IRB scrutiny of risk/benefit is heightened.",
    ],
  },
} as const;
