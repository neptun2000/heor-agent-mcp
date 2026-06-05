/**
 * Live-API smoke: exercises the external-API fetcher hardening (design log #36 / T1-T8)
 * end-to-end against a RUNNING MCP server, with an edge-case query (parentheses +
 * boolean operators) that previously caused silent failures / 400s.
 *
 * This is NOT a CI unit test — it hits real upstream APIs (PubMed, ClinicalTrials,
 * bioRxiv, …) and needs network. Run on-demand:
 *   node scripts/smoke/live-api-smoke.mjs [mcp-url] [comma,sources]
 * Defaults to the Railway public endpoint and a representative no-key source set.
 *
 * Pass criteria: the hardened fetchers must EITHER return results OR surface an
 * explicit per-source error/status — never a silent empty result. (The bug class
 * was: a non-2xx swallowed into `[]` with no signal.)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2] || "https://heor-agent-mcp-production.up.railway.app/mcp";
const sources = process.argv[3]
  ? process.argv[3].split(",")
  : ["pubmed", "clinicaltrials", "biorxiv"];
// Edge case: parentheses + OR that broke Scopus/scienceDirect and bioRxiv substring match.
const query = "tirzepatide (obesity OR overweight) cost-effectiveness";

const transport = new StreamableHTTPClientTransport(new URL(url));
const client = new Client({ name: "live-api-smoke", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);

try {
  const res = await client.callTool({
    name: "literature.search",
    arguments: { query, sources, max_results: 5, runs: 1 },
  });
  const text = res.content?.[0]?.text ?? "";
  const hasResults = /\bPMID\b|doi\.org|clinicaltrials|preprint|\bNCT\d/i.test(text);
  const errorSurfaced =
    /failed|error|status\s*[45]\d\d|\b40[03]\b|\b429\b|browser_only|not reachable|no results/i.test(
      text,
    );
  console.log(`query: ${query}`);
  console.log(`sources: ${sources.join(", ")}`);
  console.log(`result chars: ${text.length} | hasResults: ${hasResults} | errorSurfaced: ${errorSurfaced}`);
  if (!hasResults && !errorSurfaced) {
    console.log("LIVE_SMOKE_FAIL: silent empty — no results AND no surfaced error/status");
    process.exitCode = 1;
  } else {
    console.log("LIVE_SMOKE_OK");
  }
} finally {
  await client.close();
}
