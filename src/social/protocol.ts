/**
 * Pure protocol generator for rwe.social_listening_protocol. No I/O.
 *
 * Assembles a social-listening study protocol + compliance checklist from
 * the study parameters. Conditional logic: the PV adverse-event-handling
 * section is ALWAYS mandatory (GVP Module VI applies to any systematic
 * digital-media review); GDPR/HIPAA items switch on the privacy
 * jurisdictions; the MAH-managed-channel flag escalates PV obligations.
 */
import type {
  ProtocolSection,
  SocialProtocolInput,
  SocialProtocolResult,
} from "./types.js";

const OBJECTIVE_LABELS: Record<string, string> = {
  patient_experience: "characterise lived patient experience",
  sentiment: "measure sentiment toward the product/disease",
  adverse_event_monitoring: "monitor for adverse-event signals",
  unmet_need: "identify residual unmet need",
  treatment_adherence: "understand adherence drivers and barriers",
  disease_awareness: "assess disease awareness and information gaps",
};

const PLATFORM_LABELS: Record<string, string> = {
  x_twitter: "X / Twitter",
  reddit: "Reddit",
  facebook: "Facebook",
  instagram: "Instagram",
  patient_forums: "disease-specific patient forums",
  youtube: "YouTube",
  tiktok: "TikTok",
  blogs: "patient blogs",
};

export function buildSocialProtocol(
  input: SocialProtocolInput,
): SocialProtocolResult {
  const sections: ProtocolSection[] = [];
  const warnings: string[] = [];

  const objLabels = input.objectives.map((o) => OBJECTIVE_LABELS[o] ?? o);
  const platLabels = input.platforms.map((p) => PLATFORM_LABELS[p] ?? p);

  // 1. Objectives & scope
  sections.push({
    heading: "1. Objectives & scope",
    items: [
      `Primary aim: ${objLabels.join("; ")} for ${input.drug} in ${input.indication}.`,
      `Platforms in scope: ${platLabels.join(", ")}.`,
      input.time_window_months
        ? `Look-back window: ${input.time_window_months} months.`
        : "Look-back window: define explicitly (e.g. 12 months) before data pull.",
      "Design: retrospective, listening-only (no engagement/intervention with users).",
    ],
  });

  // 2. Search strategy
  const kw = input.keywords.length
    ? input.keywords
    : ["<add brand name>", "<add INN/generic>", "<add common misspellings>"];
  sections.push({
    heading: "2. Search strategy",
    items: [
      `Seed keywords: ${kw.join(", ")}.`,
      "Expand to brand + INN/generic names, common misspellings, abbreviations, and lay terms for the condition and its symptoms.",
      "Include symptom/side-effect lay terms so adverse events are not under-captured.",
      "Document the exact query strings, platform, and pull date for reproducibility.",
    ],
  });

  // 3. Inclusion / exclusion
  sections.push({
    heading: "3. Inclusion / exclusion criteria",
    items: [
      "Include: posts in scope language(s) mentioning the product or condition within the look-back window.",
      "Exclude: promotional/news/HCP-marketing accounts, duplicates/retweets, and bot-flagged accounts.",
      "Record exclusion reasons for the audit trail (PRISMA-style flow for the final report).",
    ],
  });

  // 4. Analysis plan
  sections.push({
    heading: "4. Analysis plan",
    items: [
      "Sentiment classification (positive / neutral / negative / mixed) with a documented coding rubric and inter-coder agreement on a sample.",
      "Thematic coding (efficacy, tolerability, access/cost, adherence, information needs) with a pre-specified codebook.",
      "Adverse-event extraction with MedDRA preferred-term coding; route every AE-bearing post to the PV workflow (Section 6).",
      "Report counts/proportions descriptively only — do NOT compute rates or effect sizes from social data.",
    ],
  });

  // 5. Data governance, privacy & ethics
  const privacyItems: string[] = [
    "Collect the minimum data necessary; store pseudonymised; never publish quotes that could re-identify a user.",
    "Honour each platform's Terms of Service and API usage limits; use only permitted access methods.",
    "Document the lawful basis and a data-retention/deletion schedule.",
  ];
  if (input.privacy_jurisdictions.some((j) => j === "eu_gdpr" || j === "uk_gdpr" || j === "global")) {
    privacyItems.push(
      "GDPR (EU/UK): health data is a special category (Art. 9) — establish an Art. 6 + Art. 9 lawful basis, complete a DPIA, and apply data-minimisation/anonymisation before analysis.",
    );
  }
  if (input.privacy_jurisdictions.some((j) => j === "us_hipaa" || j === "global")) {
    privacyItems.push(
      "US: public social posts are generally not HIPAA-covered, but treat health-related personal data as sensitive; confirm no covered-entity data is ingested.",
    );
  }
  privacyItems.push(
    "Ethics/IRB: most public-post listening is exempt, but obtain an IRB exemption determination in writing — pair with the irb.review tool.",
  );
  sections.push({ heading: "5. Data governance, privacy & ethics", items: privacyItems });

  // 6. Pharmacovigilance handling (ALWAYS mandatory)
  const pvItems = [
    "Mandatory: screen 100% of in-scope posts for adverse events throughout the study (GVP Module VI rev 2).",
    "Apply the four-element ICSR test (identifiable reporter + patient + suspect product + event); route valid cases to the safety database — 15 days serious / 90 days non-serious.",
    "Triage with pv.social_listening_triage; classify signals with pv.signal_workflow / pv.classify as needed.",
    "Pre-agree the AE-handoff SOP and timelines with the PV/QPPV function BEFORE data collection starts.",
  ];
  if (input.is_mah_managed_channel) {
    pvItems.unshift(
      "⚠️ This is an MAH-sponsored/managed channel — proactive AE solicitation and full reporting obligations apply; the channel must be monitored on a defined, documented schedule.",
    );
  } else {
    pvItems.push(
      "Non-MAH-managed media: systematic review still triggers reporting duties once you proactively search it — the obligation attaches to the systematic review, not channel ownership.",
    );
  }
  sections.push({ heading: "6. Pharmacovigilance handling (mandatory)", items: pvItems });

  // 7. Deliverables
  sections.push({
    heading: "7. Deliverables",
    items: [
      "Methods log (queries, dates, inclusion flow), coded dataset, sentiment/theme summary, AE-handoff log, and a limitations-aware narrative report.",
      "Flag every quantitative figure as descriptive/hypothesis-generating.",
    ],
  });

  // Compliance checklist
  const compliance_checklist: { item: string; mandatory: boolean }[] = [
    { item: "AE screening SOP agreed with PV/QPPV before data pull", mandatory: true },
    { item: "Four-element ICSR triage workflow in place (pv.social_listening_triage)", mandatory: true },
    { item: "Platform Terms-of-Service / API compliance confirmed", mandatory: true },
    { item: "IRB exemption determination obtained in writing", mandatory: true },
    {
      item: "GDPR DPIA + Art. 6/9 lawful basis documented",
      mandatory: input.privacy_jurisdictions.some(
        (j) => j === "eu_gdpr" || j === "uk_gdpr" || j === "global",
      ),
    },
    { item: "Pseudonymisation + retention/deletion schedule defined", mandatory: true },
    { item: "MedDRA coding dictionary version recorded", mandatory: false },
    { item: "Inter-coder agreement assessed on a sample", mandatory: false },
  ];

  const limitations = [
    "Selection bias: social-media users are not representative of the patient population (age, severity, digital access).",
    "Unverifiable identity: posters' diagnoses, exposures, and outcomes cannot be confirmed.",
    "Bots, marketing, and duplicate content inflate volumes.",
    "Platform/API changes and ToS limits affect data completeness and reproducibility.",
    "Results are descriptive and hypothesis-generating — not effectiveness, incidence, or causal evidence (lowest RWE validity tier).",
  ];

  warnings.push(
    "Social-listening is the lowest-validity RWE method — position outputs as qualitative/hypothesis-generating and triangulate with higher-validity designs (see rwe.method_select / evidence.triangulation).",
  );
  if (!input.objectives.includes("adverse_event_monitoring")) {
    warnings.push(
      "Adverse-event monitoring was not listed as an objective, but PV screening is still mandatory for any systematic social-media review — Section 6 applies regardless.",
    );
  }

  return {
    drug: input.drug,
    indication: input.indication,
    objectives: input.objectives,
    platforms: input.platforms,
    sections,
    compliance_checklist,
    limitations,
    warnings,
  };
}
