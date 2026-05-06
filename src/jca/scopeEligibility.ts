/**
 * EU JCA scope eligibility checker.
 *
 * Per Regulation (EU) 2021/2282, JCA scope is phased:
 *   • From 12 January 2025: oncology medicinal products + ATMPs with
 *     new active substances.
 *   • From 13 January 2028: orphan medicinal products added.
 *   • From 13 January 2030: all new medicinal products.
 *
 * Therefore, a request to produce a JCA PICO matrix for, e.g.,
 * dapagliflozin in HFrEF (cardiovascular, small molecule) is asking
 * for something that does not exist today and won't until 2030.
 *
 * This module exposes a pure function the `jca_pico_scope` tool calls
 * before producing any output, so the tool can:
 *   (a) refuse to produce a fabricated JCA matrix when the indication
 *       is not in scope, AND
 *   (b) explain the scope rule, the canonical Regulation reference,
 *       and the year the indication WILL be in scope.
 *
 * This closes the gap that Claude.ai surfaced during the management
 * benchmark — Claude.ai dynamically discovered the JCA scope reality
 * via web search; HEORAgent now has it baked in.
 *
 * See design log #16.
 */
import type { IndicationCategory } from "./types.js";

export type DrugClassForScope =
  | "monoclonal_antibody"
  | "small_molecule"
  | "atmp_cell"
  | "atmp_gene"
  | "atmp_tissue"
  | "biosimilar"
  | "vaccine"
  | "radiopharmaceutical"
  | "other";

export interface ScopeEligibility {
  /** True if the indication-drug-class combo is currently in JCA scope. */
  in_scope: boolean;
  /** Year (Jan 13) the combo enters JCA scope per Reg 2021/2282. */
  in_scope_from_year: 2025 | 2028 | 2030;
  /** Phase that gates scope entry. */
  phase: "oncology_atmp" | "orphan" | "all_medicinal";
  /** Human-readable explanation suitable for surfacing in tool output. */
  explanation: string;
  /** Canonical Regulation references. */
  references: string[];
}

/**
 * Determine whether a drug-indication combo is currently in JCA scope.
 *
 * Inputs are the same shape `jca_pico_scope` already collects, so the
 * tool can call this with no schema change. The optional `is_orphan`
 * flag tells us whether the product is orphan-designated; when omitted,
 * we conservatively assume not orphan so the function never falsely
 * places a combo in 2028 scope.
 */
export function checkScopeEligibility(args: {
  indication_category: IndicationCategory;
  drug_class: DrugClassForScope;
  is_orphan?: boolean;
}): ScopeEligibility {
  const refs = [
    "Regulation (EU) 2021/2282 (HTA Regulation), Article 7 — phased scope.",
    "EU Implementing Regulation 2024/1381 — JCA procedural rules.",
    "European Commission factsheet, JCA for Medicinal Products (Jan 2025): https://health.ec.europa.eu/document/download/ced91156-ffe1-472d-85eb-aa6a91dd707e_en?filename=hta_htar_factsheet-jca_en.pdf",
  ];

  // Phase 1 (in scope NOW, since 12 Jan 2025): oncology medicinal
  // products + ATMP-class drugs (cell, gene, tissue) with new
  // active substances.
  const isOncology =
    args.indication_category === "oncology_nsclc" ||
    args.indication_category === "oncology_other";
  const isAtmp =
    args.drug_class === "atmp_cell" ||
    args.drug_class === "atmp_gene" ||
    args.drug_class === "atmp_tissue";
  if (isOncology || isAtmp) {
    return {
      in_scope: true,
      in_scope_from_year: 2025,
      phase: "oncology_atmp",
      explanation:
        "In JCA scope since 12 January 2025 (Phase 1: oncology medicinal products + ATMPs with new active substances).",
      references: refs,
    };
  }

  // Phase 2 (in scope from 13 Jan 2028): orphan-designated medicinal
  // products. We treat this conservatively — only flag in-scope=true
  // for orphan when the user explicitly sets is_orphan AND we're
  // already past 2028. Since we can't predict the future, we always
  // return out-of-scope today but with the right "in_scope_from_year".
  if (args.is_orphan === true) {
    return {
      in_scope: false,
      in_scope_from_year: 2028,
      phase: "orphan",
      explanation:
        "Orphan-designated medicinal products enter JCA scope from 13 January 2028 (Phase 2 of Reg 2021/2282). Until then, this indication is assessed at the national level only — produce a consolidated national-HTA PICO matrix instead.",
      references: refs,
    };
  }

  // Phase 3 (in scope from 13 Jan 2030): all new medicinal products.
  return {
    in_scope: false,
    in_scope_from_year: 2030,
    phase: "all_medicinal",
    explanation:
      "Cardiovascular, metabolic, respiratory, neurology, infectious disease, rheumatology, IBD, and other non-oncology / non-ATMP indications enter JCA scope from 13 January 2030 (Phase 3 of Reg 2021/2282). Until then, this indication is assessed at the national level only — produce a consolidated national-HTA PICO matrix instead.",
    references: refs,
  };
}
