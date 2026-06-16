// heor-agent-mcp/src/tools/htaReviewSimulation.ts
/**
 * hta.review_simulation — predict the clarification questions an HTA body
 * (NICE EAG, G-BA/IQWiG) will ask about a dossier. Fully deterministic:
 * a gap/risk scan over the dossier drives per-(category × body) question
 * templates. No live LLM call (the calling chat model presents the output).
 * Questions are labelled "anticipated"; precedent links are whitelist-only
 * (verified niceTaPrecedents.ts) and never claim a question was historically
 * asked. Design log #38.
 */
import { z } from "zod";
import {
  TAXONOMY,
  TAXONOMY_REVISION,
  CATEGORY_ORDER,
  BODY_LABEL,
  fill,
  type CategoryKey,
  type ReviewBody,
  type Severity,
} from "../review/clarificationTaxonomy.js";
import { scanDossier, type ScanInput } from "../review/dossierScan.js";
import { renderReviewSimulation } from "../formatters/reviewMarkdown.js";
import { findPrecedents } from "../data/niceTaPrecedents.js";
import { createAuditRecord } from "../audit/builder.js";
import {
  buildDisclosure,
  extractDisclosureLevel,
  AI_DISCLOSURE_LEVEL_SCHEMA_PROPERTY,
} from "../formatters/disclosure.js";

export const htaReviewSimulationSchema = z.object({
  hta_body: z.enum(["nice", "gba_iqwig"]).default("nice"),
  drug: z.string().min(1),
  indication: z.string().min(1),
  dossier_markdown: z.string().optional(),
  dossier_sections: z
    .object({
      clinical: z.string().optional(),
      economic: z.string().optional(),
      itc: z.string().optional(),
    })
    .partial()
    .optional(),
  pico: z
    .object({
      population: z.string().optional(),
      intervention: z.string().optional(),
      comparator: z.string().optional(),
      outcomes: z.string().optional(),
    })
    .optional(),
  model_results: z.record(z.string(), z.unknown()).optional(),
  max_questions: z.number().int().positive().default(15),
  ai_disclosure_level: z.enum(["off", "standard", "submission"]).optional(),
});

export type HtaReviewSimulationInput = z.input<
  typeof htaReviewSimulationSchema
>;
export type HtaReviewSimulationParams = z.infer<
  typeof htaReviewSimulationSchema
>;

export interface ReviewQuestion {
  category: CategoryKey;
  category_label: string;
  question: string;
  rationale: string;
  severity: Severity;
  what_they_look_for: string;
  suggested_response: string;
  locator: string;
  precedent?: { id: string; title: string; url: string };
}

export interface HtaReviewSimulationResult {
  schema_version: "1.0";
  hta_body: ReviewBody;
  drug: string;
  indication: string;
  taxonomy_revision: string;
  questions: ReviewQuestion[];
  summary: {
    critical: number;
    standard: number;
    minor: number;
    biggest_exposure: string;
  };
  markdown_section: string;
}

function buildScanText(params: HtaReviewSimulationParams): string {
  const parts: string[] = [];
  if (params.dossier_markdown) parts.push(params.dossier_markdown);
  if (params.dossier_sections) {
    for (const v of Object.values(params.dossier_sections)) {
      if (typeof v === "string") parts.push(v);
    }
  }
  return parts.join("\n").toLowerCase();
}

export async function htaReviewSimulationHandler(
  rawParams: HtaReviewSimulationInput,
): Promise<HtaReviewSimulationResult> {
  const params = htaReviewSimulationSchema.parse(rawParams);
  const body = params.hta_body;

  const scanInput: ScanInput = {
    hta_body: body,
    drug: params.drug,
    indication: params.indication,
    text: buildScanText(params),
    pico: params.pico,
    hasModel: params.model_results !== undefined,
  };

  const hits = scanDossier(scanInput);

  const baseVars = { drug: params.drug, indication: params.indication };
  const questions: ReviewQuestion[] = hits.map((hit) => {
    const entry = TAXONOMY[hit.key];
    const bt = entry.bodies[body];
    const vars = { ...baseVars, ...hit.vars };
    return {
      category: hit.key,
      category_label: entry.label,
      question: fill(bt.question, vars),
      rationale: fill(bt.rationale, vars),
      severity: hit.severity,
      what_they_look_for: fill(bt.what_they_look_for, vars),
      suggested_response: fill(bt.suggested_response, vars),
      locator: hit.locator,
    };
  });

  // Precedent attribution is whitelist-only and NICE-only: a comparator
  // question may carry a verified NICE TA precedent, never a fabricated one.
  if (body === "nice") {
    const precedents = findPrecedents(params.drug, params.indication);
    if (precedents.length > 0) {
      const top = precedents[0];
      const comparatorQ = questions.find((q) => q.category === "comparator");
      if (comparatorQ) {
        comparatorQ.precedent = {
          id: top.ta_number,
          title: top.title,
          url: top.url,
        };
      }
    }
  }

  // Rank critical → standard → minor, then by taxonomy order.
  const sevRank: Record<Severity, number> = {
    critical: 0,
    standard: 1,
    minor: 2,
  };
  questions.sort(
    (a, b) =>
      sevRank[a.severity] - sevRank[b.severity] ||
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
  );

  // Summary reflects EVERYTHING found (no silent truncation when capped).
  const summary = {
    critical: questions.filter((q) => q.severity === "critical").length,
    standard: questions.filter((q) => q.severity === "standard").length,
    minor: questions.filter((q) => q.severity === "minor").length,
    biggest_exposure:
      questions.length > 0 ? questions[0].category_label : "none identified",
  };

  const shown = questions.slice(0, params.max_questions);

  let markdown = renderReviewSimulation(
    {
      drug: params.drug,
      indication: params.indication,
      body_label: BODY_LABEL[body],
    },
    shown,
    { ...summary, total: questions.length, shown: shown.length },
  );

  const level = extractDisclosureLevel(rawParams, "submission");
  const audit = createAuditRecord(
    "hta.review_simulation",
    { hta_body: body, drug: params.drug, indication: params.indication },
    "markdown",
    "Deterministic clarification-question taxonomy scan (design log #38).",
  );
  const disclosure = buildDisclosure(audit, { level });
  if (disclosure) markdown = `${markdown}\n\n${disclosure}`;

  return {
    schema_version: "1.0",
    hta_body: body,
    drug: params.drug,
    indication: params.indication,
    taxonomy_revision: TAXONOMY_REVISION,
    questions: shown,
    summary,
    markdown_section: markdown,
  };
}

export const htaReviewSimulationToolSchema = {
  name: "hta.review_simulation",
  description:
    "Predict the clarification questions an HTA body will ask about a dossier, BEFORE submission. Consumes an hta.dossier / hta.workflow output (dossier_markdown), structured dossier_sections, or just {drug, indication, pico, model_results} for a pre-mortem. Runs a deterministic gap/risk scan over a 10-category taxonomy (comparator, indirect comparison, survival extrapolation, clinical risk-of-bias, economic-model structure, utilities, decision uncertainty, subgroups, real-world evidence, innovation/added-benefit) and returns ranked ANTICIPATED questions with rationale, severity (critical/standard/minor), what-the-committee-looks-for, and a suggested response. Precedent links are whitelist-only (verified NICE TA table) and never claim a question was historically asked. v1 bodies: NICE EAG and G-BA/IQWiG (FDA, HAS, EU JCA → v2). Fully deterministic; carries an ISPOR ELEVATE-GenAI disclosure block. Design log #38.",
  annotations: {
    title: "HTA Review Simulation",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    required: ["drug", "indication"],
    properties: {
      hta_body: {
        type: "string",
        enum: ["nice", "gba_iqwig"],
        default: "nice",
        description:
          "HTA body to simulate. 'nice' = NICE EAG clarification letter; 'gba_iqwig' = G-BA/IQWiG formal-assessment objections. FDA, HAS, EU JCA are v2.",
      },
      drug: { type: "string", description: "Generic drug name." },
      indication: { type: "string", description: "Indication / population." },
      dossier_markdown: {
        type: "string",
        description:
          "The dossier draft (e.g. piped from hta.dossier or hta.workflow output). The primary input — the scan reads this.",
      },
      dossier_sections: {
        type: "object",
        description:
          "Structured dossier text as an alternative/supplement to dossier_markdown.",
        properties: {
          clinical: { type: "string" },
          economic: { type: "string" },
          itc: { type: "string" },
        },
      },
      pico: {
        type: "object",
        description:
          "PICO. comparator drives the comparator and indirect-comparison detectors.",
        properties: {
          population: { type: "string" },
          intervention: { type: "string" },
          comparator: { type: "string" },
          outcomes: { type: "string" },
        },
      },
      model_results: {
        type: "object",
        description:
          "Economic-model results object (from cost_effectiveness_model) if no dossier_markdown is supplied — signals that a model exists.",
      },
      max_questions: {
        type: "number",
        default: 15,
        description:
          "Cap on returned questions (highest severity kept first). The summary still reports the full count.",
      },
      ai_disclosure_level: AI_DISCLOSURE_LEVEL_SCHEMA_PROPERTY,
    },
  },
};
