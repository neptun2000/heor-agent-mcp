import type { LiteratureResult } from "../providers/types.js";
import type { AuditRecord } from "../audit/types.js";

export function resultsToMarkdown(
  results: LiteratureResult[],
  audit: AuditRecord,
): string {
  const lines: string[] = [];

  lines.push(`## Literature Search Results`);
  lines.push(
    `*${results.length} studies included across ${audit.sources_queried.length} sources*\n`,
  );

  if (results.length === 0) {
    lines.push("No results found matching your query.");
  } else {
    results.forEach((r, i) => {
      lines.push(`### ${i + 1}. ${r.title}`);
      lines.push(
        `**Source:** ${r.source} | **Date:** ${r.date} | **Type:** ${r.study_type}`,
      );
      if (r.authors.length > 0)
        lines.push(`**Authors:** ${r.authors.join(", ")}`);
      if (r.abstract)
        lines.push(
          `\n${r.abstract.slice(0, 300)}${r.abstract.length > 300 ? "..." : ""}`,
        );
      lines.push(`**URL:** ${r.url}\n`);
    });
  }

  lines.push(auditToMarkdown(audit));
  return lines.join("\n");
}

export function auditToMarkdown(audit: AuditRecord): string {
  const lines: string[] = [];
  lines.push(`---`);
  lines.push(`## Audit Report`);
  lines.push(
    `**Tool:** ${audit.tool} | **Time:** ${audit.timestamp} | **Methodology:** ${audit.methodology || "N/A"}`,
  );
  lines.push(`**Total included:** ${audit.inclusions}`);

  if (audit.sources_queried.length > 0) {
    lines.push(`\n### Sources Queried`);
    lines.push(`| Source | Query | Returned | Included | Status |`);
    lines.push(`|--------|-------|----------|----------|--------|`);
    audit.sources_queried.forEach((s) => {
      lines.push(
        `| ${s.source} | \`${s.query_sent}\` | ${s.results_returned} | ${s.results_included} | ${s.status} |`,
      );
    });
  }

  if (audit.exclusions.length > 0) {
    lines.push(`\n### Exclusions (${audit.exclusions.length})`);
    audit.exclusions.forEach((e) => lines.push(`- ${e.title}: *${e.reason}*`));
  }

  if (audit.assumptions.length > 0) {
    lines.push(`\n### Assumptions`);
    audit.assumptions.forEach((a) => lines.push(`- ${a}`));
  }

  if (audit.warnings.length > 0) {
    lines.push(`\n### Warnings`);
    audit.warnings.forEach((w) => lines.push(`- ⚠️ ${w}`));
  }

  return lines.join("\n");
}
