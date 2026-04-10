export interface SourceAudit {
  source: string;
  query_sent: string;
  results_returned: number;
  results_included: number;
  latency_ms: number;
  status: "ok" | "partial" | "failed";
  error?: string;
}

export interface ExclusionRecord {
  id: string;
  title: string;
  reason: string;
}

export interface SourceSelectionRow {
  source: string;
  name: string;
  category: string;
  used: boolean;
  reason: string;
}

export interface AuditRecord {
  tool: string;
  /** ISO 8601 timestamp when the tool invocation began (query start time, not completion time) */
  timestamp: string;
  query: Record<string, unknown>;
  sources_queried: SourceAudit[];
  /** Full source selection table showing all available sources with used/not-used and reason */
  source_selection?: SourceSelectionRow[];
  methodology: string;
  /** Running total of results included across all sources — incremented by addSource() */
  inclusions: number;
  /** Individual exclusion records with reasons — use .length for count. Exclusions track WHY items were dropped; inclusions are just counted since the results array IS the included set */
  exclusions: ExclusionRecord[];
  assumptions: string[];
  warnings: string[];
  output_format: string;
}
