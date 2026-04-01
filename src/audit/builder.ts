import type { AuditRecord, SourceAudit, ExclusionRecord } from "./types.js";

export function createAuditRecord(
  tool: string,
  query: Record<string, unknown>,
  output_format: string,
  methodology = ""
): AuditRecord {
  return {
    tool,
    timestamp: new Date().toISOString(),
    query,
    sources_queried: [],
    methodology,
    inclusions: 0,
    exclusions: [],
    assumptions: [],
    warnings: [],
    output_format,
  };
}

export function addSource(record: AuditRecord, source: SourceAudit): AuditRecord {
  return {
    ...record,
    sources_queried: [...record.sources_queried, source],
    inclusions: record.inclusions + source.results_included,
  };
}

export function addExclusion(record: AuditRecord, exclusion: ExclusionRecord): AuditRecord {
  return {
    ...record,
    exclusions: [...record.exclusions, exclusion],
  };
}

export function addAssumption(record: AuditRecord, assumption: string): AuditRecord {
  return { ...record, assumptions: [...record.assumptions, assumption] };
}

export function addWarning(record: AuditRecord, warning: string): AuditRecord {
  return { ...record, warnings: [...record.warnings, warning] };
}

export function setMethodology(record: AuditRecord, methodology: string): AuditRecord {
  return { ...record, methodology };
}
