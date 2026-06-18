/**
 * Pure publication-draft assembler. No I/O.
 *
 * Builds an abstract / manuscript / poster / plain-language summary from
 * structured content, selects the right reporting guideline for the study
 * design (CONSORT / STROBE / PRISMA / CHEERS), and emits a GPP2022 +
 * ICMJE compliance checklist. Referenced claims (pulled by the tool from
 * the claim registry) are woven into the results so the same source-of-
 * truth figures appear in the publication as in the dossier.
 */
import type {
  Claim,
  PublicationResult,
  PublicationSection,
  PublicationType,
  StudyDesign,
} from "./types.js";

export interface PublicationContent {
  title: string;
  type: PublicationType;
  target?: string;
  study_design: StudyDesign;
  background?: string;
  objective?: string;
  methods?: string;
  results?: string;
  conclusions?: string;
  /** Claims resolved by the tool from the registry, inserted into Results. */
  resolved_claims: Claim[];
  /** Word limit override; defaults applied per type when omitted. */
  word_limit?: number;
  funded?: boolean;
  medical_writing_support?: boolean;
  trial_registration_id?: string;
}

const DEFAULT_WORD_LIMIT: Record<PublicationType, number | null> = {
  abstract: 300,
  poster: 500,
  plain_language_summary: 250,
  manuscript: null,
};

function reportingGuideline(design: StudyDesign): string {
  switch (design) {
    case "rct":
      return "CONSORT 2010 (randomised trials)";
    case "observational":
      return "STROBE (observational studies)";
    case "systematic_review":
      return "PRISMA 2020 (systematic reviews / meta-analyses)";
    case "economic_evaluation":
      return "CHEERS 2022 (health economic evaluations)";
    default:
      return "EQUATOR Network — select the guideline matching the study design";
  }
}

function claimsBlock(claims: Claim[]): string {
  if (claims.length === 0) return "";
  const lines = claims.map((c) => {
    const val = c.value_display ?? (c.numeric_value !== undefined ? String(c.numeric_value) : "");
    const cite = c.citation ? ` [${c.citation}]` : "";
    return `- ${c.statement}${val && !c.statement.includes(val) ? ` (${val})` : ""}${cite}`;
  });
  return `\n\nKey results (from the project claim registry — single source of truth):\n${lines.join("\n")}`;
}

function buildSections(content: PublicationContent): PublicationSection[] {
  const results =
    (content.results ?? "") + claimsBlock(content.resolved_claims);

  if (content.type === "plain_language_summary") {
    return [
      {
        heading: "What was studied?",
        body: content.background ?? content.objective ?? "—",
      },
      { heading: "What did we do?", body: content.methods ?? "—" },
      { heading: "What did we find?", body: results.trim() || "—" },
      { heading: "What does it mean?", body: content.conclusions ?? "—" },
    ];
  }

  if (content.type === "manuscript") {
    // IMRaD
    return [
      {
        heading: "Introduction",
        body: [content.background, content.objective].filter(Boolean).join("\n\n") || "—",
      },
      { heading: "Methods", body: content.methods ?? "—" },
      { heading: "Results", body: results.trim() || "—" },
      { heading: "Discussion", body: content.conclusions ?? "—" },
      {
        heading: "Conclusion",
        body: content.conclusions ?? "—",
      },
    ];
  }

  // abstract + poster: structured Background/Methods/Results/Conclusions
  return [
    {
      heading: "Background",
      body: [content.background, content.objective].filter(Boolean).join(" ") || "—",
    },
    { heading: "Methods", body: content.methods ?? "—" },
    { heading: "Results", body: results.trim() || "—" },
    { heading: "Conclusions", body: content.conclusions ?? "—" },
  ];
}

function countWords(sections: PublicationSection[]): number {
  const text = sections.map((s) => `${s.heading} ${s.body}`).join(" ");
  const tokens = text.trim().match(/\S+/g);
  return tokens ? tokens.length : 0;
}

export function buildPublication(
  content: PublicationContent,
): PublicationResult {
  const sections = buildSections(content);
  const word_count = countWords(sections);
  const word_limit =
    content.word_limit ?? DEFAULT_WORD_LIMIT[content.type];
  const guideline = reportingGuideline(content.study_design);

  const compliance_checklist: { item: string; mandatory: boolean }[] = [
    {
      item: "ICMJE authorship: all authors meet all 4 criteria (contribution, drafting, approval, accountability)",
      mandatory: true,
    },
    {
      item: "GPP2022: any professional medical writer is acknowledged + funding for writing disclosed",
      mandatory: content.medical_writing_support === true,
    },
    {
      item: "Conflict-of-interest / disclosure statement for every author",
      mandatory: true,
    },
    {
      item: "Funding source disclosed",
      mandatory: content.funded !== false,
    },
    {
      item: `Reporting guideline followed: ${guideline}`,
      mandatory: true,
    },
    {
      item: "Trial registration ID stated (ICMJE requires prospective registration)",
      mandatory: content.study_design === "rct",
    },
    {
      item: "Data-sharing statement included",
      mandatory: content.type === "manuscript",
    },
  ];

  const warnings: string[] = [];
  if (word_limit !== null && word_count > word_limit) {
    warnings.push(
      `Draft is ${word_count} words, over the ${word_limit}-word ${content.type} limit${content.target ? ` for ${content.target}` : ""} — trim ${word_count - word_limit} words.`,
    );
  }
  if (content.study_design === "rct" && !content.trial_registration_id) {
    warnings.push(
      "RCT without a trial_registration_id — ICMJE journals require prospective registration; add the registry ID before submission.",
    );
  }
  if (content.resolved_claims.some((c) => c.status === "superseded")) {
    warnings.push(
      "One or more referenced claims are marked 'superseded' in the registry — do not cite a superseded figure; update or remove it.",
    );
  }
  warnings.push(
    "Draft is AI-assisted scaffolding — all data, citations, and authorship must be verified; named authors are responsible for the content (ICMJE: AI cannot be an author).",
  );

  return {
    type: content.type,
    title: content.title,
    target: content.target,
    sections,
    reporting_guideline: guideline,
    compliance_checklist,
    word_count,
    word_limit,
    referenced_claims: content.resolved_claims.map((c) => c.id),
    warnings,
  };
}
