// heor-agent-mcp/src/governance/crosswalk.ts

/** The ten ELEVATE-GenAI reporting domains, verbatim from arXiv 2501.12394 Table 1. */
export const ELEVATE_VERIFIED_DOMAINS = [
  "Model Characteristics",
  "Accuracy Assessment",
  "Comprehensiveness Assessment",
  "Factuality Verification",
  "Reproducibility Protocols and Generalizability",
  "Robustness Checks",
  "Fairness and Bias",
  "Deployment Context and Efficiency Metrics",
  "Calibration and Uncertainty",
  "Security and Privacy",
] as const;

/** Model-evaluation domains this governance tool deliberately does NOT score. */
export const UNSCORED_DOMAINS = [
  "Robustness Checks",
  "Deployment Context and Efficiency Metrics",
  "Calibration and Uncertainty",
] as const;

export type DimensionKey =
  | "transparency"
  | "citation_validation"
  | "human_oversight"
  | "phi_data_handling"
  | "bias_equity"
  | "auditability";

export interface CrosswalkEntry {
  key: DimensionKey;
  label: string;
  elevate_refs: string[];
  /** Set only when the dimension is not a 1:1 ELEVATE domain. */
  derivation_note?: string;
  /** "Is the safeguard in place?" phrasing used to collect the probe. */
  probe_question: string;
  /** Standard fix shown as recommended_mitigation when rag !== green. */
  remediation: string;
}

export const DIMENSION_ORDER: DimensionKey[] = [
  "transparency",
  "citation_validation",
  "human_oversight",
  "phi_data_handling",
  "bias_equity",
  "auditability",
];

export const CROSSWALK: Record<DimensionKey, CrosswalkEntry> = {
  transparency: {
    key: "transparency",
    label: "Transparency & disclosure",
    elevate_refs: ["Model Characteristics"],
    probe_question:
      "Is AI assistance disclosed in the output — model used, prompts/sources, and a human-review note?",
    remediation:
      "Append an ISPOR ELEVATE-GenAI disclosure block (model, sources, human-review note) to every AI-assisted output.",
  },
  citation_validation: {
    key: "citation_validation",
    label: "Citation validation",
    elevate_refs: [
      "Factuality Verification",
      "Accuracy Assessment",
      "Comprehensiveness Assessment",
    ],
    probe_question:
      "Are AI-produced claims and citations verified against primary sources (e.g. automated link/source validation)?",
    remediation:
      "Validate every AI-produced citation/URL against the primary source before use; flag and remove hallucinated references.",
  },
  human_oversight: {
    key: "human_oversight",
    label: "Human-in-the-loop oversight",
    elevate_refs: ["Factuality Verification", "Accuracy Assessment"],
    derivation_note:
      "Derived from ELEVATE Factuality Verification / Accuracy Assessment plus the HTAi Community-of-Practice human-oversight principle; ELEVATE has no standalone oversight domain.",
    probe_question:
      "Does a named human review every AI-generated claim before it is used in a dossier or decision?",
    remediation:
      "Require a named human reviewer to sign off on every AI-generated claim before it enters a dossier or decision.",
  },
  phi_data_handling: {
    key: "phi_data_handling",
    label: "PHI & data handling",
    elevate_refs: ["Security and Privacy"],
    probe_question:
      "Is patient-identifiable data kept out of unregulated AI systems and otherwise protected?",
    remediation:
      "Keep patient-identifiable data out of unregulated AI tools; use BYOK / in-tenant inference and document the data flow.",
  },
  bias_equity: {
    key: "bias_equity",
    label: "Bias & equity",
    elevate_refs: ["Fairness and Bias"],
    probe_question:
      "Are subgroup/equity effects and training-data bias considered and documented?",
    remediation:
      "Assess subgroup/equity impact and training-data representativeness; document limitations.",
  },
  auditability: {
    key: "auditability",
    label: "Auditability & reproducibility",
    elevate_refs: ["Reproducibility Protocols and Generalizability"],
    probe_question:
      "Is there a reproducible audit trail (inputs, sources, tool/model versions, timestamp)?",
    remediation:
      "Record a reproducible audit trail (inputs, sources, tool/model versions, timestamp) for every run.",
  },
};
