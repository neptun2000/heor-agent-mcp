/**
 * Types for hta.living_gvd — a Living Global Value Dossier as a diffable
 * artifact.
 *
 * A GVD section is built from one or more registry claims. The manifest
 * records, per section, which claims it uses and the value each claim had
 * at generation time (the snapshot). On refresh the snapshot is diffed
 * against the live claim registry by value, so only sections whose
 * underlying figures changed are flagged for regeneration. See design log #24.
 */

export interface SectionManifest {
  name: string;
  claim_ids: string[];
  /** Claim value captured at snapshot time, keyed by claim id. null = unset/qualitative. */
  snapshot_values: Record<string, number | string | null>;
  generated_at: string;
}

export interface GvdManifest {
  schema_version: "1.0";
  project_id: string;
  sections: SectionManifest[];
  generated_at: string;
}

export type SectionStatus = "current" | "stale" | "claim_missing";

export interface SectionDiff {
  name: string;
  status: SectionStatus;
  changed_claims: {
    claim_id: string;
    old: number | string | null;
    new: number | string | null;
  }[];
  missing_claims: string[];
}

export interface LivingGvdDiff {
  total_sections: number;
  current_count: number;
  stale_count: number;
  sections: SectionDiff[];
  /** Section names to regenerate (stale or claim_missing). */
  regenerate: string[];
  warnings: string[];
}
