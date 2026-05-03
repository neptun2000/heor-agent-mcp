import { z } from "zod";
import type { ToolResult } from "../providers/types.js";
import {
  createAuditRecord,
  addAssumption,
  addWarning,
  setMethodology,
} from "../audit/builder.js";
import { auditToMarkdown } from "../formatters/markdown.js";

// Only title + abstract + study_type are needed for RoB inference. The rest
// are display/citation fields — make them optional with sensible fallbacks
// so real-world inputs (Claude/GPT pasting partial study data) don't fail
// at the schema boundary. PostHog showed 71% of real risk_of_bias calls
// were failing on missing source/authors/date/url; this fixes that.
const StudyInputSchema = z.object({
  title: z.string().min(1),
  abstract: z.string(), // may be empty; tool returns Unclear for missing detail
  study_type: z.string().default("unknown"),
  id: z.string().optional(),
  source: z.string().optional(),
  authors: z.array(z.string()).optional(),
  date: z.string().optional(),
  url: z.string().optional(),
});

const RiskOfBiasSchema = z.object({
  studies: z.array(StudyInputSchema).min(1, "At least 1 study required"),
  instrument: z
    .enum(["auto", "rob2", "robins_i", "amstar2"])
    .default("auto")
    .describe("Assessment instrument. auto detects from study_type."),
  outcomes: z
    .array(z.string())
    .optional()
    .describe("Outcomes of interest for domain-level context"),
  output_format: z.enum(["text", "json"]).optional(),
});

// ── Instrument detection ──────────────────────────────────────────────────────

type Instrument = "rob2" | "robins_i" | "amstar2";

function detectInstrument(
  studyType: string,
  title: string,
  abstract: string,
): Instrument {
  const text = `${studyType} ${title} ${abstract}`.toLowerCase();
  if (
    text.includes("systematic review") ||
    text.includes("meta-analysis") ||
    text.includes("meta analysis") ||
    /\b(sr|ma)\b/.test(text)
  )
    return "amstar2";
  if (
    text.includes("randomized") ||
    text.includes("randomised") ||
    text.includes("rct") ||
    text.includes("phase iii") ||
    text.includes("phase 3") ||
    // Phase II only counts if there is also a randomization signal
    ((text.includes("phase ii") || text.includes("phase 2")) &&
      (text.includes("randomized") || text.includes("randomised"))) ||
    text.includes("clinical trial") ||
    text.includes("controlled trial")
  )
    return "rob2";
  if (
    text.includes("cohort") ||
    text.includes("observational") ||
    text.includes("case-control") ||
    text.includes("cross-sectional") ||
    text.includes("registry") ||
    text.includes("retrospective") ||
    text.includes("real-world") ||
    text.includes("claims")
  )
    return "robins_i";
  return "rob2"; // default
}

// ── Domain inference ──────────────────────────────────────────────────────────

interface DomainResult {
  judgment: string;
  rationale: string;
  uncertainty_note?: string;
}

function inferDomain(
  text: string,
  positiveSignals: string[],
  negativeSignals: string[],
  lowLabel: string,
  highLabel: string,
): DomainResult {
  const lower = text.toLowerCase();
  const posHits = positiveSignals.filter((s) => lower.includes(s));
  const negHits = negativeSignals.filter((s) => lower.includes(s));

  if (negHits.length > 0) {
    return {
      judgment: highLabel,
      rationale: `Concern signals: ${negHits.join(", ")}`,
    };
  }
  if (posHits.length >= 2) {
    return {
      judgment: lowLabel,
      rationale: `Quality signals: ${posHits.join(", ")}`,
    };
  }
  if (posHits.length === 1) {
    return {
      judgment: `Probably ${lowLabel}`,
      rationale: `Partial signal: ${posHits[0]}`,
    };
  }
  return {
    judgment: "Unclear",
    rationale: "No relevant methodological details reported in abstract",
    uncertainty_note: "Full-text review required for this domain",
  };
}

// ── RoB 2 (RCTs) ─────────────────────────────────────────────────────────────

function assessRob2(study: z.infer<typeof StudyInputSchema>): {
  domains: Record<string, DomainResult>;
  overall: string;
  instrument: Instrument;
} {
  const text = `${study.title} ${study.abstract}`;

  const domains: Record<string, DomainResult> = {
    "D1: Randomization": inferDomain(
      text,
      [
        "randomized",
        "randomised",
        "allocation concealment",
        "stratified",
        "computer-generated",
        "central randomization",
        "sealed envelope",
      ],
      [
        "open-label",
        "no allocation concealment",
        "quasi-randomized",
        "non-randomized",
      ],
      "Low",
      "High",
    ),
    "D2: Deviations": inferDomain(
      text,
      [
        "intention-to-treat",
        "itt analysis",
        "full analysis set",
        "double-blind",
        "blinded",
        "masked",
        "double blind",
      ],
      ["open-label", "per-protocol only", "unblinded", "protocol deviation"],
      "Low",
      "High",
    ),
    "D3: Missing data": inferDomain(
      text,
      [
        "complete follow-up",
        "no missing data",
        "multiple imputation",
        "locf",
        "full analysis set",
        "low dropout",
        "itt population",
      ],
      [
        "high dropout",
        "substantial missing",
        "lost to follow-up >20%",
        "withdrew",
      ],
      "Low",
      "High",
    ),
    "D4: Measurement": inferDomain(
      text,
      [
        "blinded assessment",
        "central adjudication",
        "adjudicated",
        "objective outcome",
        "independent committee",
        "blinded evaluator",
      ],
      [
        "self-reported",
        "unblinded assessment",
        "investigator-assessed without blinding",
      ],
      "Low",
      "High",
    ),
    "D5: Reporting": inferDomain(
      text,
      [
        "pre-registered",
        "nct",
        "clinicaltrials.gov",
        "isrctn",
        "protocol pre-specified",
        "primary endpoint pre-specified",
        "registered trial",
      ],
      ["post-hoc", "unregistered", "exploratory analysis as primary"],
      "Low",
      "High",
    ),
  };

  const judgments = Object.values(domains).map((d) => d.judgment);
  const hasHigh = judgments.some((j) => j === "High" || j === "Critical");
  const hasProbHigh = judgments.some((j) => j.includes("Probably High"));
  const hasUnclear = judgments.some((j) => j === "Unclear");

  let overall: string;
  if (!hasHigh && !hasProbHigh && !hasUnclear) overall = "Low";
  else if (hasHigh) overall = "High";
  else overall = "Some concerns";

  return { domains, overall, instrument: "rob2" };
}

// ── ROBINS-I (observational) ──────────────────────────────────────────────────

function assessRobinsI(study: z.infer<typeof StudyInputSchema>): {
  domains: Record<string, DomainResult>;
  overall: string;
  instrument: Instrument;
} {
  const text = `${study.title} ${study.abstract}`;

  const domains: Record<string, DomainResult> = {
    "D1: Confounding": inferDomain(
      text,
      [
        "adjusted for",
        "propensity score",
        "multivariable",
        "multivariate",
        "controlled for",
        "adjusted analysis",
        "regression adjustment",
      ],
      ["unadjusted", "no adjustment for confounding", "crude analysis only"],
      "Low",
      "Serious",
    ),
    "D2: Selection": inferDomain(
      text,
      [
        "consecutive patients",
        "population-based",
        "all eligible",
        "prospective enrollment",
        "inception cohort",
      ],
      [
        "selection bias",
        "convenience sample",
        "volunteer bias",
        "selected population",
      ],
      "Low",
      "Serious",
    ),
    "D3: Classification": inferDomain(
      text,
      [
        "clearly defined",
        "objective criteria",
        "validated definition",
        "icd codes",
        "standardized criteria",
      ],
      ["misclassification", "unclear definition", "subjective classification"],
      "Low",
      "Serious",
    ),
    "D4: Deviations": inferDomain(
      text,
      ["adherence monitored", "compliance assessed", "as-treated analysis"],
      ["substantial crossover", "contamination", "protocol deviation"],
      "Low",
      "Moderate",
    ),
    "D5: Missing data": inferDomain(
      text,
      [
        "complete data",
        "no missing",
        "multiple imputation",
        "complete case analysis justified",
      ],
      [
        "substantial missing data",
        "high proportion missing",
        "incomplete follow-up",
        "high attrition",
      ],
      "Low",
      "Serious",
    ),
    "D6: Measurement": inferDomain(
      text,
      [
        "validated instrument",
        "objective measure",
        "medical records",
        "electronic health records",
        "blinded outcome assessment",
      ],
      ["self-reported", "recall bias", "subjective measure", "unvalidated"],
      "Low",
      "Serious",
    ),
    "D7: Reporting": inferDomain(
      text,
      [
        "registered",
        "protocol available",
        "pre-specified analysis",
        "prospero",
      ],
      ["post-hoc", "unplanned exploratory", "outcome switching suspected"],
      "Low",
      "Serious",
    ),
  };

  const judgments = Object.values(domains).map((d) => d.judgment);
  const hasCritical = judgments.some((j) => j === "Critical");
  const hasSerious = judgments.some((j) => j === "Serious");
  const hasModerate = judgments.some((j) => j === "Moderate");

  let overall: string;
  if (hasCritical) overall = "Critical";
  else if (hasSerious) overall = "Serious";
  else if (hasModerate) overall = "Moderate";
  else overall = "Low";

  return { domains, overall, instrument: "robins_i" };
}

// ── AMSTAR-2 (systematic reviews) ─────────────────────────────────────────────

function assessAmstar2(study: z.infer<typeof StudyInputSchema>): {
  domains: Record<string, DomainResult>;
  overall: string;
  instrument: Instrument;
} {
  const text = `${study.title} ${study.abstract}`;

  const domains: Record<string, DomainResult> = {
    "Item 1: PICO pre-specified": inferDomain(
      text,
      ["protocol", "prospero", "pre-specified", "registered", "pico"],
      ["no protocol", "unregistered review"],
      "Yes",
      "No",
    ),
    "Item 2: Comprehensive search": inferDomain(
      text,
      [
        "multiple databases",
        "pubmed",
        "medline",
        "embase",
        "cochrane",
        "grey literature",
        "hand search",
        "systematic search",
      ],
      ["single database", "limited search"],
      "Yes",
      "No",
    ),
    "Item 7: RoB in primary studies": inferDomain(
      text,
      [
        "risk of bias",
        "quality assessment",
        "rob",
        "cochrane tool",
        "newcastle-ottawa",
        "study quality",
      ],
      ["no quality assessment", "quality not assessed"],
      "Yes",
      "No",
    ),
    "Item 11: Meta-analysis methods": inferDomain(
      text,
      [
        "heterogeneity",
        "i²",
        "i2",
        "random effects",
        "fixed effects",
        "pooled",
        "forest plot",
      ],
      ["inappropriate pooling", "ignored heterogeneity"],
      "Yes",
      "No",
    ),
    "Item 13: Publication bias": inferDomain(
      text,
      [
        "funnel plot",
        "egger",
        "begg",
        "publication bias",
        "small study effects",
      ],
      ["publication bias not assessed", "no funnel plot"],
      "Yes",
      "No",
    ),
    "Item 16: Funding/COI": inferDomain(
      text,
      ["funding", "conflict of interest", "coi", "sponsor", "no conflict"],
      ["funding not reported", "coi not disclosed"],
      "Yes",
      "No",
    ),
  };

  const judgments = Object.values(domains).map((d) => d.judgment);
  const yesCount = judgments.reduce((sum, j) => {
    if (j === "Yes") return sum + 1;
    if (j === "Probably Yes") return sum + 0.5;
    return sum;
  }, 0);
  const total = judgments.length;

  let overall: string;
  if (yesCount === total) overall = "High";
  else if (yesCount >= total * 0.7) overall = "Moderate";
  else if (yesCount >= total * 0.4) overall = "Low";
  else overall = "Critically Low";

  return { domains, overall, instrument: "amstar2" };
}

// ── Overall badge ─────────────────────────────────────────────────────────────

function overallBadge(overall: string, instrument: Instrument): string {
  if (instrument === "rob2") {
    if (overall === "Low") return "✅ Low";
    if (overall === "Some concerns") return "⚠️ Some concerns";
    return "❌ High";
  }
  if (instrument === "robins_i") {
    if (overall === "Low") return "✅ Low";
    if (overall === "Moderate") return "🟡 Moderate";
    if (overall === "Serious") return "⚠️ Serious";
    return "❌ Critical";
  }
  // amstar2
  if (overall === "High") return "✅ High";
  if (overall === "Moderate") return "🟡 Moderate";
  if (overall === "Low") return "⚠️ Low";
  return "❌ Critically Low";
}

// ── GRADE RoB summary ─────────────────────────────────────────────────────────

function buildGradeSummary(
  assessments: Array<{ overall: string; instrument: Instrument }>,
): {
  rob_judgment: string;
  downgrade: boolean;
  rationale: string;
  overall_certainty_start: "High" | "Low";
} {
  const rctCount = assessments.filter((a) => a.instrument === "rob2").length;
  const obsCount = assessments.filter(
    (a) => a.instrument === "robins_i",
  ).length;
  // amstar2-only → inherit from the reviews' included studies (unknown here) → conservative Low
  const overall_certainty_start: "High" | "Low" = rctCount > 0 ? "High" : "Low";

  const rob2Overalls = assessments
    .filter((a) => a.instrument === "rob2")
    .map((a) => a.overall);
  const robinsOveralls = assessments
    .filter((a) => a.instrument === "robins_i")
    .map((a) => a.overall);

  const hasHighRob = rob2Overalls.some((o) => o === "High");
  const hasSomeConcerns = rob2Overalls.some((o) => o === "Some concerns");
  const hasSeriousRobins = robinsOveralls.some(
    (o) => o === "Serious" || o === "Critical",
  );

  let rob_judgment: string;
  let downgrade: boolean;
  let rationale: string;

  if (hasHighRob || hasSeriousRobins) {
    rob_judgment = "High";
    downgrade = true;
    rationale = "One or more studies rated High/Serious risk of bias";
  } else if (hasSomeConcerns) {
    rob_judgment = "Some concerns";
    downgrade = false;
    rationale = "Some studies have concerns but no serious flaws detected";
  } else {
    rob_judgment = "Probably Low";
    downgrade = false;
    rationale =
      "Majority of evidence from studies with low or probably low risk of bias";
  }

  return { rob_judgment, downgrade, rationale, overall_certainty_start };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleRiskOfBias(
  rawParams: unknown,
): Promise<ToolResult> {
  const params = RiskOfBiasSchema.parse(rawParams);
  const outputFormat = params.output_format ?? "text";

  let audit = createAuditRecord(
    "evidence.risk_of_bias",
    {
      n_studies: params.studies.length,
      instrument: params.instrument,
    } as unknown as Record<string, unknown>,
    outputFormat,
  );
  audit = setMethodology(
    audit,
    "Cochrane RoB 2 (RCTs), ROBINS-I (observational), AMSTAR-2 (systematic reviews). Domain judgments inferred from abstract text; domains without reporting signals marked Unclear.",
  );
  audit = addAssumption(
    audit,
    "Abstract-based inference: allocation concealment, blinding, and registration details are often not reported in abstracts — expect Unclear in some domains. Full-text review recommended for high-stakes assessments.",
  );

  // Assess each study
  const studyAssessments: Array<{
    id: string;
    title: string;
    url: string;
    date: string;
    instrument: Instrument;
    instrument_assumed: boolean;
    domains: Record<string, DomainResult>;
    overall: string;
  }> = [];

  // Render a study title — wrap in markdown link when url is non-empty,
  // otherwise return plain text. Prevents broken `[title]()` links when
  // the optional url field is missing (the StudyInputSchema relax allows
  // this).
  function formatStudyTitle(title: string, url: string): string {
    const truncated = title.slice(0, 55) + (title.length > 55 ? "..." : "");
    return url ? `[${truncated}](${url})` : truncated;
  }

  for (const study of params.studies) {
    const chosen =
      params.instrument === "auto"
        ? detectInstrument(study.study_type, study.title, study.abstract)
        : (params.instrument as Instrument);
    const assumed = params.instrument === "auto";

    let result: {
      domains: Record<string, DomainResult>;
      overall: string;
      instrument: Instrument;
    };
    if (chosen === "rob2") result = assessRob2(study);
    else if (chosen === "robins_i") result = assessRobinsI(study);
    else result = assessAmstar2(study);

    studyAssessments.push({
      id: study.id ?? `study-${studyAssessments.length + 1}`,
      title: study.title,
      url: study.url ?? "",
      date: study.date ?? "",
      instrument: chosen,
      instrument_assumed: assumed,
      domains: result.domains,
      overall: result.overall,
    });
  }

  const gradeSummary = buildGradeSummary(studyAssessments);

  // rob_results structured object — passed to hta_dossier_prep
  const rob_results = {
    studies: studyAssessments.map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      date: s.date,
      instrument: s.instrument,
      instrument_assumed: s.instrument_assumed,
      domains: s.domains,
      overall: s.overall,
    })),
    summary: {
      n_assessed: studyAssessments.length,
      rob2_count: studyAssessments.filter((s) => s.instrument === "rob2")
        .length,
      robins_i_count: studyAssessments.filter(
        (s) => s.instrument === "robins_i",
      ).length,
      amstar2_count: studyAssessments.filter((s) => s.instrument === "amstar2")
        .length,
      rob_judgment: gradeSummary.rob_judgment,
      downgrade: gradeSummary.downgrade,
      rationale: gradeSummary.rationale,
    },
    overall_certainty_start: gradeSummary.overall_certainty_start,
  };

  if (outputFormat === "json") {
    return { content: rob_results, audit };
  }

  // ── Markdown output ───────────────────────────────────────────────────────

  const rob2Studies = studyAssessments.filter((s) => s.instrument === "rob2");
  const robinsStudies = studyAssessments.filter(
    (s) => s.instrument === "robins_i",
  );
  const amstarStudies = studyAssessments.filter(
    (s) => s.instrument === "amstar2",
  );

  const instrumentSummary = [
    rob2Studies.length > 0 ? `RoB 2 (RCT): ${rob2Studies.length}` : null,
    robinsStudies.length > 0
      ? `ROBINS-I (observational): ${robinsStudies.length}`
      : null,
    amstarStudies.length > 0
      ? `AMSTAR-2 (SR/MA): ${amstarStudies.length}`
      : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const lines: string[] = [
    `## Risk of Bias Assessment`,
    ``,
    `**Studies assessed:** ${studyAssessments.length} (${instrumentSummary})`,
    ``,
  ];

  // RoB 2 table
  if (rob2Studies.length > 0) {
    lines.push(`### RoB 2 — Randomized Controlled Trials`);
    const domainKeys = Object.keys(rob2Studies[0].domains);
    lines.push(`| Study | ${domainKeys.join(" | ")} | Overall |`);
    lines.push(`|---|${domainKeys.map(() => "---").join("|")}|---|`);
    for (const s of rob2Studies) {
      const titleLink = formatStudyTitle(s.title, s.url);
      const domainCells = domainKeys
        .map((k) => s.domains[k].judgment)
        .join(" | ");
      lines.push(
        `| ${titleLink} | ${domainCells} | ${overallBadge(s.overall, "rob2")} |`,
      );
    }
    lines.push(``);

    // Uncertainty notes
    const uncertainStudies = rob2Studies.filter((s) =>
      Object.values(s.domains).some((d) => d.uncertainty_note),
    );
    if (uncertainStudies.length > 0) {
      lines.push(
        `**Unclear domains** (abstract lacked methodological detail — full-text review recommended):`,
      );
      for (const s of uncertainStudies) {
        const unclearDomains = Object.entries(s.domains)
          .filter(([, d]) => d.uncertainty_note)
          .map(([k]) => k);
        lines.push(`- ${s.title.slice(0, 60)}: ${unclearDomains.join(", ")}`);
      }
      lines.push(``);
    }
  }

  // ROBINS-I table
  if (robinsStudies.length > 0) {
    lines.push(`### ROBINS-I — Observational Studies`);
    const domainKeys = Object.keys(robinsStudies[0].domains);
    lines.push(`| Study | ${domainKeys.join(" | ")} | Overall |`);
    lines.push(`|---|${domainKeys.map(() => "---").join("|")}|---|`);
    for (const s of robinsStudies) {
      const titleLink = formatStudyTitle(s.title, s.url);
      const domainCells = domainKeys
        .map((k) => s.domains[k].judgment)
        .join(" | ");
      lines.push(
        `| ${titleLink} | ${domainCells} | ${overallBadge(s.overall, "robins_i")} |`,
      );
    }
    lines.push(``);
  }

  // AMSTAR-2 table
  if (amstarStudies.length > 0) {
    lines.push(`### AMSTAR-2 — Systematic Reviews / Meta-Analyses`);
    const domainKeys = Object.keys(amstarStudies[0].domains);
    lines.push(`| Review | ${domainKeys.join(" | ")} | Confidence |`);
    lines.push(`|---|${domainKeys.map(() => "---").join("|")}|---|`);
    for (const s of amstarStudies) {
      const titleLink = formatStudyTitle(s.title, s.url);
      const domainCells = domainKeys
        .map((k) => s.domains[k].judgment)
        .join(" | ");
      lines.push(
        `| ${titleLink} | ${domainCells} | ${overallBadge(s.overall, "amstar2")} |`,
      );
    }
    lines.push(``);
  }

  // GRADE RoB summary
  lines.push(`### GRADE Risk of Bias Domain`);
  lines.push(`| Aspect | Assessment |`);
  lines.push(`|---|---|`);
  lines.push(`| RoB judgment | **${gradeSummary.rob_judgment}** |`);
  lines.push(
    `| Downgrade GRADE certainty? | ${gradeSummary.downgrade ? "**Yes (−1)** " : "No"} |`,
  );
  lines.push(`| Rationale | ${gradeSummary.rationale} |`);
  lines.push(
    `| Evidence base starts at | ${gradeSummary.overall_certainty_start} (before other GRADE domains) |`,
  );
  lines.push(``);

  if (gradeSummary.downgrade) {
    audit = addWarning(
      audit,
      "RoB domain triggers GRADE downgrade — overall certainty reduced by 1 level",
    );
  }

  lines.push(
    `> **Pass \`rob_results\` to \`hta_dossier_prep\`** to use this assessment in the GRADE table instead of the heuristic fallback.`,
  );
  lines.push(``);
  lines.push(auditToMarkdown(audit));

  return { content: lines.join("\n"), audit };
}

export const riskOfBiasToolSchema = {
  name: "evidence.risk_of_bias",
  description:
    "Assess risk of bias for a set of studies using the appropriate Cochrane instrument: RoB 2 (RCTs), ROBINS-I (observational studies), or AMSTAR-2 (systematic reviews/meta-analyses). Instrument is auto-detected from study_type or can be specified. Judgments are inferred from abstract text — domains without sufficient reporting are marked Unclear. Returns a per-study table and a rob_results object to pass to hta_dossier_prep for evidence-based GRADE assessment.",
  annotations: {
    title: "Risk of Bias Assessment",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      studies: {
        type: "array",
        description:
          "Array of study objects from screen_abstracts or literature_search (output_format='json')",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            source: { type: "string" },
            title: { type: "string" },
            authors: { type: "array", items: { type: "string" } },
            date: { type: "string" },
            study_type: { type: "string" },
            abstract: { type: "string" },
            url: { type: "string" },
          },
          // Only title + abstract are needed for RoB inference. The rest
          // are display-only — see Zod StudyInputSchema at the top of this
          // file. Keep the JSON Schema and Zod in lock-step so clients
          // reading the advertised schema (Claude / ChatGPT / agents) see
          // the same constraints Zod actually enforces.
          required: ["title", "abstract"],
        },
      },
      instrument: {
        type: "string",
        enum: ["auto", "rob2", "robins_i", "amstar2"],
        description:
          "Assessment instrument. auto (default) detects from study_type. rob2 for RCTs, robins_i for observational, amstar2 for systematic reviews.",
      },
      outcomes: {
        type: "array",
        items: { type: "string" },
        description:
          "Outcomes of interest for contextual domain assessment (optional)",
      },
      output_format: { type: "string", enum: ["text", "json"] },
    },
    required: ["studies"],
  },
};
