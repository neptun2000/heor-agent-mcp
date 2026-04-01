import type { LiteratureResult } from "../providers/types.js";
import type { AuditRecord } from "../audit/types.js";

export function resultsToJson(results: LiteratureResult[], audit: AuditRecord): object {
  return { results, audit, total: results.length };
}
