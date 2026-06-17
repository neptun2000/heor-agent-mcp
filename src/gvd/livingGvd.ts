/**
 * Pure Living-GVD diff logic. No I/O.
 *
 * Compares a GVD manifest's per-section snapshot values against the current
 * claim registry and classifies each section: current (all referenced
 * claims unchanged), stale (≥1 changed), or claim_missing (a referenced
 * claim no longer exists). Returns the regenerate-only list.
 */
import type { Claim } from "../claims/types.js";
import type {
  GvdManifest,
  LivingGvdDiff,
  SectionDiff,
  SectionManifest,
} from "./types.js";

/** Canonical value of a claim for snapshotting/diffing. */
export function claimValue(claim: Claim): number | string | null {
  if (typeof claim.numeric_value === "number") return claim.numeric_value;
  if (claim.value_display) return claim.value_display;
  return null;
}

function valuesEqual(
  a: number | string | null,
  b: number | string | null,
): boolean {
  if (typeof a === "number" && typeof b === "number") {
    if (a === b) return true;
    const denom = Math.max(Math.abs(a), Math.abs(b), 1);
    return Math.abs(a - b) / denom <= 0.005; // 0.5%, matches consistency check
  }
  return a === b;
}

function diffSection(
  section: SectionManifest,
  claimsById: Map<string, Claim>,
): SectionDiff {
  const changed_claims: SectionDiff["changed_claims"] = [];
  const missing_claims: string[] = [];

  for (const id of section.claim_ids) {
    const claim = claimsById.get(id);
    if (!claim) {
      missing_claims.push(id);
      continue;
    }
    const oldVal = section.snapshot_values[id] ?? null;
    const newVal = claimValue(claim);
    if (!valuesEqual(oldVal, newVal) || claim.status === "superseded") {
      changed_claims.push({ claim_id: id, old: oldVal, new: newVal });
    }
  }

  let status: SectionDiff["status"] = "current";
  if (missing_claims.length > 0) status = "claim_missing";
  else if (changed_claims.length > 0) status = "stale";

  return { name: section.name, status, changed_claims, missing_claims };
}

export function diffLivingGvd(
  manifest: GvdManifest,
  claims: Claim[],
): LivingGvdDiff {
  const claimsById = new Map(claims.map((c) => [c.id, c]));
  const sections = manifest.sections.map((s) => diffSection(s, claimsById));

  const stale = sections.filter((s) => s.status !== "current");
  const current_count = sections.length - stale.length;
  const regenerate = stale.map((s) => s.name);

  const warnings: string[] = [];
  if (stale.length > 0) {
    warnings.push(
      `${stale.length} section(s) are stale — regenerate only these; the rest are current. This is the diff, not the regeneration: run hta.dossier for the listed sections, then snapshot again.`,
    );
  } else {
    warnings.push(
      "All sections current — no regeneration needed; the GVD is in sync with the claim registry.",
    );
  }
  const missing = sections.filter((s) => s.missing_claims.length > 0);
  if (missing.length > 0) {
    warnings.push(
      `${missing.length} section(s) reference claims no longer in the registry — confirm those figures were intentionally removed or superseded.`,
    );
  }

  return {
    total_sections: sections.length,
    current_count,
    stale_count: stale.length,
    sections,
    regenerate,
    warnings,
  };
}
