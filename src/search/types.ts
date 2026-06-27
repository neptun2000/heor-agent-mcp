export type StrandId = "economic" | "clinical" | "hrqol" | "epidemiology";
export type Database = "embase" | "pubmed";

export interface FilterProvenance {
  source: string;
  url: string;
  citation: string;
  templateUrl?: string;
}

export interface FilterBlock {
  id: string;
  strand?: StrandId;
  database: Database;
  /** One or more term lines; OR-combined within the block when >1. */
  lines: string[];
  provenance: FilterProvenance;
}

export interface StrategyInput {
  conceptLines: string[];
  strandFilter: string[];
  exclusionLines: string[];
  ageLimit?: string;
  dateLimit?: string;
  languageLimit?: string;
}

export interface NumberedLine {
  n: number;
  query: string;
  count?: number;
}

export interface AssembledStrategy {
  lines: NumberedLine[];
  finalLineNumber: number;
}