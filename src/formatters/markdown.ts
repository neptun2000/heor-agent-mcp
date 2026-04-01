import type { LiteratureResult } from "../providers/types.js";
import type { AuditRecord } from "../audit/types.js";

export function resultsToMarkdown(results: LiteratureResult[], audit: AuditRecord): string {
  return `## Literature Search Results\n\n${results.length} results found.\n\nAudit: ${audit.tool} at ${audit.timestamp}`;
}

export function auditToMarkdown(audit: AuditRecord): string {
  return `## Audit\n\nTool: ${audit.tool}\nTimestamp: ${audit.timestamp}\nInclusions: ${audit.inclusions}`;
}
