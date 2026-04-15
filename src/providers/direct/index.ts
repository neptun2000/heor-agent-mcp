import type {
  IProvider,
  LiteratureSearchParams,
  CEModelParams,
  DossierParams,
  ToolResult,
  LiteratureResult,
  DataSource,
} from "../types.js";
import { saveLiteratureResult, saveReport } from "../../knowledge/index.js";
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
import { fetchScienceDirect } from "./scienceDirect.js";
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
import { fetchCmsNadac } from "./cmsNadac.js";
import { fetchPssru } from "./pssru.js";
import { fetchNhsCosts } from "./nhsCosts.js";
import { fetchBnf } from "./bnf.js";
import { fetchPbsSchedule } from "./pbsSchedule.js";
import { fetchDatasus } from "./datasus.js";
import { fetchConitec } from "./conitec.js";
import { fetchAnvisa } from "./anvisa.js";
import { fetchPaho } from "./paho.js";
import { fetchIets } from "./iets.js";
import { fetchFonasa } from "./fonasa.js";
import { fetchHitap } from "./hitap.js";
import { fetchNiceTa } from "./niceTa.js";
import { fetchCadthReviews } from "./cadthReviews.js";
import { fetchIcerReports } from "./icerReports.js";
import { fetchPbacPsd } from "./pbacPsd.js";
import { fetchGbaDecisions } from "./gbaDecisions.js";
import { fetchHasTc } from "./hasTc.js";
import { fetchIqwig } from "./iqwig.js";
import { fetchAifa } from "./aifa.js";
import { fetchTlv } from "./tlv.js";
import { fetchInesss } from "./inesss.js";
import { fetchIspor } from "./ispor.js";
import { getProxyUrl } from "./proxyClient.js";
import { resultsToMarkdown } from "../../formatters/markdown.js";
import { resultsToDocx } from "../../formatters/docx.js";
import {
  analyzeMetabolicProfile,
  profileToMarkdown,
} from "../../tools/metabolicProfile.js";
import { buildSourceSelectionTable } from "../../sources/registry.js";

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
  sciencedirect: fetchScienceDirect,
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
  cms_nadac: fetchCmsNadac,
  pssru: fetchPssru,
  nhs_costs: fetchNhsCosts,
  bnf: fetchBnf,
  pbs_schedule: fetchPbsSchedule,
  datasus: fetchDatasus,
  conitec: fetchConitec,
  anvisa: fetchAnvisa,
  paho: fetchPaho,
  iets: fetchIets,
  fonasa: fetchFonasa,
  hitap: fetchHitap,
  nice_ta: fetchNiceTa,
  cadth_reviews: fetchCadthReviews,
  icer_reports: fetchIcerReports,
  pbac_psd: fetchPbacPsd,
  gba_decisions: fetchGbaDecisions,
  has_tc: fetchHasTc,
  iqwig: fetchIqwig,
  aifa: fetchAifa,
  tlv: fetchTlv,
  inesss: fetchInesss,
  ispor: fetchIspor,
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

    // Build source selection table showing all 39 sources with used/not-used and reason
    audit.source_selection = buildSourceSelectionTable(sources);

    const proxyActive = getProxyUrl() !== null;
    const enterpriseKeys: Record<string, string> = {
      embase: "ELSEVIER_API_KEY",
      sciencedirect: "ELSEVIER_API_KEY",
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

    const runs = Math.min(Math.max(params.runs ?? 1, 1), 5);
    const allResults: LiteratureResult[] = [];

    // Track how many runs each result appears in (for stability ranking)
    const resultFrequency = new Map<string, number>();

    for (let run = 0; run < runs; run++) {
      for (const source of sources) {
        const start = Date.now();
        try {
          const results = await FETCHERS[source](params.query, maxPerSource);
          const filtered = params.date_from
            ? results.filter((r) => !r.date || r.date >= params.date_from!)
            : results;

          // Only add audit for first run to avoid duplicating source entries
          if (run === 0) {
            audit = addSource(audit, {
              source,
              query_sent: params.query,
              results_returned: results.length,
              results_included: filtered.length,
              latency_ms: Date.now() - start,
              status: "ok",
            });
          }

          for (const r of filtered) {
            const key = r.id || `${r.source}_${r.title}`;
            const freq = (resultFrequency.get(key) ?? 0) + 1;
            resultFrequency.set(key, freq);

            // Only add to results if not already present (deduplicate)
            if (freq === 1) {
              allResults.push(r);
            }
          }
        } catch (err) {
          if (run === 0) {
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
      }
    }

    // Sort by stability: results found in more runs ranked higher
    if (runs > 1) {
      allResults.sort((a, b) => {
        const keyA = a.id || `${a.source}_${a.title}`;
        const keyB = b.id || `${b.source}_${b.title}`;
        const freqA = resultFrequency.get(keyA) ?? 0;
        const freqB = resultFrequency.get(keyB) ?? 0;
        return freqB - freqA; // higher frequency first
      });

      audit = addAssumption(
        audit,
        `Stability search: ${runs} runs performed, results deduplicated and ranked by consistency (${allResults.length} unique results)`,
      );

      // Add stability scores to results
      for (const r of allResults) {
        const key = r.id || `${r.source}_${r.title}`;
        const freq = resultFrequency.get(key) ?? 1;
        r.abstract = `[Stability: ${freq}/${runs} runs] ${r.abstract}`;
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
      const filenameStem = `literature-search-${(params.query ?? "report").slice(0, 40)}`;
      const savedPath = await saveReport(base64, filenameStem, params.project);
      const sizeKb = Math.round(base64.length / 1024);
      content = `## DOCX Report Generated\n\n**File:** \`${savedPath}\`\n**Size:** ${sizeKb} KB\n**Results:** ${allResults.length} studies from ${audit.sources_queried.length} sources\n\nOpen with: \`open "${savedPath}"\``;
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
