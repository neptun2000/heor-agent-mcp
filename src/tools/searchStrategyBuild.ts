import { z } from "zod";
import type { ToolResult } from "../providers/types.js";
import {
  createAuditRecord,
  setMethodology,
  addAssumption,
} from "../audit/builder.js";
import {
  buildDisclosure,
  extractDisclosureLevel,
  AI_DISCLOSURE_LEVEL_SCHEMA_PROPERTY,
} from "../formatters/disclosure.js";
import {
  getFilter,
  getStrandFilterForAssembly,
  getExclusionFilter,
  getAgeLimit,
} from "../data/searchFilters/index.js";
import { assembleStrategy } from "../search/strategyAssembler.js";
import { buildConceptBlock } from "../search/conceptBlock.js";
import { fetchPubmedLineCounts } from "../search/pubmedCounts.js";
import { formatStrategyMarkdown } from "../search/strategyFormatter.js";
import type { StrandId } from "../search/types.js";

const SearchStrategyBuildSchema = z.object({
  research_question: z.string().optional(),
  picos: z
    .object({
      population: z.string().optional(),
      condition: z.string().optional(),
      intervention: z.string().optional(),
      comparator: z.string().optional(),
      outcomes: z.array(z.string()).optional(),
    })
    .optional(),
  condition_terms: z.array(z.string()).min(1),
  intervention_terms: z.array(z.string()).optional(),
  strands: z
    .array(z.enum(["economic", "clinical", "hrqol", "epidemiology"]))
    .min(1),
  databases: z.array(z.enum(["embase", "pubmed"])).optional(),
  age_limit: z.enum(["pediatric", "adult", "elderly"]).optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  language: z.enum(["english"]).optional(),
  run_counts: z.boolean().default(true).optional(),
  ai_disclosure_level: z
    .enum(["off", "standard", "submission"])
    .default("submission")
    .optional(),
});

function yearLimit(from?: string, to?: string): string | undefined {
  const fromYear = from?.slice(0, 4);
  const toYear = to?.slice(0, 4) ?? String(new Date().getUTCFullYear());
  if (fromYear && toYear) return `[${fromYear}-${toYear}]/py`;
  if (fromYear) return `[${fromYear}-${toYear}]/py`;
  return undefined;
}

function pubmedDateLimit(from?: string, to?: string): string | undefined {
  const fromYear = from?.slice(0, 4);
  const toYear = to?.slice(0, 4) ?? String(new Date().getUTCFullYear());
  if (!fromYear) return undefined;
  return `${fromYear}:${toYear}[dp]`;
}

function pubmedLanguageLimit(language?: "english"): string | undefined {
  return language === "english" ? "english[lang]" : undefined;
}

export async function handleSearchStrategyBuild(
  args: unknown,
): Promise<ToolResult> {
  const disclosureLevel = extractDisclosureLevel(args, "submission");
  const params = SearchStrategyBuildSchema.parse(args);
  const concept = buildConceptBlock({
    conditionTerms: params.condition_terms,
    interventionTerms: params.intervention_terms,
  });
  const embaseDateLimit = yearLimit(params.date_from, params.date_to);
  const pubmedDate = pubmedDateLimit(params.date_from, params.date_to);
  const embaseLanguageLimit =
    params.language === "english" ? "[english]/lim" : undefined;
  const pubmedLanguage = pubmedLanguageLimit(params.language);

  let audit = createAuditRecord(
    "search.strategy_build",
    {
      strands: params.strands,
      n_condition_terms: params.condition_terms.length,
    } as unknown as Record<string, unknown>,
    "json",
  );
  audit = setMethodology(
    audit,
    "PRISMA-aligned multi-strand search-strategy generation. Methodological filters from SIGN templates; Embase Emtree DRAFT; PubMed counts via NCBI E-utilities.",
  );
  audit = addAssumption(
    audit,
    "Embase controlled-vocabulary (Emtree) terms are LLM-suggested DRAFT — verify in a licensed Embase session. Embase hit counts NOT computed.",
  );
  audit = addAssumption(
    audit,
    "PubMed/MEDLINE per-line counts are real (NCBI E-utilities) but may not match Embase yield (different corpora).",
  );

  const perStrand = [];
  let firstPubmedQuery = "";

  for (const strand of params.strands as StrandId[]) {
    const provenance = getFilter(strand, "pubmed").provenance;
    const signFilterLines = getFilter(strand, "pubmed").lines;
    const ageLineEmbase = params.age_limit
      ? getAgeLimit(params.age_limit, "embase").lines[0]
      : undefined;
    const ageLinePubmed = params.age_limit
      ? getAgeLimit(params.age_limit, "pubmed").lines[0]
      : undefined;

    const embase = assembleStrategy({
      conceptLines: concept.embaseLines,
      strandFilter: getStrandFilterForAssembly(strand, "embase"),
      exclusionLines: getExclusionFilter("embase").lines,
      ageLimit: ageLineEmbase,
      dateLimit: embaseDateLimit,
      languageLimit: embaseLanguageLimit,
    });

    const pubmed = assembleStrategy({
      conceptLines: concept.pubmedLines,
      strandFilter: getStrandFilterForAssembly(strand, "pubmed"),
      exclusionLines: getExclusionFilter("pubmed").lines,
      ageLimit: ageLinePubmed,
      dateLimit: pubmedDate,
      languageLimit: pubmedLanguage,
    });

    const counts =
      params.run_counts === false
        ? pubmed.lines.map(() => undefined)
        : await fetchPubmedLineCounts(pubmed.lines.map((line) => line.query));

    pubmed.lines.forEach((line, index) => {
      line.count = counts[index];
    });

    const finalPubmed = pubmed.lines[pubmed.finalLineNumber - 1].query;
    if (!firstPubmedQuery) firstPubmedQuery = finalPubmed;

    perStrand.push({
      strand,
      embase_lines: embase.lines,
      pubmed_lines: pubmed.lines,
      provenance,
      sign_filter_lines: signFilterLines,
    });
  }

  const markdown = formatStrategyMarkdown(perStrand, { emtreeDraft: true });
  const disclosure = buildDisclosure(audit, { level: disclosureLevel });
  const text = disclosure ? `${markdown}\n\n${disclosure}` : markdown;

  return {
    content: {
      markdown: text,
      strategy: {
        per_strand: perStrand,
        pipeline_inputs: {
          pubmed_query: firstPubmedQuery,
          date_from: params.date_from ?? null,
          picos: params.picos ?? null,
          research_question: params.research_question ?? null,
        },
      },
    },
    audit,
  };
}

export const searchStrategyBuildToolSchema = {
  name: "search.strategy_build",
  description:
    "Generate a formal PRISMA-ready systematic-review search strategy from a research question / PICOS. Returns numbered Embase + PubMed syntax blocks per review strand (economic, clinical, HRQoL, epidemiology), with REAL PubMed/MEDLINE per-line hit counts (NCBI E-utilities) and a blank Embase count column for your licensed run. Methodological filters sourced from SIGN templates. Embase Emtree terms are DRAFT — verify in Emtree. Output pre-fills the literature_search + screen_abstracts steps.",
  annotations: {
    title: "Search Strategy Builder",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      research_question: {
        type: "string",
        description: "Free-text research question (optional if picos given)",
      },
      picos: {
        type: "object",
        description: "Structured PICOS",
        properties: {
          population: { type: "string" },
          condition: { type: "string" },
          intervention: { type: "string" },
          comparator: { type: "string" },
          outcomes: { type: "array", items: { type: "string" } },
        },
      },
      condition_terms: {
        type: "array",
        items: { type: "string" },
        description: "Disease/condition synonyms for the concept block (≥1)",
      },
      intervention_terms: {
        type: "array",
        items: { type: "string" },
        description: "Optional intervention synonyms",
      },
      strands: {
        type: "array",
        items: {
          type: "string",
          enum: ["economic", "clinical", "hrqol", "epidemiology"],
        },
        description: "Review strands to generate (≥1)",
      },
      databases: {
        type: "array",
        items: { type: "string", enum: ["embase", "pubmed"] },
        description: "Default both",
      },
      age_limit: {
        type: "string",
        enum: ["pediatric", "adult", "elderly"],
        description: "Optional population age limit",
      },
      date_from: {
        type: "string",
        description: "YYYY-MM-DD; lower bound of publication year",
      },
      date_to: {
        type: "string",
        description: "YYYY-MM-DD; upper bound (defaults to current year)",
      },
      language: {
        type: "string",
        enum: ["english"],
        description: "Optional language limit",
      },
      run_counts: {
        type: "boolean",
        description: "Fetch real PubMed counts (default true)",
      },
      ai_disclosure_level: AI_DISCLOSURE_LEVEL_SCHEMA_PROPERTY,
    },
    required: ["condition_terms", "strands"],
  },
};