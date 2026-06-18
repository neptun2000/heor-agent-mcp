/**
 * Pure cross-deliverable consistency checker. No I/O.
 *
 * For each registered claim × each deliverable, decides whether the claim
 * appears consistently, has drifted (a DIFFERENT number sits next to the
 * claim's keywords), or is absent. Deterministic: locates the claim by its
 * keywords, extracts nearby numbers, and compares to the canonical value.
 */
import type {
  Claim,
  ClaimDeliverableFinding,
  ConsistencyResult,
  DeliverableInput,
} from "./types.js";

/** ±N characters around a keyword hit to scan for a number. */
const WINDOW = 70;

/** Parse a numeric token (currency/commas/%/whitespace tolerated) → number | null. */
export function parseNumber(token: string): number | null {
  const cleaned = token.replace(/[,\s$£€%]/g, "").replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const NUMBER_RE = /-?[£$€]?\s?\d[\d,]*(?:\.\d+)?\s?%?/g;

function numbersNear(text: string, keyword: string): { raw: string; value: number }[] {
  const lowerText = text.toLowerCase();
  const kw = keyword.toLowerCase();
  const out: { raw: string; value: number }[] = [];
  let from = 0;
  for (;;) {
    const idx = lowerText.indexOf(kw, from);
    if (idx === -1) break;
    const start = Math.max(0, idx - WINDOW);
    const end = Math.min(text.length, idx + kw.length + WINDOW);
    const window = text.slice(start, end);
    const matches = window.match(NUMBER_RE) ?? [];
    for (const m of matches) {
      const v = parseNumber(m);
      if (v !== null) out.push({ raw: m.trim(), value: v });
    }
    from = idx + kw.length;
  }
  return out;
}

/** Two numbers are "equal" within a small relative tolerance (exact for integers). */
function numbersEqual(a: number, b: number): boolean {
  if (a === b) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / denom <= 0.005; // 0.5%
}

function hasAnyKeyword(text: string, claim: Claim): boolean {
  const lower = text.toLowerCase();
  return claim.keywords.some((k) => k.trim() && lower.includes(k.trim().toLowerCase()));
}

function checkClaimInDeliverable(
  claim: Claim,
  deliverable: DeliverableInput,
): ClaimDeliverableFinding {
  const keywordHit = hasAnyKeyword(deliverable.text, claim);

  // Qualitative claim (no numeric value): presence by keyword is all we check.
  if (typeof claim.numeric_value !== "number") {
    if (keywordHit) {
      return {
        claim_id: claim.id,
        deliverable: deliverable.name,
        status: "consistent",
        conflicting_values: [],
        note: "Qualitative claim — keyword(s) present; verify wording manually.",
      };
    }
    return {
      claim_id: claim.id,
      deliverable: deliverable.name,
      status: "absent",
      conflicting_values: [],
      note: "Claim keywords not found in this deliverable.",
    };
  }

  if (!keywordHit) {
    return {
      claim_id: claim.id,
      deliverable: deliverable.name,
      status: "absent",
      conflicting_values: [],
      note: "Claim keywords not found — claim does not appear in this deliverable.",
    };
  }

  // Keyword present → look for numbers near it and compare to canonical.
  const found = claim.keywords.flatMap((k) => numbersNear(deliverable.text, k));
  if (found.length === 0) {
    return {
      claim_id: claim.id,
      deliverable: deliverable.name,
      status: "consistent",
      conflicting_values: [],
      note: "Keyword present but no adjacent number found — verify the value is stated.",
    };
  }

  const matches = found.filter((f) => numbersEqual(f.value, claim.numeric_value as number));
  if (matches.length > 0) {
    // Canonical value found; report any conflicting numbers as drift too.
    const conflicts = dedupeRaw(
      found.filter((f) => !numbersEqual(f.value, claim.numeric_value as number)),
    );
    if (conflicts.length > 0) {
      return {
        claim_id: claim.id,
        deliverable: deliverable.name,
        status: "drift",
        conflicting_values: conflicts,
        note: `Canonical value present but conflicting number(s) also appear near the keyword: ${conflicts.join(", ")} (canonical: ${claim.value_display ?? claim.numeric_value}).`,
      };
    }
    return {
      claim_id: claim.id,
      deliverable: deliverable.name,
      status: "consistent",
      conflicting_values: [],
      note: `Canonical value present (${claim.value_display ?? claim.numeric_value}).`,
    };
  }

  // Keyword present, numbers present, but none match canonical → drift.
  const conflicts = dedupeRaw(found);
  return {
    claim_id: claim.id,
    deliverable: deliverable.name,
    status: "drift",
    conflicting_values: conflicts,
    note: `Canonical value (${claim.value_display ?? claim.numeric_value}) NOT found; conflicting number(s) near keyword: ${conflicts.join(", ")}.`,
  };
}

function dedupeRaw(items: { raw: string; value: number }[]): string[] {
  const seen = new Set<number>();
  const out: string[] = [];
  for (const i of items) {
    if (!seen.has(i.value)) {
      seen.add(i.value);
      out.push(i.raw);
    }
  }
  return out;
}

export function checkConsistency(
  claims: Claim[],
  deliverables: DeliverableInput[],
): ConsistencyResult {
  const findings: ClaimDeliverableFinding[] = [];
  for (const claim of claims) {
    for (const d of deliverables) {
      findings.push(checkClaimInDeliverable(claim, d));
    }
  }

  const drift = findings.filter((f) => f.status === "drift");
  const absent = findings.filter((f) => f.status === "absent");
  const drifting_claims = [...new Set(drift.map((f) => f.claim_id))];

  const warnings: string[] = [];
  if (drift.length > 0) {
    warnings.push(
      `${drift.length} drift finding(s) across ${drifting_claims.length} claim(s) — a different value sits next to the claim keyword in at least one deliverable. Reconcile to the canonical source before release.`,
    );
  }
  if (claims.length === 0) {
    warnings.push("No claims supplied — nothing to check.");
  }
  if (deliverables.length === 0) {
    warnings.push("No deliverables supplied — nothing to check.");
  }
  warnings.push(
    "Detection is keyword-anchored and numeric — it flags drifting numbers near claim keywords, not paraphrased or unanchored claims. A 'consistent' result is necessary but not sufficient; human review remains required.",
  );

  return {
    claims_checked: claims.length,
    deliverables_checked: deliverables.length,
    findings,
    drift_count: drift.length,
    absent_count: absent.length,
    drifting_claims,
    warnings,
  };
}
