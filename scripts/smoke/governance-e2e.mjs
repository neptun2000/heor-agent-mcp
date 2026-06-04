/**
 * End-to-end smoke test for governance.self_check, driven through the REAL MCP
 * server over stdio (not the handler directly). This exercises the server's
 * content-wrapping path in server.ts, which the unit suite does NOT cover —
 * every jest test hits handlers directly, so a double-wrap regression in the
 * dispatch `case` is invisible to `npm test`. Run after `npm run build`:
 *
 *   npm run build && node scripts/smoke/governance-e2e.mjs
 *
 * Exits non-zero on any assertion failure. Caught the v1.14.0 double-wrap bug
 * (server.ts returned result.content as an MCP array, which the post-switch then
 * JSON-stringified again). See design log #34.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";

const transport = new StdioClientTransport({ command: "node", args: ["dist/server.js"] });
const client = new Client({ name: "governance-smoke", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);

try {
  // Discoverable over the protocol
  const list = await client.listTools();
  assert.ok(
    list.tools.some((t) => t.name === "governance.self_check"),
    "governance.self_check must be registered in tools/list",
  );

  // describe mode — single-wrapped payload parses straight to the result shape
  const res = await client.callTool({
    name: "governance.self_check",
    arguments: {
      mode: "describe",
      workflow_description: "ChatGPT pastes SLR summaries into our NICE dossier with no source check or human sign-off.",
      context: { use_case: "regulatory_submission" },
      probes: { citation_validation: { answer: "no" }, human_oversight: { answer: "no" } },
    },
  });
  const r = JSON.parse(res.content[0].text);
  assert.equal(typeof r.verdict, "string", "result must be single-wrapped (verdict at top level)");
  assert.match(r.verdict, /Not submission-ready/, "two Reds in a submission → not submission-ready");
  assert.equal(r.dimensions.find((d) => d.key === "citation_validation").rag, "red");
  assert.equal(r.dimensions.find((d) => d.key === "phi_data_handling").rag, "insufficient", "omitted probe → insufficient, never green");
  assert.ok(r.markdown_section.includes("AI Assistance Disclosure"), "must carry ELEVATE disclosure");
  assert.ok(r.markdown_section.includes("Robustness Checks"), "must carry the unscored-domains scope note");

  // audit_record mode — derive 1/2/6 from the trace, 3/4/5 insufficient
  const audit = {
    tool: "literature.search", timestamp: new Date().toISOString(), query: {},
    sources_queried: [{ source: "pubmed", query_sent: "x", results_returned: 5, results_included: 5, latency_ms: 1, status: "ok" }],
    methodology: "PRISMA", inclusions: 5, exclusions: [], assumptions: [], warnings: [],
    output_format: "markdown",
    tools_called: [{ name: "utils.validate_links", ms: 1, outcome: "ok" }],
  };
  const res2 = await client.callTool({ name: "governance.self_check", arguments: { mode: "audit_record", audit_record: audit } });
  const byKey = Object.fromEntries(JSON.parse(res2.content[0].text).dimensions.map((d) => [d.key, d.rag]));
  assert.equal(byKey.transparency, "green");
  assert.equal(byKey.citation_validation, "green");
  assert.equal(byKey.auditability, "green");
  assert.equal(byKey.human_oversight, "insufficient");
  assert.equal(byKey.phi_data_handling, "insufficient");
  assert.equal(byKey.bias_equity, "insufficient");

  console.log("governance.self_check e2e smoke: PASS");
} finally {
  await client.close();
}
