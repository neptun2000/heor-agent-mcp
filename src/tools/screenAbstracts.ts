import { z } from "zod";
import type { ToolResult, LiteratureResult } from "../providers/types.js";
import {
  createAuditRecord,
  addAssumption,
  addWarning,
  setMethodology,
} from "../audit/builder.js";
import { auditToMarkdown } from "../formatters/markdown.js";

/**
 * Abstract Screening Tool
 *
 * Applies PICO-based inclusion/exclusion criteria to literature search
 * results. Scores each abstract by relevance, classifies study design,
 * and returns a ranked shortlist with reasons for inclusion/exclusion.
 *
 * Follows Cochrane Handbook Chapter 4 screening methodology.
 */

const PICOCriteriaSchema = z.object({
  population: z.string().min(1).describe("Target population (e.g., 'adults with type 2 diabetes')"),
  intervention: z.string().min(1).describe("Intervention of interest (e.g., 'semaglutide')"),
  comparator: z.string().optional().describe("Comparator (e.g., 'placebo', 'sitagliptin')"),
  outcomes: z.array(z.string()).optional().describe("Outcomes of interest (e.g., ['HbA1c', 'weight', 'cardiovascular events'])"),
});

const ScreenAbstractsSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      title: z.string(),
      authors: z.array(z.string()),
      date: z.string(),
      study_type: z.string(),
      abstract: z.string(),
      url: z.string(),
    }),
  ).min(1, "At least 1 result required"),
  criteria: PICOCriteriaSchema,
  exclude_study_types: z
    .array(z.string())
    .optional()
    .describe("Study types to exclude (e.g., ['case_report', 'editorial', 'letter', 'commentary'])"),
  min_year: z.number().optional().describe("Exclude studies before this year"),
  include_threshold: z
    .number()
    .min(0)
    .max(1)
    .default(0.3)
    .describe("Relevance score threshold for inclusion (0-1, default 0.3)"),
  output_format: z.enum(["text", "json"]).optional(),
  project: z.string().optional(),
});

// Study design hierarchy (higher = stronger evidence)
const STUDY_DESIGN_SCORES: Record<string, number> = {
  systematic_review: 5,
  meta_analysis: 5,
  meta: 5,
  rct: 4,
  randomized: 4,
  randomised: 4,
  controlled_trial: 4,
  cohort: 3,
  observational: 3,
  prospective: 3,
  retrospective: 2,
  case_control: 2,
  cross_sectional: 2,
  case_series: 1,
  case_report: 1,
  editorial: 0,
  letter: 0,
  commentary: 0,
  opinion: 0,
  narrative_review: 1,
  review: 2,
  guideline: 3,
  hta_report: 4,
  clinical_trial: 4,
};

const EXCLUDE_TYPES = new Set([
  "editorial", "letter", "commentary", "opinion", "erratum", "corrigendum",
  "news", "interview", "book_review",
]);

interface ScreeningResult {
  id: string;
  title: string;
  source: string;
  authors: string[];
  date: string;
  url: string;
  study_type: string;
  study_design_class: string;
  relevance_score: number;
  decision: "include" | "exclude" | "uncertain";
  reasons: string[];
  pico_match: {
    population: boolean;
    intervention: boolean;
    comparator: boolean;
    outcomes: boolean;
  };
}

function classifyStudyDesign(studyType: string, title: string, abstract: string): string {
  const combined = `${studyType} ${title} ${abstract}`.toLowerCase();

  if (combined.includes("systematic review") || combined.includes("meta-analysis") || combined.includes("meta analysis"))
    return "Systematic Review / Meta-Analysis";
  if (combined.includes("randomized") || combined.includes("randomised") || combined.includes("rct") || combined.includes("phase iii") || combined.includes("phase 3"))
    return "RCT";
  if (combined.includes("phase ii") || combined.includes("phase 2") || combined.includes("phase i") || combined.includes("phase 1"))
    return "Clinical Trial (Phase I/II)";
  if (combined.includes("clinical trial") || combined.includes("controlled trial"))
    return "Clinical Trial";
  if (combined.includes("cohort") || combined.includes("prospective") || combined.includes("longitudinal"))
    return "Cohort Study";
  if (combined.includes("retrospective") || combined.includes("database") || combined.includes("claims") || combined.includes("real-world") || combined.includes("registry"))
    return "Retrospective / RWE";
  if (combined.includes("case-control") || combined.includes("case control"))
    return "Case-Control";
  if (combined.includes("cross-sectional") || combined.includes("survey"))
    return "Cross-Sectional";
  if (combined.includes("cost-effectiveness") || combined.includes("cost effectiveness") || combined.includes("economic") || combined.includes("budget impact") || combined.includes("icer") || combined.includes("qaly"))
    return "Health Economic Study";
  if (combined.includes("guideline") || combined.includes("recommendation") || combined.includes("consensus"))
    return "Guideline / Consensus";
  if (combined.includes("hta") || combined.includes("appraisal") || combined.includes("reimbursement") || combined.includes("technology assessment"))
    return "HTA Report";
  if (combined.includes("review") || combined.includes("overview"))
    return "Narrative Review";
  if (combined.includes("editorial") || combined.includes("commentary") || combined.includes("letter") || combined.includes("opinion"))
    return "Editorial / Commentary";
  if (combined.includes("case report") || combined.includes("case series"))
    return "Case Report / Series";

  return "Other";
}

function getDesignScore(designClass: string): number {
  if (designClass.includes("Systematic") || designClass.includes("Meta")) return 5;
  if (designClass.includes("RCT")) return 4;
  if (designClass.includes("Clinical Trial")) return 4;
  if (designClass.includes("HTA")) return 4;
  if (designClass.includes("Cohort")) return 3;
  if (designClass.includes("Guideline")) return 3;
  if (designClass.includes("Health Economic")) return 3;
  if (designClass.includes("Retrospective")) return 2;
  if (designClass.includes("Case-Control")) return 2;
  if (designClass.includes("Cross-Sectional")) return 2;
  if (designClass.includes("Narrative")) return 1;
  if (designClass.includes("Editorial")) return 0;
  if (designClass.includes("Case Report")) return 1;
  return 1;
}

function computeRelevanceScore(
  result: LiteratureResult,
  criteria: z.infer<typeof PICOCriteriaSchema>,
): { score: number; match: ScreeningResult["pico_match"]; reasons: string[] } {
  const text = `${result.title} ${result.abstract}`.toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  const maxScore = 4; // P + I + C + O

  // Population match
  const popTerms = criteria.population.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
  const popMatches = popTerms.filter((t) => text.includes(t));
  const popMatch = popMatches.length / Math.max(1, popTerms.length) >= 0.3;
  if (popMatch) {
    score += 1;
    reasons.push(`Population match: ${popMatches.join(", ")}`);
  }

  // Intervention match
  const intTerms = criteria.intervention.toLowerCase().split(/[\s,]+/).filter((t) => t.length > 2);
  const intMatches = intTerms.filter((t) => text.includes(t));
  const intMatch = intMatches.length > 0;
  if (intMatch) {
    score += 1;
    reasons.push(`Intervention match: ${intMatches.join(", ")}`);
  }

  // Comparator match
  let compMatch = false;
  if (criteria.comparator) {
    const compTerms = criteria.comparator.toLowerCase().split(/[\s,]+/).filter((t) => t.length > 2);
    const compMatches = compTerms.filter((t) => text.includes(t));
    compMatch = compMatches.length > 0;
    if (compMatch) {
      score += 1;
      reasons.push(`Comparator match: ${compMatches.join(", ")}`);
    }
  } else {
    score += 0.5; // No comparator specified — partial credit
    compMatch = true;
  }

  // Outcomes match
  let outMatch = false;
  if (criteria.outcomes && criteria.outcomes.length > 0) {
    const outMatches = criteria.outcomes.filter((o) =>
      text.includes(o.toLowerCase()),
    );
    outMatch = outMatches.length > 0;
    if (outMatch) {
      score += 1;
      reasons.push(`Outcome match: ${outMatches.join(", ")}`);
    }
  } else {
    score += 0.5;
    outMatch = true;
  }

  // Bonus for study design quality
  const designClass = classifyStudyDesign(result.study_type, result.title, result.abstract);
  const designScore = getDesignScore(designClass);
  score += designScore * 0.1; // Small bonus, max 0.5

  const normalizedScore = Math.min(1, score / maxScore);

  return {
    score: Math.round(normalizedScore * 100) / 100,
    match: {
      population: popMatch,
      intervention: intMatch,
      comparator: compMatch,
      outcomes: outMatch,
    },
    reasons,
  };
}

export async function handleScreenAbstracts(
  rawParams: unknown,
): Promise<ToolResult> {
  const params = ScreenAbstractsSchema.parse(rawParams);
  const outputFormat = params.output_format ?? "text";
  const threshold = params.include_threshold;

  let audit = createAuditRecord(
    "screen_abstracts",
    { n_input: params.results.length, criteria: params.criteria } as unknown as Record<string, unknown>,
    outputFormat,
  );
  audit = setMethodology(
    audit,
    "PICO-based abstract screening with relevance scoring. Study design classification per Cochrane Handbook Ch. 4.",
  );
  audit = addAssumption(
    audit,
    `Inclusion threshold: ${threshold} (scores below this are excluded)`,
  );
  audit = addAssumption(
    audit,
    `PICO: P=${params.criteria.population}, I=${params.criteria.intervention}, C=${params.criteria.comparator ?? "any"}, O=${params.criteria.outcomes?.join(", ") ?? "any"}`,
  );

  const excludeTypes = new Set(
    (params.exclude_study_types ?? []).map((t) => t.toLowerCase()),
  );
  for (const t of EXCLUDE_TYPES) excludeTypes.add(t);

  const screeningResults: ScreeningResult[] = [];

  for (const result of params.results as LiteratureResult[]) {
    const designClass = classifyStudyDesign(
      result.study_type,
      result.title,
      result.abstract,
    );

    // Year filter
    if (params.min_year) {
      const year = parseInt(result.date?.slice(0, 4) ?? "0", 10);
      if (year > 0 && year < params.min_year) {
        screeningResults.push({
          id: result.id,
          title: result.title,
          source: result.source,
          authors: result.authors,
          date: result.date,
          url: result.url,
          study_type: result.study_type,
          study_design_class: designClass,
          relevance_score: 0,
          decision: "exclude",
          reasons: [`Published ${year}, before minimum year ${params.min_year}`],
          pico_match: { population: false, intervention: false, comparator: false, outcomes: false },
        });
        continue;
      }
    }

    // Excluded study types
    const typeKey = result.study_type?.toLowerCase().replace(/[\s-]/g, "_") ?? "";
    if (excludeTypes.has(typeKey) || designClass === "Editorial / Commentary") {
      screeningResults.push({
        id: result.id,
        title: result.title,
        source: result.source,
        authors: result.authors,
        date: result.date,
        url: result.url,
        study_type: result.study_type,
        study_design_class: designClass,
        relevance_score: 0,
        decision: "exclude",
        reasons: [`Study type excluded: ${designClass}`],
        pico_match: { population: false, intervention: false, comparator: false, outcomes: false },
      });
      continue;
    }

    // PICO relevance scoring
    const { score, match, reasons } = computeRelevanceScore(
      result,
      params.criteria,
    );

    let decision: "include" | "exclude" | "uncertain";
    if (score >= threshold + 0.2) {
      decision = "include";
    } else if (score >= threshold) {
      decision = "uncertain";
    } else {
      decision = "exclude";
      reasons.push(`Relevance score ${score.toFixed(2)} below threshold ${threshold}`);
    }

    screeningResults.push({
      id: result.id,
      title: result.title,
      source: result.source,
      authors: result.authors,
      date: result.date,
      url: result.url,
      study_type: result.study_type,
      study_design_class: designClass,
      relevance_score: score,
      decision,
      reasons,
      pico_match: match,
    });
  }

  // Sort: include first, then uncertain, then exclude. Within each: by relevance score descending
  const order = { include: 0, uncertain: 1, exclude: 2 };
  screeningResults.sort(
    (a, b) =>
      order[a.decision] - order[b.decision] ||
      b.relevance_score - a.relevance_score,
  );

  const included = screeningResults.filter((r) => r.decision === "include");
  const uncertain = screeningResults.filter((r) => r.decision === "uncertain");
  const excluded = screeningResults.filter((r) => r.decision === "exclude");

  audit = addAssumption(
    audit,
    `Screening result: ${included.length} included, ${uncertain.length} uncertain, ${excluded.length} excluded (from ${params.results.length} input)`,
  );

  if (included.length === 0 && uncertain.length === 0) {
    audit = addWarning(
      audit,
      "No studies met inclusion criteria — consider broadening PICO or lowering threshold",
    );
  }

  if (outputFormat === "json") {
    return {
      content: {
        summary: {
          total_input: params.results.length,
          included: included.length,
          uncertain: uncertain.length,
          excluded: excluded.length,
        },
        criteria: params.criteria,
        results: screeningResults,
      },
      audit,
    };
  }

  // Text output — PRISMA-style flow + ranked table
  const picoStr = [
    `**P:** ${params.criteria.population}`,
    `**I:** ${params.criteria.intervention}`,
    params.criteria.comparator ? `**C:** ${params.criteria.comparator}` : null,
    params.criteria.outcomes ? `**O:** ${params.criteria.outcomes.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const lines: string[] = [
    `## Abstract Screening Report`,
    ``,
    `### PICO Criteria`,
    picoStr,
    ``,
    `### PRISMA Screening Flow`,
    `- **Records identified:** ${params.results.length}`,
    `- **Records excluded (study type/date):** ${excluded.filter((r) => r.relevance_score === 0).length}`,
    `- **Records screened by PICO:** ${params.results.length - excluded.filter((r) => r.relevance_score === 0).length}`,
    `- **Included:** ${included.length}`,
    `- **Uncertain (manual review recommended):** ${uncertain.length}`,
    `- **Excluded (low relevance):** ${excluded.filter((r) => r.relevance_score > 0).length}`,
    ``,
  ];

  if (included.length > 0) {
    lines.push(`### Included Studies (${included.length})`);
    lines.push(`| # | Study | Design | Score | P | I | C | O | Source |`);
    lines.push(`|---|-------|--------|-------|---|---|---|---|--------|`);
    included.forEach((r, i) => {
      const p = r.pico_match.population ? "+" : "-";
      const int = r.pico_match.intervention ? "+" : "-";
      const c = r.pico_match.comparator ? "+" : "-";
      const o = r.pico_match.outcomes ? "+" : "-";
      const titleLink = `[${r.title.slice(0, 60)}${r.title.length > 60 ? "..." : ""}](${r.url})`;
      lines.push(
        `| ${i + 1} | ${titleLink} | ${r.study_design_class} | ${r.relevance_score.toFixed(2)} | ${p} | ${int} | ${c} | ${o} | ${r.source} |`,
      );
    });
    lines.push(``);
  }

  if (uncertain.length > 0) {
    lines.push(`### Uncertain — Manual Review Recommended (${uncertain.length})`);
    lines.push(`| # | Study | Design | Score | Reason |`);
    lines.push(`|---|-------|--------|-------|--------|`);
    uncertain.forEach((r, i) => {
      const titleLink = `[${r.title.slice(0, 60)}${r.title.length > 60 ? "..." : ""}](${r.url})`;
      lines.push(
        `| ${i + 1} | ${titleLink} | ${r.study_design_class} | ${r.relevance_score.toFixed(2)} | ${r.reasons.join("; ")} |`,
      );
    });
    lines.push(``);
  }

  if (excluded.length > 0) {
    lines.push(
      `### Excluded (${excluded.length})`,
    );
    lines.push(`<details><summary>Click to expand excluded studies</summary>\n`);
    lines.push(`| Study | Reason |`);
    lines.push(`|-------|--------|`);
    excluded.forEach((r) => {
      lines.push(`| ${r.title.slice(0, 70)} | ${r.reasons[0] ?? "Low relevance"} |`);
    });
    lines.push(`\n</details>\n`);
  }

  lines.push(`---`);
  lines.push(
    `> **Note:** This is automated screening based on keyword matching against PICO criteria. It supplements but does not replace manual screening by a qualified reviewer. Per Cochrane Handbook, at least two independent reviewers should screen abstracts for systematic reviews.`,
  );
  lines.push(``);
  lines.push(auditToMarkdown(audit));

  return { content: lines.join("\n"), audit };
}

export const screenAbstractsToolSchema = {
  name: "screen_abstracts",
  description:
    "Screen literature search results using PICO criteria. Scores each abstract by relevance to the research question, classifies study design, and returns a ranked shortlist with inclusion/exclusion decisions and reasons. Pass the results array from a prior literature_search call (use output_format='json'). Follows Cochrane Handbook Chapter 4 screening methodology.",
  inputSchema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        description:
          "Array of LiteratureResult objects from a prior literature_search call (use output_format='json')",
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
          required: ["id", "source", "title", "authors", "date", "study_type", "abstract", "url"],
        },
      },
      criteria: {
        type: "object",
        description: "PICO inclusion criteria",
        properties: {
          population: {
            type: "string",
            description: "Target population (e.g., 'adults with type 2 diabetes')",
          },
          intervention: {
            type: "string",
            description: "Intervention of interest (e.g., 'semaglutide')",
          },
          comparator: {
            type: "string",
            description: "Comparator (e.g., 'placebo', 'sitagliptin'). Optional.",
          },
          outcomes: {
            type: "array",
            items: { type: "string" },
            description: "Outcomes of interest (e.g., ['HbA1c', 'weight loss', 'MACE']). Optional.",
          },
        },
        required: ["population", "intervention"],
      },
      exclude_study_types: {
        type: "array",
        items: { type: "string" },
        description:
          "Additional study types to exclude (e.g., ['case_report', 'narrative_review']). Editorials/commentaries are always excluded.",
      },
      min_year: {
        type: "number",
        description: "Exclude studies published before this year",
      },
      include_threshold: {
        type: "number",
        description:
          "Relevance score threshold for inclusion (0-1, default 0.3). Lower = more inclusive.",
      },
      output_format: { type: "string", enum: ["text", "json"] },
      project: { type: "string", description: "Project ID for persistence" },
    },
    required: ["results", "criteria"],
  },
};
