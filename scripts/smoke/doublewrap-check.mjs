/**
 * Verifies the dispatch double-wrap fix over the wire: a tool's result text must
 * be the clean payload, NOT a stringified MCP envelope (`[{"type":"text",...}]`).
 * Usage: node scripts/smoke/doublewrap-check.mjs <mcp-url>
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Target MCP URL: pass as argv[2] or MCP_URL env. Defaults to the PUBLIC endpoint
// (keep internal hostnames out of this public repo).
const url =
  process.argv[2] ||
  process.env.MCP_URL ||
  "https://heor-agent-mcp-production.up.railway.app/mcp";
const transport = new StreamableHTTPClientTransport(new URL(url));
const client = new Client({ name: "doublewrap-check", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);

function isDoubleWrapped(text) {
  // bug shape: the text is a JSON-stringified array of MCP content blocks
  return /^\s*\[\s*\{\s*"type"\s*:\s*"text"/.test(text);
}

let failures = 0;
async function check(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  const bad = isDoubleWrapped(text);
  console.log(`${name}: ${bad ? "DOUBLE-WRAPPED ❌" : "clean ✅"} (head: ${text.slice(0, 48).replace(/\n/g, " ")})`);
  if (bad) failures++;
}

// regulatory.status_check — one of the 5 fixed tools; simple args, returns JSON payload
await check("regulatory.status_check", { drug: "tirzepatide", region: "us" });

await client.close();
console.log(failures === 0 ? "DOUBLEWRAP_OK" : `DOUBLEWRAP_FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
