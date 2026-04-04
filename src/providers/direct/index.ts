import type {
  IProvider,
  LiteratureSearchParams,
  CEModelParams,
  DossierParams,
  ToolResult,
  LiteratureResult,
  DataSource,
} from "../types.js";
import {
  createAuditRecord,
  addSource,
  addWarning,
  setMethodology,
} from "../../audit/builder.js";
import { fetchPubMed } from "./pubmed.js";
import { fetchClinicalTrials } from "./clinicalTrials.js";
import { fetchBiorxiv } from "./biorxiv.js";
import { fetchChembl } from "./chembl.js";
import { fetchEmbase } from "./embase.js";
import { resultsToMarkdown } from "../../formatters/markdown.js";

function getAllSources(): DataSource[] {
  const base: DataSource[] = ["pubmed", "clinicaltrials", "biorxiv", "chembl"];
  if (process.env.ELSEVIER_API_KEY) base.push("embase");
  return base;
}

const FETCHERS: Record<
  DataSource,
  (query: string, max: number) => Promise<LiteratureResult[]>
> = {
  pubmed: fetchPubMed,
  clinicaltrials: fetchClinicalTrials,
  biorxiv: fetchBiorxiv,
  chembl: fetchChembl,
  embase: fetchEmbase,
};

export class DirectProvider implements IProvider {
  async searchLiterature(params: LiteratureSearchParams): Promise<ToolResult> {
    const sources = params.sources ?? getAllSources();
    const maxPerSource = Math.ceil((params.max_results ?? 20) / sources.length);
    const outputFormat = params.output_format ?? "text";

    let audit = createAuditRecord(
      "literature_search",
      params as unknown as Record<string, unknown>,
      outputFormat,
    );
    audit = setMethodology(audit, "PRISMA-style multi-database search");

    if (sources.includes("embase") && !process.env.ELSEVIER_API_KEY) {
      audit = addWarning(
        audit,
        "Embase requested but ELSEVIER_API_KEY is not set — Embase results will be empty. Set ELSEVIER_API_KEY to enable Embase search.",
      );
    }

    const allResults: LiteratureResult[] = [];

    for (const source of sources) {
      const start = Date.now();
      try {
        const results = await FETCHERS[source](params.query, maxPerSource);
        const filtered = params.date_from
          ? results.filter((r) => !r.date || r.date >= params.date_from!)
          : results;
        audit = addSource(audit, {
          source,
          query_sent: params.query,
          results_returned: results.length,
          results_included: filtered.length,
          latency_ms: Date.now() - start,
          status: "ok",
        });
        allResults.push(...filtered);
      } catch (err) {
        audit = addSource(audit, {
          source,
          query_sent: params.query,
          results_returned: 0,
          results_included: 0,
          latency_ms: Date.now() - start,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
        audit = addWarning(
          audit,
          `Source ${source} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const content =
      outputFormat === "json"
        ? allResults
        : resultsToMarkdown(allResults, audit);

    return { content, audit };
  }

  async buildCEModel(_params: CEModelParams): Promise<ToolResult> {
    throw new Error(
      "DirectProvider.buildCEModel — implemented in costEffectivenessModel tool",
    );
  }

  async prepDossier(_params: DossierParams): Promise<ToolResult> {
    throw new Error(
      "DirectProvider.prepDossier — implemented in htaDossierPrep tool",
    );
  }
}
