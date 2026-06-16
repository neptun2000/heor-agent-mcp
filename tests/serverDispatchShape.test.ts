import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * GUARD against the "double-wrap" bug class.
 *
 * The CallTool handler in server.ts ends each non-error path by running the
 * `result.content` value through a single post-switch wrap:
 *
 *   const content = typeof result.content === "string"
 *     ? result.content
 *     : JSON.stringify(result.content, null, 2);
 *   return { content: [{ type: "text", text: content }] };
 *
 * So a dispatch case must set `result = { content: <string | payload object> }`.
 * If a case instead sets `result = { content: [ { type: "text", text } ] }` (an
 * MCP content ARRAY), the post-switch JSON-stringifies that array AGAIN and the
 * LLM receives a stringified envelope (`[{"type":"text","text":"..."}]`) instead
 * of the payload. This silently corrupted the output of governance.self_check and
 * 5 other tools (regulatory.status_check, evidence.unmet_need, evidence.clinical_scale,
 * data.claims_query, data.query_agent) — invisible to unit tests, fixed 2026-06-05.
 *
 * NOTE: validation early-returns use `return { content: [...], isError: true }`
 * (a direct return that bypasses the post-switch) and are correct — this guard
 * only flags the `result = { content: [` ASSIGNMENT form, which is always a bug.
 */
describe("server.ts dispatch shape — no double-wrap", () => {
  const src = readFileSync(
    join(__dirname, "..", "src", "server.ts"),
    "utf8",
  );

  it("no dispatch case assigns result = { content: [ ... ] }", () => {
    const re = /result\s*=\s*\{\s*content:\s*\[/g;
    const offending = [...src.matchAll(re)].map(
      (m) => src.slice(0, m.index ?? 0).split("\n").length, // 1-based line number
    );
    expect(offending).toEqual([]);
  });

  it("claims tools require explicit internal opt-in, not just storage credentials", () => {
    expect(src).toContain("HEOR_ENABLE_INTERNAL_CLAIMS");
    expect(src).toContain("function internalClaimsEnabled()");
    expect(src).not.toMatch(
      /\.\.\.\(process\.env\.AZURE_STORAGE_CONNECTION_STRING\s*\?/,
    );
    expect(src).not.toMatch(
      /if \(!process\.env\.AZURE_STORAGE_CONNECTION_STRING\)/,
    );
  });
});
