// heor-agent-mcp/src/review/dossierScan.ts
/**
 * Deterministic gap/risk scan over a dossier for hta.review_simulation.
 * Each detector inspects the available signals (joined dossier text, PICO,
 * whether an economic model is present) and decides whether its category
 * "fires" and at what severity. Fired categories become clarification
 * questions in the handler. Design log #38.
 */
import type {
  CategoryKey,
  ReviewBody,
  Severity,
} from "./clarificationTaxonomy.js";

export interface ScanInput {
  hta_body: ReviewBody;
  drug: string;
  indication: string;
  /** Lowercased, joined dossier text (markdown + structured sections). */
  text: string;
  pico?: {
    population?: string;
    intervention?: string;
    comparator?: string;
    outcomes?: string;
  };
  hasModel: boolean;
}

export interface DetectorHit {
  key: CategoryKey;
  severity: Severity;
  locator: string;
  vars: Record<string, string>;
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((n) => text.includes(n));
}

function detectComparator(input: ScanInput): DetectorHit | null {
  const c = input.pico?.comparator?.trim();
  if (!c) {
    return {
      key: "comparator",
      severity: "critical",
      locator: "PICO comparator",
      vars: { comparator: "the comparator (none was specified in the PICO)" },
    };
  }
  return {
    key: "comparator",
    severity: "standard",
    locator: "PICO comparator",
    vars: { comparator: c },
  };
}

function detectIndirectComparison(input: ScanInput): DetectorHit | null {
  const c = input.pico?.comparator?.trim();
  if (!c) return null; // an ITC is only required when comparing to something
  const itcTerms = [
    "itc",
    "indirect",
    "nma",
    "network meta",
    "bucher",
    "maic",
    "matching-adjusted",
    "matching adjusted",
    "stc",
    "simulated treatment",
    "ml-nmr",
  ];
  if (!hasAny(input.text, itcTerms)) {
    return {
      key: "indirect_comparison",
      severity: "critical",
      locator: "ITC/NMA section",
      vars: { comparator: c },
    };
  }
  const assumptionTerms = [
    "exchangeab",
    "consistency",
    "homogeneit",
    "proportional hazards",
    "similarity",
    "shared comparator",
    "common comparator",
  ];
  if (!hasAny(input.text, assumptionTerms)) {
    return {
      key: "indirect_comparison",
      severity: "standard",
      locator: "ITC/NMA section",
      vars: { comparator: c },
    };
  }
  return null;
}

function detectSurvivalExtrapolation(input: ScanInput): DetectorHit | null {
  const hay = `${input.text} ${input.indication.toLowerCase()}`;
  const survivalContext = [
    "surviv",
    "overall survival",
    "progression-free",
    " pfs ",
    " os ",
    "kaplan",
    "time-to-event",
    "time to event",
    "oncolog",
    "cancer",
    "carcinoma",
    "tumour",
    "tumor",
    "melanoma",
    "lymphoma",
    "leukaemia",
    "leukemia",
    "metasta",
  ];
  if (!hasAny(hay, survivalContext)) return null;
  const extrapolationTerms = [
    "extrapolat",
    "parametric",
    "weibull",
    "log-logistic",
    "loglogistic",
    "log-normal",
    "lognormal",
    "gompertz",
    "spline",
    "tsd 14",
    "tsd14",
    "exponential",
    "generalised gamma",
    "generalized gamma",
  ];
  if (!hasAny(input.text, extrapolationTerms)) {
    return {
      key: "survival_extrapolation",
      severity: "standard",
      locator: "survival extrapolation",
      vars: {},
    };
  }
  return null;
}

function detectClinicalRob(input: ScanInput): DetectorHit | null {
  const robTerms = [
    "single-arm",
    "single arm",
    "surrogate",
    "open-label",
    "open label",
    "unanchored",
  ];
  const found = robTerms.find((t) => input.text.includes(t));
  if (found) {
    return {
      key: "clinical_rob",
      severity: "standard",
      locator: found,
      vars: { term: found },
    };
  }
  return null;
}

function detectEconomicModel(input: ScanInput): DetectorHit | null {
  const econTerms = [
    "icer",
    "cost-effectiveness",
    "cost effectiveness",
    "markov",
    "partitioned survival",
    "qaly",
    "cost-utility",
    "cost utility",
  ];
  const econPresent = input.hasModel || hasAny(input.text, econTerms);
  if (!econPresent) {
    return {
      key: "economic_model",
      severity: "critical",
      locator: "economic section",
      vars: {},
    };
  }
  const structureTerms = [
    "half-cycle",
    "half cycle",
    "time horizon",
    "cycle length",
    "discount",
  ];
  if (!hasAny(input.text, structureTerms)) {
    return {
      key: "economic_model",
      severity: "standard",
      locator: "economic model structure",
      vars: {},
    };
  }
  return null;
}

function detectUtilities(input: ScanInput): DetectorHit | null {
  const eq5d5l = hasAny(input.text, [
    "eq-5d-5l",
    "eq-5d 5l",
    "eq5d-5l",
    "eq-5d5l",
  ]);
  if (
    eq5d5l &&
    !hasAny(input.text, ["value set", "crosswalk", "cross-walk", "dsu", "3l"])
  ) {
    return {
      key: "utilities",
      severity: "standard",
      locator: "utilities (EQ-5D-5L value set)",
      vars: {},
    };
  }
  if (
    input.hasModel &&
    !hasAny(input.text, [
      "utilit",
      "eq-5d",
      "eq5d",
      "health-state utilit",
      "health state utilit",
    ])
  ) {
    return {
      key: "utilities",
      severity: "standard",
      locator: "utilities",
      vars: {},
    };
  }
  return null;
}

function detectUncertainty(input: ScanInput): DetectorHit | null {
  const econTerms = [
    "icer",
    "markov",
    "cost-effectiveness",
    "cost effectiveness",
    "qaly",
    "partitioned survival",
  ];
  const modelPresent = input.hasModel || hasAny(input.text, econTerms);
  if (!modelPresent) return null;
  const uncertaintyTerms = [
    "psa",
    "probabilistic",
    "scenario analysis",
    "sensitivity analysis",
    "deterministic sensitivity",
    "owsa",
    "ceac",
    "credible interval",
    "tornado",
  ];
  if (!hasAny(input.text, uncertaintyTerms)) {
    return {
      key: "uncertainty",
      severity: "standard",
      locator: "uncertainty analysis",
      vars: {},
    };
  }
  return null;
}

function detectSubgroups(input: ScanInput): DetectorHit | null {
  if (hasAny(input.text, ["post-hoc", "post hoc"])) {
    return {
      key: "subgroups",
      severity: "standard",
      locator: "subgroup analysis",
      vars: {},
    };
  }
  if (
    input.text.includes("subgroup") &&
    !hasAny(input.text, [
      "pre-specified",
      "prespecified",
      "pre-specif",
      "prespecif",
    ])
  ) {
    return {
      key: "subgroups",
      severity: "minor",
      locator: "subgroup analysis",
      vars: {},
    };
  }
  return null;
}

function detectRwe(input: ScanInput): DetectorHit | null {
  const rweTerms = [
    "real-world",
    "real world",
    "rwe",
    "registry",
    "claims data",
    "observational cohort",
    "observational study",
  ];
  if (
    hasAny(input.text, rweTerms) &&
    !hasAny(input.text, [
      "provenance",
      "generalis",
      "generaliz",
      "representative",
      "data quality",
      "data linkage",
    ])
  ) {
    return {
      key: "rwe",
      severity: "standard",
      locator: "real-world evidence",
      vars: {},
    };
  }
  return null;
}

function detectInnovation(input: ScanInput): DetectorHit | null {
  if (input.hta_body === "nice") {
    if (
      !hasAny(input.text, [
        "innovation",
        "unmet need",
        "step change",
        "step-change",
      ])
    ) {
      return {
        key: "innovation",
        severity: "minor",
        locator: "innovation / unmet need",
        vars: {},
      };
    }
    return null;
  }
  // gba_iqwig
  if (
    !hasAny(input.text, [
      "added benefit",
      "zusatznutzen",
      "ausmaß",
      "extent of added benefit",
    ])
  ) {
    return {
      key: "innovation",
      severity: "standard",
      locator: "added benefit (Zusatznutzen)",
      vars: {},
    };
  }
  return null;
}

const DETECTORS: Array<(input: ScanInput) => DetectorHit | null> = [
  detectComparator,
  detectIndirectComparison,
  detectSurvivalExtrapolation,
  detectClinicalRob,
  detectEconomicModel,
  detectUtilities,
  detectUncertainty,
  detectSubgroups,
  detectRwe,
  detectInnovation,
];

export function scanDossier(input: ScanInput): DetectorHit[] {
  const hits: DetectorHit[] = [];
  for (const detector of DETECTORS) {
    const hit = detector(input);
    if (hit) hits.push(hit);
  }
  return hits;
}
