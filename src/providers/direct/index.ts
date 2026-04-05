import type {
  IProvider,
  LiteratureSearchParams,
  CEModelParams,
  DossierParams,
  ToolResult,
  LiteratureResult,
  DataSource,
} from "../types.js";
import { saveLiteratureResult } from "../../knowledge/index.js";
import {
  createAuditRecord,
  addSource,
  addWarning,
  addAssumption,
  setMethodology,
} from "../../audit/builder.js";
import { fetchPubMed } from "./pubmed.js";
import { fetchClinicalTrials } from "./clinicalTrials.js";
import { fetchBiorxiv } from "./biorxiv.js";
import { fetchChembl } from "./chembl.js";
import { fetchEmbase } from "./embase.js";
import { fetchWhoGho } from "./whoGho.js";
import { fetchWorldBank } from "./worldBank.js";
import { fetchAllOfUs } from "./allOfUs.js";
import { fetchOecd } from "./oecd.js";
import { fetchIhmeGbd } from "./ihmeGbd.js";
import { fetchOrangeBook } from "./orangeBook.js";
import { fetchPurpleBook } from "./purpleBook.js";
import { fetchCochrane } from "./cochrane.js";
import { fetchCiteline } from "./citeline.js";
import { fetchPharmapendium } from "./pharmapendium.js";
import { fetchCortellis } from "./cortellis.js";
import { fetchGoogleScholar } from "./googleScholar.js";
import { getProxyUrl } from "./proxyClient.js";
import { resultsToMarkdown } from "../../formatters/markdown.js";
import { resultsToDocx } from "../../formatters/docx.js";
import {
  analyzeMetabolicProfile,
  profileToMarkdown,
} from "../../tools/metabolicProfile.js";

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
  who_gho: fetchWhoGho,
  world_bank: fetchWorldBank,
  all_of_us: fetchAllOfUs,
  oecd: fetchOecd,
  ihme_gbd: fetchIhmeGbd,
  orange_book: fetchOrangeBook,
  purple_book: fetchPurpleBook,
  cochrane: fetchCochrane,
  citeline: fetchCiteline,
  pharmapendium: fetchPharmapendium,
  cortellis: fetchCortellis,
  google_scholar: fetchGoogleScholar,
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

    const proxyActive = getProxyUrl() !== null;
    const enterpriseKeys: Record<string, string> = {
      embase: "ELSEVIER_API_KEY",
      cochrane: "COCHRANE_API_KEY",
      citeline: "CITELINE_API_KEY",
      pharmapendium: "PHARMAPENDIUM_API_KEY",
      cortellis: "CORTELLIS_API_KEY",
      google_scholar: "SERPAPI_KEY",
    };
    for (const [src, envVar] of Object.entries(enterpriseKeys)) {
      if (
        sources.includes(src as DataSource) &&
        !process.env[envVar] &&
        !proxyActive
      ) {
        audit = addWarning(
          audit,
          `${src} requested but ${envVar} is not set and HEOR_PROXY_URL is not configured — ${src} results will be empty.`,
        );
      }
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

    if (params.project && allResults.length > 0) {
      let savedCount = 0;
      let errors = 0;
      for (const result of allResults) {
        try {
          await saveLiteratureResult(params.project, result, params.query);
          savedCount++;
        } catch {
          errors++;
        }
      }
      audit = addAssumption(
        audit,
        `Auto-saved ${savedCount} results to project "${params.project}"${errors > 0 ? ` (${errors} errors)` : ""}`,
      );
    }

    const profile = analyzeMetabolicProfile(allResults, params.query);

    let content: string | object;
    if (outputFormat === "json") {
      content = { results: allResults, population_profile: profile };
    } else if (outputFormat === "docx") {
      const base64 = await resultsToDocx(allResults, audit);
      content = `[DOCX Report Generated - ${allResults.length} results]\n\nBase64-encoded DOCX (${Math.round(base64.length / 1024)}KB):\n${base64}`;
    } else {
      const markdownContent = resultsToMarkdown(allResults, audit);
      const profileMarkdown = profileToMarkdown(profile);
      content = markdownContent + "\n" + profileMarkdown;
    }

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
