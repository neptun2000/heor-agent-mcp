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

export interface AuditRecord {
  tool: string;
  timestamp: string;
  query: Record<string, unknown>;
  sources_queried: SourceAudit[];
  methodology: string;
  inclusions: number;
  exclusions: ExclusionRecord[];
  assumptions: string[];
  warnings: string[];
  output_format: string;
}
