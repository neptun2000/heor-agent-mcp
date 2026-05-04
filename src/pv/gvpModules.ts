/**
 * EMA Good Pharmacovigilance Practices (GVP) module + ENCePP template
 * mapping per category. Source of truth: EMA GVP Rev 4.
 *
 * If EMA publishes Rev 5, bump GVP_REVISION + add a regression test that
 * loads a known scenario and asserts the new module reference.
 */
import type { GvpModule, PvCategory } from "./types.js";

export const GVP_REVISION = "rev_4" as const;

interface CategoryMapping {
  gvp_module: GvpModule;
  encepp_protocol_template?: string;
  rmp_implications: string[];
  fda_analogue?: string;
  submission_obligations: string[];
}

export const CATEGORY_MAPPING: Record<PvCategory, CategoryMapping> = {
  PASS_imposed: {
    gvp_module: "VIII",
    encepp_protocol_template: "ENCePP-PASS-001",
    rmp_implications: [
      "Update RMP Part III (PV Plan) to list this study as an imposed PASS.",
      "Annex 4 of the RMP must reference the protocol and timelines.",
    ],
    fda_analogue: "FDA Postmarketing Required Studies (PMR)",
    submission_obligations: [
      "Protocol submission to PRAC for review prior to study start (Article 107n).",
      "Annual safety update reports during conduct.",
      "Final study report within 12 months of last data lock.",
    ],
  },
  PASS_voluntary: {
    gvp_module: "VIII",
    encepp_protocol_template: "ENCePP-PASS-002",
    rmp_implications: [
      "Document study as a voluntary PASS in RMP Part III.",
      "No PRAC pre-approval required; encouraged ENCePP registration.",
    ],
    fda_analogue: "FDA Postmarketing Commitment (PMC)",
    submission_obligations: [
      "Voluntary protocol notification to EMA EUPAS register.",
      "Final study report when results available.",
    ],
  },
  PAES: {
    gvp_module: "VIII",
    encepp_protocol_template: "ENCePP-PAES-001",
    rmp_implications: [
      "PAES results may trigger MA variation if effectiveness diverges from MA assumptions.",
    ],
    fda_analogue: "FDA Postmarketing Required Effectiveness Studies",
    submission_obligations: [
      "Protocol submission for PRAC review when imposed.",
      "Periodic interim reports per MA condition.",
    ],
  },
  RMP_Annex_4_study: {
    gvp_module: "V",
    encepp_protocol_template: "ENCePP-RMP-001",
    rmp_implications: [
      "Listed in RMP Annex 4 with study ID, status, milestone dates.",
      "Study completion is a tracked RMP commitment.",
    ],
    fda_analogue: "FDA REMS Assessment Study",
    submission_obligations: [
      "Inclusion in every RMP update submitted to EMA.",
      "Status reporting at PSUR cycles.",
    ],
  },
  DUS: {
    gvp_module: "VIII_Addendum_I",
    encepp_protocol_template: "ENCePP-DUS-001",
    rmp_implications: [
      "DUS may be referenced in RMP Part III for risk minimisation effectiveness.",
    ],
    fda_analogue: "FDA Sentinel-eligible drug utilisation analysis",
    submission_obligations: [
      "ENCePP registration encouraged but not mandatory.",
      "Final report submission per local jurisdiction requirements.",
    ],
  },
  active_surveillance_registry: {
    gvp_module: "VIII",
    encepp_protocol_template: "ENCePP-REG-001",
    rmp_implications: [
      "Registry serves as data source for ongoing PV signal detection in RMP Part III.",
    ],
    fda_analogue: "FDA Sentinel / FAERS-linked registry",
    submission_obligations: [
      "Annual registry status report.",
      "Periodic data linkages reported via PSUR.",
    ],
  },
  pregnancy_registry: {
    gvp_module: "VIII",
    encepp_protocol_template: "ENCePP-PREG-001",
    rmp_implications: [
      "Pregnancy registry is a standard RMP commitment for teratogenic-risk drugs (Annex 4).",
      "Outcomes feed into the Pregnancy section of every PSUR.",
    ],
    fda_analogue: "FDA Pregnancy Exposure Registry",
    submission_obligations: [
      "ENCePP and EUPAS registration.",
      "Annual or biennial enrolment + outcomes reports to PRAC.",
      "FDA pregnancy-registry standards apply when US is in scope.",
    ],
  },
  spontaneous_reporting_only: {
    gvp_module: "VI",
    rmp_implications: [
      "Spontaneous reporting is the baseline PV obligation under GVP Module VI; not a designed study.",
    ],
    fda_analogue: "FDA FAERS",
    submission_obligations: [
      "ICSR submission to EudraVigilance per Module VI timelines.",
      "PSUR cycle compliance.",
    ],
  },
  ICH_E2E_pharmacovigilance_plan: {
    gvp_module: "V",
    rmp_implications: [
      "Pre-authorisation PV planning per ICH E2E feeds directly into the initial RMP submitted at MAA.",
    ],
    fda_analogue: "FDA premarket Pharmacovigilance Plan (per 21 CFR 314.81)",
    submission_obligations: [
      "PV plan included in module 1.8.2 of the MAA dossier.",
      "Conversion to full RMP at MA grant.",
    ],
  },
  not_pv_study: {
    gvp_module: "VIII",
    rmp_implications: [
      "Study does not qualify as a pharmacovigilance study under EMA GVP definitions.",
    ],
    fda_analogue: "n/a",
    submission_obligations: [
      "No PV-specific submission obligations identified.",
    ],
  },
};

export function gvpFor(category: PvCategory): CategoryMapping {
  return CATEGORY_MAPPING[category];
}
