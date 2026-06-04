import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2] || "https://heor-agent-mcp.azurewebsites.net/mcp";
const transport = new StreamableHTTPClientTransport(new URL(url));
const client = new Client({ name: "remote-verify", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);

const list = await client.listTools();
console.log("TOOLS_TOTAL:", list.tools.length);
console.log("GOVERNANCE_REGISTERED:", list.tools.some((t) => t.name === "governance.self_check"));

const res = await client.callTool({
  name: "governance.self_check",
  arguments: {
    mode: "describe",
    workflow_description: "ChatGPT pastes SLR summaries into our dossier with no source check or human sign-off.",
    context: { use_case: "regulatory_submission" },
    probes: { citation_validation: { answer: "no" }, human_oversight: { answer: "no" } },
  },
});
const r = JSON.parse(res.content[0].text);
console.log("VERDICT:", r.verdict);
console.log("SCORECARD:", JSON.stringify(r.scorecard));
console.log("HAS_DISCLOSURE:", r.markdown_section.includes("AI Assistance Disclosure"));
await client.close();
console.log("REMOTE_OK");
