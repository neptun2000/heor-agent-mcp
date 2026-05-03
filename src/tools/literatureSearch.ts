import { z } from "zod";
import { createProvider } from "../providers/factory.js";
import type { ToolResult } from "../providers/types.js";
import { suggestForEnum } from "../util/didYouMean.js";

// Single-source aliases — common typos and informal names.
const SOURCE_ALIASES: Record<string, string> = {
  nice: "nice_ta",
  cadth: "cadth_reviews",
  "cda-amc": "cadth_reviews",
  icer: "icer_reports",
  pbac: "pbac_psd",
  gba: "gba_decisions",
  "g-ba": "gba_decisions",
  has: "has_tc",
  ct: "clinicaltrials",
  "clinicaltrials.gov": "clinicaltrials",
  ncbi: "pubmed",
  elsevier: "embase",
  world_bank_data: "world_bank",
  worldbank: "world_bank",
  who: "who_gho",
  gbd: "ihme_gbd",
  nadac: "cms_nadac",
  nhs: "nhs_costs",
  pbs: "pbs_schedule",
  "wiley online library": "wiley",
  pharmacoeconomics: "wiley",
  "health economics": "wiley",
  "office of health economics": "ohe",
  euroqol_group: "euroqol",
  "eq-5d": "euroqol",
  eq5d: "euroqol",
};

// Macro aliases — one shorthand expands to a family of related sources.
// Lets agents (Claude / ChatGPT) use coarse categories like "hta" without
// hallucinating one-off names like "heta".
const SOURCE_MACROS: Record<string, string[]> = {
  hta: [
    "nice_ta",
    "cadth_reviews",
    "icer_reports",
    "pbac_psd",
    "gba_decisions",
    "has_tc",
    "iqwig",
    "aifa",
    "tlv",
    "inesss",
  ],
  hta_eu: ["nice_ta", "iqwig", "has_tc", "gba_decisions", "aifa", "tlv"],
  hta_uk: ["nice_ta"],
  hta_us: ["icer_reports", "orange_book", "purple_book"],
  hta_apac: ["pbac_psd", "hitap"],
  hta_latam: ["conitec", "iets", "fonasa"],
  costs: ["cms_nadac", "pssru", "nhs_costs", "bnf", "pbs_schedule"],
  preprints: ["biorxiv"],
  registries: ["clinicaltrials"],
  epidemiology: ["who_gho", "world_bank", "oecd", "ihme_gbd"],
};

const LiteratureSearchSchema = z.object({
  query: z.string().min(1, "query is required"),
  sources: z
    .array(
      z.enum([
        "pubmed",
        "clinicaltrials",
        "biorxiv",
        "chembl",
        "embase",
        "sciencedirect",
        "who_gho",
        "world_bank",
        "all_of_us",
        "oecd",
        "ihme_gbd",
        "orange_book",
        "purple_book",
        "cochrane",
        "citeline",
        "pharmapendium",
        "cortellis",
        "google_scholar",
        "cms_nadac",
        "pssru",
        "nhs_costs",
        "bnf",
        "pbs_schedule",
        "datasus",
        "conitec",
        "anvisa",
        "paho",
        "iets",
        "fonasa",
        "hitap",
        "nice_ta",
        "cadth_reviews",
        "icer_reports",
        "pbac_psd",
        "gba_decisions",
        "has_tc",
        "iqwig",
        "aifa",
        "tlv",
        "inesss",
        "ispor",
        "wiley",
        "ohe",
        "euroqol",
      ]),
    )
    .optional(),
  max_results: z.number().int().min(1).max(100).optional(),
  date_from: z.string().optional(),
  study_types: z
    .array(z.enum(["rct", "meta_analysis", "observational", "review"]))
    .optional(),
  output_format: z.enum(["text", "json", "docx"]).optional(),
  project: z.string().optional(),
  runs: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe(
      "Number of search runs to perform (1-5, default 1). Multiple runs are deduplicated and ranked by consistency — studies found in more runs are ranked higher. Use runs=3 for comprehensive, stable results.",
    ),
});

function resolveSourceAliases(params: unknown): unknown {
  if (
    typeof params === "object" &&
    params !== null &&
    "sources" in params &&
    Array.isArray((params as Record<string, unknown>).sources)
  ) {
    const p = params as Record<string, unknown>;
    const expanded: string[] = [];
    const seen = new Set<string>();
    for (const raw of p.sources as string[]) {
      const lower = raw.toLowerCase();
      // Macro alias: one input → multiple sources (e.g., "hta" → all HTA bodies)
      if (lower in SOURCE_MACROS) {
        for (const s of SOURCE_MACROS[lower]) {
          if (!seen.has(s)) {
            seen.add(s);
            expanded.push(s);
          }
        }
        continue;
      }
      // Single alias or pass-through
      const resolved = SOURCE_ALIASES[lower] ?? raw;
      if (!seen.has(resolved)) {
        seen.add(resolved);
        expanded.push(resolved);
      }
    }
    p.sources = expanded;
  }
  return params;
}

export async function handleLiteratureSearch(
  rawParams: unknown,
): Promise<ToolResult> {
  const aliased = resolveSourceAliases(rawParams);
  const result = LiteratureSearchSchema.safeParse(aliased);
  if (!result.success) {
    // Enrich invalid_enum_value errors with did-you-mean suggestions —
    // helps Claude/ChatGPT self-correct on the next turn instead of
    // returning the raw Zod issue list.
    const messages: string[] = [];
    for (const issue of result.error.issues) {
      if (
        issue.code === "invalid_enum_value" &&
        typeof issue.received === "string"
      ) {
        const suggestions = suggestForEnum(
          issue.received,
          issue.options as readonly string[],
        );
        const macros = Object.keys(SOURCE_MACROS).join(", ");
        const hint =
          suggestions.length > 0
            ? `Did you mean: ${suggestions.map((s) => `"${s}"`).join(", ")}?`
            : `Or use a macro: ${macros} (each expands to a family of sources).`;
        messages.push(`Unknown source "${issue.received}". ${hint}`);
      } else {
        messages.push(`${issue.path.join(".")}: ${issue.message}`);
      }
    }
    throw new Error(messages.join("\n"));
  }
  const provider = createProvider();
  return provider.searchLiterature(result.data);
}

export const literatureSearchToolSchema = {
  name: "literature.search",
  description:
    "Search PubMed, ClinicalTrials.gov, bioRxiv/medRxiv, ChEMBL, FDA Orange Book, FDA Purple Book, enterprise sources (Embase, ScienceDirect, Cochrane, Citeline, Pharmapendium, Cortellis), HTA cost reference sources (CMS NADAC, PSSRU, NHS National Cost Collection, BNF, PBS Schedule), LATAM sources (DATASUS, CONITEC, ANVISA, PAHO, IETS, FONASA), APAC sources (HITAP), and HTA appraisal/guidance sources (NICE TAs, CADTH CDR/pCODR, ICER, PBAC PSDs, G-BA AMNOG, HAS Transparency Committee, IQWiG, AIFA, TLV Sweden, INESSS Quebec) for evidence on a drug or indication. Returns structured results including HTA precedents and appraisal decisions with a full audit trail suitable for HTA submissions.",
  annotations: {
    title: "Literature Search",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Research question (e.g. 'semaglutide type 2 diabetes cost-effectiveness')",
      },
      sources: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "pubmed",
            "clinicaltrials",
            "biorxiv",
            "chembl",
            "embase",
            "sciencedirect",
            "who_gho",
            "world_bank",
            "all_of_us",
            "oecd",
            "ihme_gbd",
            "orange_book",
            "purple_book",
            "cochrane",
            "citeline",
            "pharmapendium",
            "cortellis",
            "google_scholar",
            "cms_nadac",
            "pssru",
            "nhs_costs",
            "bnf",
            "pbs_schedule",
            "datasus",
            "conitec",
            "anvisa",
            "paho",
            "iets",
            "fonasa",
            "hitap",
            "nice_ta",
            "cadth_reviews",
            "icer_reports",
            "pbac_psd",
            "gba_decisions",
            "has_tc",
            "iqwig",
            "aifa",
            "tlv",
            "inesss",
            "ispor",
            "wiley",
            "ohe",
            "euroqol",
          ],
        },
        description:
          "Data sources to query. Default: pubmed, clinicaltrials, biorxiv, chembl, wiley (+ embase if ELSEVIER_API_KEY set). Use 'who_gho' and 'world_bank' for epidemiology and demographic data. Use 'oecd' for OECD health statistics (expenditure, hospital beds, physicians, life expectancy). Use 'ihme_gbd' for Global Burden of Disease estimates. Use 'orange_book' for FDA drug approvals. Use 'purple_book' for FDA biologics and biosimilars. Enterprise (require API key): 'cochrane' (COCHRANE_API_KEY), 'citeline' (CITELINE_API_KEY), 'pharmapendium' (PHARMAPENDIUM_API_KEY), 'cortellis' (CORTELLIS_API_KEY). HTA cost refs: 'cms_nadac', 'pssru', 'nhs_costs', 'bnf', 'pbs_schedule'. LATAM sources: 'datasus', 'conitec', 'anvisa', 'paho', 'iets', 'fonasa'. APAC sources: 'hitap'. HTA appraisal/precedent sources: 'nice_ta', 'cadth_reviews', 'icer_reports', 'pbac_psd', 'gba_decisions', 'has_tc', 'iqwig', 'aifa', 'tlv', 'inesss'. HEOR methodology sources: 'ispor', 'wiley' (Pharmacoeconomics, Health Economics, Value in Health — via CrossRef), 'ohe' (Office of Health Economics — value set analyses, HTA methodology), 'euroqol' (EuroQol Group — EQ-5D instrument, country value sets, crosswalks).",
      },
      max_results: {
        type: "number",
        description: "Maximum results to return (default: 20, max: 100)",
      },
      date_from: {
        type: "string",
        description:
          "Exclude results before this date (ISO format: YYYY-MM-DD)",
      },
      output_format: {
        type: "string",
        enum: ["text", "json", "docx"],
        description: "Output format. 'docx' requires hosted tier.",
      },
      project: {
        type: "string",
        description:
          "Project ID for knowledge base persistence. When set, results are saved to ~/.heor-agent/projects/{project}/raw/literature/",
      },
      runs: {
        type: "number",
        description:
          "Number of search runs (1-5, default 1). Multiple runs deduplicate and rank by consistency. Use runs=3 for comprehensive, stable results.",
      },
    },
    required: ["query"],
  },
};
