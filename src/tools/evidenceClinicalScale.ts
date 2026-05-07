/**
 * evidence.clinical_scale — Neurology & cognitive outcome scale scoring suite.
 *
 * Covers: UMSARS (MSA), UPDRS, MDS-UPDRS (Parkinson's), ADAS-Cog,
 * MoCA, MMSE (Alzheimer's / cognitive). Implements per-scale scoring,
 * MCID-based responder analysis, and trajectory comparison against
 * natural-history reference cohorts (summary-level, v1).
 *
 * Design log #19 | HEORAgent v1.5.
 */

import { z } from "zod";

// ── Zod schemas ────────────────────────────────────────────────────────────

const ScaleEnum = z.enum([
  "umsars",
  "updrs",
  "mds_updrs",
  "adas_cog",
  "moca",
  "mmse",
]);

const ScaleItemSchema = z.object({
  part: z
    .string()
    .describe("Scale part identifier, e.g. 'I', 'II', 'III', 'IV'"),
  item_id: z
    .string()
    .describe("Item identifier within the part, e.g. '1', '2', ...'12'"),
  score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("Item score (range depends on scale and item)"),
});

export const evidenceClinicalScaleSchema = z.object({
  scale: ScaleEnum.describe(
    "Clinical outcome scale: umsars | updrs | mds_updrs | adas_cog | moca | mmse",
  ),
  items: z
    .array(ScaleItemSchema)
    .min(1)
    .describe(
      "Per-item scores. Supply all items for complete scoring, or a subset for partial scoring with a note.",
    ),
  baseline_items: z
    .array(ScaleItemSchema)
    .optional()
    .describe(
      "Optional: baseline scores for change-from-baseline and responder analysis.",
    ),
  compare_cohort: z
    .enum(["nnipps", "ppmi", "adni", "none"])
    .optional()
    .default("none")
    .describe(
      "Natural-history reference cohort for trajectory comparison. nnipps=MSA, ppmi=PD, adni=AD.",
    ),
  time_point_months: z
    .number()
    .optional()
    .describe(
      "Time point in months from baseline (used for trajectory comparison).",
    ),
});

export type EvidenceClinicalScaleParams = z.infer<
  typeof evidenceClinicalScaleSchema
>;

// ── Scale definitions ──────────────────────────────────────────────────────

interface PartConfig {
  items: number;
  maxPerItem: number;
  label: string;
}

interface ScaleConfig {
  name: string;
  fullName: string;
  parts: Record<string, PartConfig>;
  maxTotal: number;
  mcid: { value: number; source: string; direction: "decrease" | "increase" };
  cutoffs?: Array<{
    threshold: number;
    label: string;
    direction: "above" | "below";
  }>;
  referenceNote: string;
}

const SCALE_CONFIGS: Record<string, ScaleConfig> = {
  umsars: {
    name: "UMSARS",
    fullName: "Unified Multiple System Atrophy Rating Scale",
    parts: {
      I: {
        items: 12,
        maxPerItem: 4,
        label: "Historical review (ADL)",
      },
      II: {
        items: 14,
        maxPerItem: 4,
        label: "Motor examination",
      },
      IV: {
        items: 1,
        maxPerItem: 5,
        label: "Global disability (1=independent; 5=totally dependent)",
      },
    },
    maxTotal: 104, // Parts I + II only (Part IV is 1-5 global disability, separate)
    mcid: {
      value: 4.0,
      source:
        "Krismer et al., Mov Disord 2017; UMSARS-II change of ≥3-4 points reported as clinically meaningful in NNIPPS.",
      direction: "decrease",
    },
    referenceNote:
      "Wenning et al., Mov Disord 2004 (development); Krismer et al., Mov Disord 2017 (MCID); NNIPPS natural-history cohort (Bensimon 2009, Lancet Neurol).",
  },
  updrs: {
    name: "UPDRS",
    fullName:
      "Unified Parkinson's Disease Rating Scale (original Fahn & Elton)",
    parts: {
      I: { items: 4, maxPerItem: 4, label: "Mentation, behaviour, mood" },
      II: {
        items: 13,
        maxPerItem: 4,
        label: "Activities of daily living",
      },
      III: { items: 14, maxPerItem: 4, label: "Motor examination" },
      IV: {
        items: 11,
        maxPerItem: 4,
        label: "Complications of therapy",
      },
    },
    maxTotal: 168,
    mcid: {
      value: 5.0,
      source:
        "Schrag et al., Mov Disord 2006; UPDRS-III MCID ≈ 2.3–5.2 points.",
      direction: "decrease",
    },
    referenceNote:
      "Fahn & Elton 1987 (development); Schrag et al., Mov Disord 2006 (MCID); PPMI longitudinal cohort for trajectory reference.",
  },
  mds_updrs: {
    name: "MDS-UPDRS",
    fullName:
      "Movement Disorder Society Unified Parkinson's Disease Rating Scale",
    parts: {
      I: {
        items: 13,
        maxPerItem: 4,
        label: "Non-motor aspects of daily living",
      },
      II: {
        items: 13,
        maxPerItem: 4,
        label: "Motor aspects of daily living (patient-reported)",
      },
      III: {
        items: 18,
        maxPerItem: 4,
        label: "Motor examination (clinician-rated)",
      },
      IV: { items: 6, maxPerItem: 4, label: "Motor complications" },
    },
    maxTotal: 200,
    mcid: {
      value: 4.3,
      source:
        "Horváth et al., Parkinsonism Relat Disord 2015; Part III MCID = 3.25 points for annual progression.",
      direction: "decrease",
    },
    referenceNote:
      "Goetz et al., Mov Disord 2008 (development); Horváth et al., 2015 (MCID); PPMI (parkinson-progression.org).",
  },
  adas_cog: {
    name: "ADAS-Cog",
    fullName:
      "Alzheimer's Disease Assessment Scale – Cognitive Subscale (11-item)",
    parts: {
      cognitive: {
        items: 11,
        maxPerItem: 10,
        label: "Cognitive subscale (items 1-11)",
      },
    },
    maxTotal: 70,
    mcid: {
      value: 4.0,
      source:
        "Schrag & Schott, J Neurol Neurosurg Psychiatry 2012; ADAS-Cog MCID ≈ 3-5 points per 6 months.",
      direction: "increase", // Higher = worse for ADAS-Cog
    },
    cutoffs: [
      { threshold: 12, label: "Mild impairment", direction: "above" },
      { threshold: 25, label: "Moderate impairment", direction: "above" },
    ],
    referenceNote:
      "Mohs et al., Am J Psychiatry 1983 (development, 11-item); Rosen et al. 1984 (scoring); ADNI (adni.loni.usc.edu) for trajectory reference.",
  },
  moca: {
    name: "MoCA",
    fullName: "Montreal Cognitive Assessment",
    parts: {
      total: {
        items: 12,
        maxPerItem: 5,
        label: "Total score (12 domains, 30 points)",
      },
    },
    maxTotal: 30,
    mcid: {
      value: 2.0,
      source:
        "No formal MCID established; raw-point change used with 95% CI. Bennett et al., J Geriatr Psychiatry Neurol 2016 suggest ≥2 points clinically meaningful.",
      direction: "decrease", // Higher = better for MoCA
    },
    cutoffs: [
      { threshold: 26, label: "Normal cognition", direction: "above" },
      {
        threshold: 18,
        label: "Mild cognitive impairment",
        direction: "above",
      },
    ],
    referenceNote:
      "Nasreddine et al., J Am Geriatr Soc 2005; Bennett et al. 2016 (MCID estimate). No single authoritative MCID — flag uncertainty.",
  },
  mmse: {
    name: "MMSE",
    fullName: "Mini-Mental State Examination",
    parts: {
      total: {
        items: 19,
        maxPerItem: 5,
        label: "Total score (30 points max)",
      },
    },
    maxTotal: 30,
    mcid: {
      value: 3.0,
      source:
        "Andrews et al., Acta Psychiatr Scand 2019; MCID ≈ 3 points per year in mild AD.",
      direction: "increase", // Higher = better; a decrease ≥ MCID is worsening (PROGRESSOR)
    },
    cutoffs: [
      { threshold: 24, label: "Normal cognition", direction: "above" },
      { threshold: 18, label: "Moderate impairment", direction: "below" },
      { threshold: 10, label: "Severe impairment", direction: "below" },
    ],
    referenceNote:
      "Folstein et al., J Psychiatr Res 1975 (development); Andrews et al., 2019 (MCID); ADNI for trajectory reference.",
  },
};

// ── Natural-history trajectory reference data (summary-level v1) ──────────

interface CohortReference {
  cohort: string;
  citation: string;
  indication: string;
  scale: string;
  annual_progression_mean: number;
  annual_progression_sd?: number;
  note: string;
}

const COHORT_REFERENCES: CohortReference[] = [
  {
    cohort: "nnipps",
    citation:
      "Bensimon G et al., Lancet Neurol 2009;8:1015-1022 (NNIPPS study, riluzole vs placebo in MSA/PSP).",
    indication: "MSA",
    scale: "umsars",
    annual_progression_mean: 11.2,
    annual_progression_sd: 6.8,
    note: "UMSARS total (Parts I+II) annual progression rate in placebo arm (n=159). Patients had probable MSA-P/C.",
  },
  {
    cohort: "ppmi",
    citation:
      "Parkinson's Progression Markers Initiative (ppmi.org); Marek K et al., Prog Neurobiol 2011.",
    indication: "Parkinson's disease",
    scale: "mds_updrs",
    annual_progression_mean: 6.5,
    annual_progression_sd: 5.2,
    note: "MDS-UPDRS Part III annual progression in de-novo PD, PPMI cohort (mean, early PD). Progression varies by H&Y stage.",
  },
  {
    cohort: "adni",
    citation:
      "Alzheimer's Disease Neuroimaging Initiative (adni.loni.usc.edu); Jack CR et al., Neurobiol Aging 2010.",
    indication: "Alzheimer's disease",
    scale: "adas_cog",
    annual_progression_mean: 7.0,
    annual_progression_sd: 8.0,
    note: "ADAS-Cog-11 annual change in mild-to-moderate AD (MMSE 15-26 at entry). Wide SD reflects heterogeneity.",
  },
  {
    cohort: "adni",
    citation: "ADNI cohort (adni.loni.usc.edu); Crane PK et al., Brain 2012.",
    indication: "Alzheimer's disease",
    scale: "mmse",
    annual_progression_mean: -2.8,
    annual_progression_sd: 3.5,
    note: "MMSE annual change in mild AD (MMSE 20-26). Negative = decline.",
  },
];

// ── Scoring helpers ────────────────────────────────────────────────────────

interface ScaleScore {
  total: number;
  maxTotal: number;
  byPart: Record<
    string,
    { score: number; maxScore: number; itemCount: number }
  >;
  isComplete: boolean;
  missingItems: string[];
}

function scoreScale(
  scale: string,
  items: Array<{ part: string; item_id: string; score: number }>,
): ScaleScore {
  const config = SCALE_CONFIGS[scale];
  const byPart: Record<
    string,
    { score: number; maxScore: number; itemCount: number }
  > = {};
  let total = 0;
  const missingItems: string[] = [];

  for (const [part, partConfig] of Object.entries(config.parts)) {
    let partScore = 0;
    let partCount = 0;
    for (let i = 1; i <= partConfig.items; i++) {
      const found = items.find(
        (it) => it.part === part && it.item_id === String(i),
      );
      if (found) {
        partScore += Math.min(found.score, partConfig.maxPerItem);
        partCount++;
      } else {
        missingItems.push(`${part}-${i}`);
      }
    }
    byPart[part] = {
      score: partScore,
      maxScore: partConfig.items * partConfig.maxPerItem,
      itemCount: partCount,
    };
    // UMSARS Part IV is a global disability rating (1-5), not summed into total
    if (scale !== "umsars" || part !== "IV") {
      total += partScore;
    }
  }

  const isComplete = missingItems.length === 0;

  return { total, maxTotal: config.maxTotal, byPart, isComplete, missingItems };
}

// ── Responder classification ───────────────────────────────────────────────

type ResponderClass = "responder" | "stable" | "progressor";

function classifyResponder(
  scale: string,
  baselineScore: number,
  followupScore: number,
): {
  classification: ResponderClass;
  change: number;
  mcidUsed: number;
  note: string;
} {
  const config = SCALE_CONFIGS[scale];
  const change = followupScore - baselineScore;
  const mcid = config.mcid.value;

  let isImprovement: boolean;
  let isProg: boolean;

  // direction:"increase" → higher score = better (MoCA, MMSE).
  // direction:"decrease" → lower score = better (UMSARS, UPDRS, MDS-UPDRS, ADAS-Cog).
  if (config.mcid.direction === "increase") {
    isImprovement = change >= mcid;
    isProg = change <= -mcid;
  } else {
    isImprovement = change <= -mcid;
    isProg = change >= mcid;
  }

  const classification: ResponderClass = isImprovement
    ? "responder"
    : isProg
      ? "progressor"
      : "stable";

  const uncertaintyNote =
    scale === "moca"
      ? " ⚠️ No formal MCID established for MoCA — classification uses estimated 2-point threshold (Bennett et al. 2016). Treat as exploratory."
      : "";

  return {
    classification,
    change,
    mcidUsed: mcid,
    note: `${config.mcid.source}${uncertaintyNote}`,
  };
}

// ── Trajectory comparison ──────────────────────────────────────────────────

function getTrajectoryComparison(
  scale: string,
  cohort: string,
  observedChange: number,
  timePointMonths: number,
): string {
  if (cohort === "none") return "";

  const ref = COHORT_REFERENCES.find(
    (r) => r.cohort === cohort && r.scale === scale,
  );
  if (!ref) {
    return `No ${cohort.toUpperCase()} reference trajectory available for ${SCALE_CONFIGS[scale].name}.`;
  }

  const expectedAnnual = ref.annual_progression_mean;
  const expectedAtTimePoint = (expectedAnnual * timePointMonths) / 12;
  const diff = observedChange - expectedAtTimePoint;
  const sdThreshold =
    (ref.annual_progression_sd ?? Math.abs(expectedAnnual)) * 0.25;

  let comparison: string;
  if (Math.abs(diff) < sdThreshold) {
    comparison = "consistent with natural history";
  } else if (diff < 0) {
    comparison = "slower progression than natural history";
  } else {
    comparison = "faster progression than natural history";
  }

  return [
    `Trajectory vs ${ref.cohort.toUpperCase()} reference (${ref.indication}):`,
    `  Observed change at ${timePointMonths} months: ${observedChange > 0 ? "+" : ""}${observedChange.toFixed(1)}`,
    `  Expected from ${ref.cohort.toUpperCase()} cohort: ${expectedAtTimePoint > 0 ? "+" : ""}${expectedAtTimePoint.toFixed(1)} (annual rate: ${expectedAnnual}/yr)`,
    `  Assessment: ${comparison}`,
    `  Reference: ${ref.citation}`,
    `  Note: ${ref.note}`,
  ].join("\n");
}

// ── Cutoff classification ──────────────────────────────────────────────────

function classifyCutoffs(scale: string, score: number): string[] {
  const config = SCALE_CONFIGS[scale];
  if (!config.cutoffs) return [];

  return config.cutoffs
    .filter((c) =>
      c.direction === "above" ? score >= c.threshold : score <= c.threshold,
    )
    .map((c) => c.label);
}

// ── Main handler ───────────────────────────────────────────────────────────

export const evidenceClinicalScaleToolSchema = {
  name: "evidence.clinical_scale",
  description:
    "Score neurology & cognitive outcome scales (UMSARS/UPDRS/MDS-UPDRS/ADAS-Cog/MoCA/MMSE). Returns total + subscale scores, MCID-based responder classification, and trajectory comparison vs NNIPPS/PPMI/ADNI reference cohorts. Integrates with jca_pico_scope for MSA (neurology_msa, orphan Phase 2 2028)/PD (neurology_pd)/AD (neurology_ad) indication categories.",
  annotations: {
    title: "Clinical Scale Scoring",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      scale: {
        type: "string",
        enum: ["umsars", "updrs", "mds_updrs", "adas_cog", "moca", "mmse"],
        description:
          "Clinical outcome scale: umsars | updrs | mds_updrs | adas_cog | moca | mmse",
      },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            part: {
              type: "string",
              description: "Scale part identifier, e.g. 'I', 'II', 'III', 'IV'",
            },
            item_id: {
              type: "string",
              description:
                "Item identifier within the part, e.g. '1', '2', ...'12'",
            },
            score: {
              type: "number",
              description: "Item score (range depends on scale and item)",
            },
          },
          required: ["part", "item_id", "score"],
        },
        description:
          "Per-item scores. Supply all items for complete scoring, or a subset for partial scoring with a note.",
      },
      baseline_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            part: { type: "string" },
            item_id: { type: "string" },
            score: { type: "number" },
          },
          required: ["part", "item_id", "score"],
        },
        description:
          "Optional: baseline scores for change-from-baseline and responder analysis.",
      },
      compare_cohort: {
        type: "string",
        enum: ["nnipps", "ppmi", "adni", "none"],
        description:
          "Natural-history reference cohort for trajectory comparison. nnipps=MSA, ppmi=PD, adni=AD.",
      },
      time_point_months: {
        type: "number",
        description:
          "Time point in months from baseline (used for trajectory comparison).",
      },
    },
    required: ["scale", "items"],
  },
};

export async function evidenceClinicalScaleHandler(
  params: EvidenceClinicalScaleParams,
): Promise<string> {
  const config = SCALE_CONFIGS[params.scale];
  const scored = scoreScale(params.scale, params.items);

  const sections: string[] = [];

  // Header
  sections.push(`# ${config.fullName} (${config.name}) — Scoring Report`);
  sections.push(
    `**Scale:** ${config.name} | **Tool:** HEORAgent MCP evidence.clinical_scale`,
  );
  sections.push(`**Reference:** ${config.referenceNote}`);
  sections.push("");

  // 1. Score summary
  sections.push("## Scoring Summary");
  sections.push(`| Metric | Value |`);
  sections.push(`|--------|-------|`);
  sections.push(`| Total score | **${scored.total}** / ${scored.maxTotal} |`);
  sections.push(
    `| Data completeness | ${scored.isComplete ? "✅ Complete" : `⚠️ Partial (${params.items.length} items provided)`} |`,
  );

  if (!scored.isComplete && scored.missingItems.length > 0) {
    const missing = scored.missingItems.slice(0, 10);
    sections.push(
      `| Missing items | ${missing.join(", ")}${scored.missingItems.length > 10 ? ` +${scored.missingItems.length - 10} more` : ""} |`,
    );
  }
  sections.push("");

  // 2. By-part breakdown
  sections.push("## By-Part Breakdown");
  sections.push(`| Part | Label | Score | Max | % |`);
  sections.push(`|------|-------|-------|-----|---|`);
  for (const [part, partConfig] of Object.entries(config.parts)) {
    const partScore = scored.byPart[part];
    if (partScore) {
      const pct =
        partScore.maxScore > 0
          ? ((partScore.score / partScore.maxScore) * 100).toFixed(0)
          : "—";
      sections.push(
        `| ${part} | ${partConfig.label} | ${partScore.score} | ${partScore.maxScore} | ${pct}% |`,
      );
    }
  }
  sections.push("");

  // 3. Cutoff classification (if applicable)
  const cutoffLabels = classifyCutoffs(params.scale, scored.total);
  if (cutoffLabels.length > 0) {
    sections.push("## Clinical Classification");
    cutoffLabels.forEach((label) => sections.push(`- ${label}`));
    sections.push("");
  }

  // 4. Responder analysis (if baseline provided)
  if (params.baseline_items && params.baseline_items.length > 0) {
    const baselineScored = scoreScale(params.scale, params.baseline_items);
    const responder = classifyResponder(
      params.scale,
      baselineScored.total,
      scored.total,
    );

    sections.push("## Change from Baseline & Responder Analysis");
    sections.push(`| Metric | Value |`);
    sections.push(`|--------|-------|`);
    sections.push(
      `| Baseline total | ${baselineScored.total} / ${scored.maxTotal} |`,
    );
    sections.push(`| Follow-up total | ${scored.total} / ${scored.maxTotal} |`);
    sections.push(
      `| Change | ${responder.change > 0 ? "+" : ""}${responder.change.toFixed(1)} |`,
    );
    sections.push(`| MCID threshold | ${responder.mcidUsed} |`);
    sections.push(
      `| **Responder classification** | **${responder.classification.toUpperCase()}** |`,
    );
    sections.push(`| MCID source | ${responder.note} |`);
    sections.push("");
  }

  // 5. Trajectory comparison
  if (
    params.compare_cohort &&
    params.compare_cohort !== "none" &&
    params.baseline_items &&
    params.time_point_months
  ) {
    const baselineScored = scoreScale(params.scale, params.baseline_items);
    const change = scored.total - baselineScored.total;
    const trajectory = getTrajectoryComparison(
      params.scale,
      params.compare_cohort,
      change,
      params.time_point_months,
    );
    if (trajectory) {
      sections.push("## Trajectory vs Natural-History Reference Cohort");
      sections.push(trajectory);
      sections.push("");
      sections.push(
        "> ⚠️ **v1 limitation:** Comparison uses summary-level reference cohort data (mean ± SD), not individual-patient data (IPD). Treat as indicative, not inferential. For regulatory submissions, present alongside study-specific natural history data.",
      );
      sections.push("");
    }
  }

  // 6. HTA/regulatory notes
  sections.push("## HTA & Regulatory Notes");
  if (params.scale === "umsars") {
    sections.push(
      "- **MSA orphan status:** Products for MSA enter EU JCA scope from 13 January 2028 (Phase 2 — orphan medicinal products per Reg. 2021/2282 Art. 7(2)).",
    );
    sections.push(
      "- **EUnetHTA precedent:** UMSARS-II motor examination is the recommended primary scale for MSA trials (EUnetHTA Scope Guidance, orphan track).",
    );
    sections.push(
      "- **NICE approach:** BSC-only comparator; NICE currently defers to NHSE rare-disease commissioning for MSA — no completed NICE TA precedent as of 2026.",
    );
  } else if (params.scale === "updrs" || params.scale === "mds_updrs") {
    sections.push(
      "- **JCA scope:** Parkinson's disease enters EU JCA scope from 13 January 2030 (Phase 3 — all other medicinal products).",
    );
    sections.push(
      "- **Preferred scale:** EUnetHTA and most HTA bodies prefer MDS-UPDRS for post-2010 trials; legacy UPDRS trials require bridging analysis.",
    );
    sections.push(
      "- **Comparator:** Levodopa/carbidopa as backbone; DBS as surgical comparator in advanced disease. ITC methods (Bucher/NMA) commonly required.",
    );
  } else if (
    params.scale === "adas_cog" ||
    params.scale === "mmse" ||
    params.scale === "moca"
  ) {
    sections.push(
      "- **JCA scope:** Alzheimer's disease enters EU JCA scope from 13 January 2030 (Phase 3 — all other medicinal products).",
    );
    sections.push(
      "- **Preferred scale:** ADAS-Cog-11 (or ADAS-Cog-13) for regulatory primary endpoint; MMSE as secondary/eligibility criterion; MoCA for screening.",
    );
    sections.push(
      "- **Anti-amyloid therapies:** Lecanemab (Leqembi) and donanemab (Kisunla) are now active comparators for new anti-amyloid mAbs in HTA submissions.",
    );
    sections.push(
      "- **GRADE note:** ADAS-Cog effect sizes from RCTs are often of LOW–MODERATE certainty due to heterogeneous populations and short follow-up vs long-term disease trajectory.",
    );
  }
  sections.push("");

  return sections.join("\n");
}
