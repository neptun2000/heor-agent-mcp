/**
 * evidence.unmet_need — Structured unmet need section generator.
 *
 * Takes structured inputs across 4 HEOR dimensions (disease burden,
 * treatment landscape, QoL impact, economic burden) and produces a
 * standardised markdown section + structured JSON pack for HTA dossiers.
 *
 * Design log #23 | HEORAgent v1.6.0
 * Design log #26 | HEORAgent v1.10.1 — auto-wire regulatory.status_check
 * Pipes into hta_dossier via unmet_need_summary parameter.
 */

import { z } from "zod";
import type { AutoCheckResult } from "../providers/regulatory/autoCheck.js";

// ── Zod schemas ────────────────────────────────────────────────────────────

const citationSchema = z.object({
  claim_anchor: z.string(),
  citation: z.string(),
  url: z.string().url().optional(),
});

export const evidenceUnmetNeedSchema = z.object({
  drug: z.string(),
  indication: z.string(),
  jurisdictions: z
    .array(z.enum(["us", "uk", "de", "fr", "it", "es", "nl", "jp", "global"]))
    .min(1),

  disease_burden: z
    .object({
      incidence_per_100k: z.number().optional(),
      prevalence_per_100k: z.number().optional(),
      annual_deaths: z.number().optional(),
      five_year_survival: z.number().min(0).max(1).optional(),
      qualitative_summary: z.string().optional(),
      citations: z.array(citationSchema).optional(),
    })
    .optional(),

  treatment_landscape: z
    .object({
      current_soc: z.array(z.string()),
      response_rate_pct: z.number().optional(),
      median_pfs_months: z.number().optional(),
      treatment_failure_rate_pct: z.number().optional(),
      discontinuation_rate_pct: z.number().optional(),
      qualitative_summary: z.string().optional(),
      citations: z.array(citationSchema).optional(),
    })
    .optional(),

  qol_impact: z
    .object({
      eq5d_decrement: z.number().optional(),
      productivity_loss_pct: z.number().optional(),
      caregiver_hours_per_week: z.number().optional(),
      qualitative_summary: z.string().optional(),
      citations: z.array(citationSchema).optional(),
    })
    .optional(),

  economic_burden: z
    .object({
      annual_direct_cost_per_patient: z.number().optional(),
      annual_indirect_cost_per_patient: z.number().optional(),
      currency: z.string().optional().default("USD"),
      qualitative_summary: z.string().optional(),
      citations: z.array(citationSchema).optional(),
    })
    .optional(),

  literature_evidence: z.array(z.any()).optional(),

  // Design log #26: auto-wire regulatory.status_check (default-on, opt-out with false)
  auto_check_regulatory: z.boolean().default(true),
});

// INPUT type (before Zod transforms — what callers supply, with optionals omittable)
export type EvidenceUnmetNeedInput = z.input<typeof evidenceUnmetNeedSchema>;
// OUTPUT type (after Zod transforms — what the handler works with internally)
export type EvidenceUnmetNeedParams = z.infer<typeof evidenceUnmetNeedSchema>;

// ── Output types ───────────────────────────────────────────────────────────

export interface Citation {
  claim_anchor: string;
  citation: string;
  url?: string;
}

export interface DimensionResult {
  rendered: string;
  citations: Citation[];
  gaps: string[];
}

/** Design log #26: structured regulatory status for one drug×region pair */
export interface RegulatoryContext {
  drug: string;
  region: string;
  status: string; // "approved" | "unknown" | "api_error" | etc.
  approved_indications: {
    indication_text_verbatim: string;
    population: string;
    population_parsed: {
      age_min_years: number | null;
      age_max_years: number | null;
      weight_constraint_kg: number | null;
      sex_constraint: string | null;
    } | null;
    approval_date: string | null;
    label_revision: string | null;
    region_specific: boolean;
  }[];
  black_box_warnings: { heading: string; text_verbatim: string }[];
  source_urls: Citation[];
  data_fetched_at: string;
  graceful_degradation_reason?: string;
}

export interface UnmetNeedResult {
  schema_version: "1.0";
  drug: string;
  indication: string;
  jurisdictions: string[];
  disease_burden: DimensionResult;
  treatment_landscape: DimensionResult;
  qol_impact: DimensionResult;
  economic_burden: DimensionResult;
  markdown_section: string;
  unmet_need_summary: string;
  total_citations: Citation[];
  gaps: string[];
  /** Design log #26: populated when auto_check_regulatory=true (default) */
  regulatory_context?: RegulatoryContext[];
}

// ── Citation numbering state ───────────────────────────────────────────────

interface CitationRegistry {
  citations: Citation[];
  // Map from citation text → assigned global number
  numberMap: Map<string, number>;
}

function createRegistry(): CitationRegistry {
  return { citations: [], numberMap: new Map() };
}

/**
 * Register a citation and return its global number (1-based).
 * Deduplication is by citation text.
 */
function registerCitation(registry: CitationRegistry, c: Citation): number {
  const key = c.citation;
  if (registry.numberMap.has(key)) {
    return registry.numberMap.get(key)!;
  }
  const num = registry.citations.length + 1;
  registry.citations.push(c);
  registry.numberMap.set(key, num);
  return num;
}

/**
 * Produce an inline anchor string like `[<sup>1</sup>]`.
 */
function anchor(n: number): string {
  return `[<sup>${n}</sup>]`;
}

// ── Per-dimension renderers ────────────────────────────────────────────────

function renderDiseaseBurden(
  data: NonNullable<EvidenceUnmetNeedParams["disease_burden"]>,
  indication: string,
  registry: CitationRegistry,
): DimensionResult {
  const lines: string[] = [];
  const gaps: string[] = [];
  const dimCitations: Citation[] = data.citations ?? [];

  // Track if we have any quantitative content
  let hasQuantitative = false;

  if (data.incidence_per_100k !== undefined) {
    hasQuantitative = true;
    const refs = dimCitations
      .filter((c) => c.claim_anchor === "incidence")
      .map((c) => anchor(registerCitation(registry, c)))
      .join("");
    lines.push(
      `${indication} has an estimated incidence of ${data.incidence_per_100k} per 100,000 population annually.${refs}`,
    );
  }

  if (data.prevalence_per_100k !== undefined) {
    hasQuantitative = true;
    const refs = dimCitations
      .filter((c) => c.claim_anchor === "prevalence")
      .map((c) => anchor(registerCitation(registry, c)))
      .join("");
    lines.push(
      `Prevalence is approximately ${data.prevalence_per_100k} per 100,000.${refs}`,
    );
  }

  if (data.annual_deaths !== undefined) {
    hasQuantitative = true;
    const refs = dimCitations
      .filter((c) => c.claim_anchor === "annual_deaths")
      .map((c) => anchor(registerCitation(registry, c)))
      .join("");
    lines.push(
      `Annual deaths attributable to ${indication}: ${data.annual_deaths}.${refs}`,
    );
  }

  if (data.five_year_survival !== undefined) {
    hasQuantitative = true;
    const pct = (data.five_year_survival * 100).toFixed(1);
    const refs = dimCitations
      .filter((c) => c.claim_anchor === "five_year_survival")
      .map((c) => anchor(registerCitation(registry, c)))
      .join("");
    lines.push(`Five-year survival rate: ${pct}%.${refs}`);
  }

  // Register any remaining citations not matched by specific anchors
  for (const c of dimCitations) {
    const anchors = [
      "incidence",
      "prevalence",
      "annual_deaths",
      "five_year_survival",
    ];
    if (!anchors.includes(c.claim_anchor)) {
      const n = registerCitation(registry, c);
      lines.push(`${c.claim_anchor}${anchor(n)}`);
      hasQuantitative = true;
    }
  }

  if (data.qualitative_summary) {
    lines.push(data.qualitative_summary);
  }

  // Gap: qualitative only with no quantitative AND no citations
  if (!hasQuantitative && dimCitations.length === 0) {
    gaps.push("disease_burden missing quantitative or citation");
  }

  return {
    rendered: lines.join("\n"),
    citations: dimCitations,
    gaps,
  };
}

function renderTreatmentLandscape(
  data: NonNullable<EvidenceUnmetNeedParams["treatment_landscape"]>,
  indication: string,
  registry: CitationRegistry,
): DimensionResult {
  const lines: string[] = [];
  const gaps: string[] = [];
  const dimCitations: Citation[] = data.citations ?? [];
  let hasQuantitative = false;

  if (data.current_soc.length > 0) {
    lines.push(
      `Standard of care for ${indication} includes: ${data.current_soc.join(", ")}.`,
    );
  }

  if (data.response_rate_pct !== undefined) {
    hasQuantitative = true;
    const refs = dimCitations
      .filter((c) => c.claim_anchor === "response_rate")
      .map((c) => anchor(registerCitation(registry, c)))
      .join("");
    lines.push(
      `Despite optimised therapy, the response rate remains ${data.response_rate_pct}%.${refs}`,
    );
  }

  if (data.median_pfs_months !== undefined) {
    hasQuantitative = true;
    const refs = dimCitations
      .filter((c) => c.claim_anchor === "median_pfs")
      .map((c) => anchor(registerCitation(registry, c)))
      .join("");
    lines.push(
      `Median progression-free survival: ${data.median_pfs_months} months.${refs}`,
    );
  }

  if (data.treatment_failure_rate_pct !== undefined) {
    hasQuantitative = true;
    const refs = dimCitations
      .filter((c) => c.claim_anchor === "treatment_failure")
      .map((c) => anchor(registerCitation(registry, c)))
      .join("");
    lines.push(
      `Treatment failure rate: ${data.treatment_failure_rate_pct}%.${refs}`,
    );
  }

  if (data.discontinuation_rate_pct !== undefined) {
    hasQuantitative = true;
    const refs = dimCitations
      .filter((c) => c.claim_anchor === "discontinuation")
      .map((c) => anchor(registerCitation(registry, c)))
      .join("");
    lines.push(
      `Discontinuation rate: ${data.discontinuation_rate_pct}%.${refs}`,
    );
  }

  // Register remaining unanchored citations
  for (const c of dimCitations) {
    const anchors = [
      "response_rate",
      "median_pfs",
      "treatment_failure",
      "discontinuation",
    ];
    if (!anchors.includes(c.claim_anchor)) {
      const n = registerCitation(registry, c);
      lines.push(`${c.claim_anchor}${anchor(n)}`);
      hasQuantitative = true;
    }
  }

  if (data.qualitative_summary) {
    lines.push(data.qualitative_summary);
  }

  if (data.current_soc.length > 0 && dimCitations.length === 0) {
    gaps.push(
      "treatment_landscape current_soc/regulatory status needs citation support",
    );
  }

  if (!hasQuantitative && dimCitations.length === 0) {
    gaps.push("treatment_landscape missing quantitative or citation");
  }

  return {
    rendered: lines.join("\n"),
    citations: dimCitations,
    gaps,
  };
}

function renderQolImpact(
  data: NonNullable<EvidenceUnmetNeedParams["qol_impact"]>,
  indication: string,
  registry: CitationRegistry,
): DimensionResult {
  const lines: string[] = [];
  const gaps: string[] = [];
  const dimCitations: Citation[] = data.citations ?? [];
  let hasQuantitative = false;

  if (data.eq5d_decrement !== undefined) {
    hasQuantitative = true;
    const refs = dimCitations
      .filter((c) => c.claim_anchor === "eq5d")
      .map((c) => anchor(registerCitation(registry, c)))
      .join("");
    lines.push(
      `Patients with ${indication} experience an EQ-5D decrement of ${data.eq5d_decrement} vs the general population.${refs}`,
    );
  }

  if (data.productivity_loss_pct !== undefined) {
    hasQuantitative = true;
    const refs = dimCitations
      .filter((c) => c.claim_anchor === "productivity")
      .map((c) => anchor(registerCitation(registry, c)))
      .join("");
    lines.push(
      `Productivity loss is approximately ${data.productivity_loss_pct}%.${refs}`,
    );
  }

  if (data.caregiver_hours_per_week !== undefined) {
    hasQuantitative = true;
    const refs = dimCitations
      .filter((c) => c.claim_anchor === "caregiver")
      .map((c) => anchor(registerCitation(registry, c)))
      .join("");
    lines.push(
      `Caregiver burden averages ${data.caregiver_hours_per_week} hours/week.${refs}`,
    );
  }

  // Register remaining unanchored citations
  for (const c of dimCitations) {
    const anchors = ["eq5d", "productivity", "caregiver"];
    if (!anchors.includes(c.claim_anchor)) {
      const n = registerCitation(registry, c);
      lines.push(`${c.claim_anchor}${anchor(n)}`);
      hasQuantitative = true;
    }
  }

  if (data.qualitative_summary) {
    lines.push(data.qualitative_summary);
  }

  if (!hasQuantitative && dimCitations.length === 0) {
    gaps.push("qol_impact missing quantitative or citation");
  }

  return {
    rendered: lines.join("\n"),
    citations: dimCitations,
    gaps,
  };
}

function renderEconomicBurden(
  data: NonNullable<EvidenceUnmetNeedParams["economic_burden"]>,
  _indication: string,
  registry: CitationRegistry,
): DimensionResult {
  const lines: string[] = [];
  const gaps: string[] = [];
  const dimCitations: Citation[] = data.citations ?? [];
  const currency = data.currency ?? "USD";
  let hasQuantitative = false;

  if (data.annual_direct_cost_per_patient !== undefined) {
    hasQuantitative = true;
    const refs = dimCitations
      .filter((c) => c.claim_anchor === "direct_cost")
      .map((c) => anchor(registerCitation(registry, c)))
      .join("");
    lines.push(
      `Annual direct medical cost per patient: ${currency} ${data.annual_direct_cost_per_patient}.${refs}`,
    );
  }

  if (data.annual_indirect_cost_per_patient !== undefined) {
    hasQuantitative = true;
    const refs = dimCitations
      .filter((c) => c.claim_anchor === "indirect_cost")
      .map((c) => anchor(registerCitation(registry, c)))
      .join("");
    lines.push(
      `Annual indirect cost (productivity loss) per patient: ${currency} ${data.annual_indirect_cost_per_patient}.${refs}`,
    );
  }

  // Register remaining unanchored citations
  for (const c of dimCitations) {
    const anchors = ["direct_cost", "indirect_cost"];
    if (!anchors.includes(c.claim_anchor)) {
      const n = registerCitation(registry, c);
      lines.push(`${c.claim_anchor}${anchor(n)}`);
      hasQuantitative = true;
    }
  }

  if (data.qualitative_summary) {
    lines.push(data.qualitative_summary);
  }

  if (!hasQuantitative && dimCitations.length === 0) {
    gaps.push("economic_burden missing quantitative or citation");
  }

  return {
    rendered: lines.join("\n"),
    citations: dimCitations,
    gaps,
  };
}

// ── Empty dimension placeholder ────────────────────────────────────────────

function missingDimension(name: string): DimensionResult {
  return {
    rendered: `⚠️ ${name} not provided.`,
    citations: [],
    gaps: [`${name} missing — no data provided`],
  };
}

// ── Summary synthesis ──────────────────────────────────────────────────────

function buildSummary(
  drug: string,
  indication: string,
  jurisdictions: string[],
  db: DimensionResult,
  tl: DimensionResult,
  qol: DimensionResult,
  eb: DimensionResult,
  params: EvidenceUnmetNeedParams,
): string {
  const parts: string[] = [];

  // Disease burden sentence
  if (params.disease_burden) {
    const bd = params.disease_burden;
    const prev =
      bd.prevalence_per_100k !== undefined
        ? `prevalence of ${bd.prevalence_per_100k} per 100,000`
        : bd.incidence_per_100k !== undefined
          ? `incidence of ${bd.incidence_per_100k} per 100,000`
          : null;
    if (prev) {
      parts.push(
        `${indication} affects patients with a ${prev} in the jurisdictions under review (${jurisdictions.join(", ")}).`,
      );
    }
  }

  // Treatment landscape sentence
  if (params.treatment_landscape) {
    const tl_d = params.treatment_landscape;
    const soc =
      tl_d.current_soc.length > 0 ? tl_d.current_soc.join(", ") : null;
    if (soc) {
      if (tl_d.treatment_failure_rate_pct !== undefined) {
        parts.push(
          `Current standard of care (${soc}) has a treatment failure rate of ${tl_d.treatment_failure_rate_pct}%, representing a significant unmet need for ${drug}.`,
        );
      } else if (tl_d.response_rate_pct !== undefined) {
        parts.push(
          `Current standard of care (${soc}) has a reported response rate of ${tl_d.response_rate_pct}%, leaving residual unmet need for ${drug}.`,
        );
      } else if (tl_d.discontinuation_rate_pct !== undefined) {
        parts.push(
          `Current standard of care (${soc}) has a discontinuation rate of ${tl_d.discontinuation_rate_pct}%, leaving residual unmet need for ${drug}.`,
        );
      } else if (
        tl_d.qualitative_summary &&
        (tl_d.citations?.length ?? 0) > 0
      ) {
        parts.push(
          `Current standard of care (${soc}) has documented limitations, leaving residual unmet need for ${drug}.`,
        );
      } else if (tl_d.qualitative_summary) {
        parts.push(
          `Current standard of care (${soc}) has stated limitations that require citation support before use in a submission-grade unmet need claim for ${drug}.`,
        );
      } else {
        parts.push(
          `Current standard of care includes ${soc}; residual unmet need should be confirmed with cited efficacy, tolerability, access, or regulatory evidence for ${drug}.`,
        );
      }
    }
  }

  // QoL sentence
  if (params.qol_impact) {
    const q = params.qol_impact;
    const eq5d =
      q.eq5d_decrement !== undefined
        ? `an EQ-5D decrement of ${q.eq5d_decrement}`
        : null;
    const cgr =
      q.caregiver_hours_per_week !== undefined
        ? `caregiver burden of ${q.caregiver_hours_per_week} hours/week`
        : null;
    const items = [eq5d, cgr].filter(Boolean);
    if (items.length > 0) {
      parts.push(
        `Patient quality of life is substantially impaired (${items.join("; ")}).`,
      );
    }
  }

  // Economic burden sentence
  if (params.economic_burden) {
    const e = params.economic_burden;
    const currency = e.currency ?? "USD";
    if (e.annual_direct_cost_per_patient !== undefined) {
      const indirect =
        e.annual_indirect_cost_per_patient !== undefined
          ? ` plus ${currency} ${e.annual_indirect_cost_per_patient} indirect costs`
          : "";
      parts.push(
        `The annual economic burden reaches ${currency} ${e.annual_direct_cost_per_patient} in direct costs${indirect} per patient.`,
      );
    }
  }

  // Fallback
  if (parts.length === 0) {
    parts.push(
      `${drug} addresses a significant unmet need in ${indication} across the targeted jurisdictions (${jurisdictions.join(", ")}).`,
    );
  }

  return parts.join(" ");
}

// ── Markdown assembly ──────────────────────────────────────────────────────

function buildMarkdown(
  drug: string,
  indication: string,
  db: DimensionResult,
  tl: DimensionResult,
  qol: DimensionResult,
  eb: DimensionResult,
  allCitations: Citation[],
): string {
  const lines: string[] = [];

  lines.push(`## Unmet Need: ${drug} for ${indication}`);
  lines.push("");

  lines.push(`### 1. Disease Burden`);
  lines.push(db.rendered);
  lines.push("");

  lines.push(`### 2. Current Treatment Landscape and Gaps`);
  lines.push(tl.rendered);
  lines.push("");

  lines.push(
    `### 3. Patient-Reported and Health-Related Quality of Life Impact`,
  );
  lines.push(qol.rendered);
  lines.push("");

  lines.push(`### 4. Economic Burden`);
  lines.push(eb.rendered);
  lines.push("");

  if (allCitations.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("### References");
    allCitations.forEach((c, i) => {
      const urlPart = c.url ? ` — ${c.url}` : "";
      lines.push(`${i + 1}. ${c.citation}${urlPart}`);
    });
  }

  return lines.join("\n");
}

// ── Design log #26: region inference from jurisdictions ───────────────────

/**
 * Map jurisdiction codes to regulatory regions for auto-wire fan-out.
 * Returns unique regions (deduped).
 */
function inferRegions(jurisdictions: string[]): Array<"us" | "eu" | "uk"> {
  const regions = new Set<"us" | "eu" | "uk">();
  for (const j of jurisdictions) {
    if (j === "us") regions.add("us");
    else if (j === "uk") regions.add("uk");
    else if (["de", "fr", "it", "es", "nl"].includes(j)) regions.add("eu");
    else if (j === "global") {
      regions.add("us");
      regions.add("eu");
    }
    // "jp" → skip (no JP data in v1.10.1)
  }
  return Array.from(regions);
}

/**
 * Strip the "1 INDICATIONS AND USAGE" header that OpenFDA prefixes,
 * then extract the first 60–200 chars ending at a sentence boundary.
 */
function extractVerbatimSnippet(text: string): string {
  // Strip leading header like "1 INDICATIONS AND USAGE\n" or "INDICATIONS AND USAGE\n"
  const stripped = text
    .replace(/^\d+\s+INDICATIONS AND USAGE\s*/i, "")
    .replace(/^INDICATIONS AND USAGE\s*/i, "")
    .trim();

  if (stripped.length <= 200) return stripped;

  // Find sentence boundary between 60 and 200 chars
  const slice = stripped.slice(0, 200);
  const lastPeriod = slice.lastIndexOf(".");
  if (lastPeriod >= 60) return stripped.slice(0, lastPeriod + 1);

  return stripped.slice(0, 200) + "…";
}

/** Build gap message for unknown status (include did_you_mean) */
function buildUnknownGap(
  drug: string,
  region: string,
  didYouMean?: string[],
): string {
  const suggestions =
    didYouMean && didYouMean.length > 0
      ? ` (did_you_mean: ${didYouMean.slice(0, 3).join(", ")})`
      : "";
  return `${drug} not found in ${region} regulatory database — primary-source verification needed${suggestions}`;
}

/** Build gap message for api_error status */
function buildApiErrorGap(drug: string, region: string): string {
  return `regulatory_status check failed for ${drug} (${region}) — verify label manually before submission`;
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function evidenceUnmetNeedHandler(
  rawParams: EvidenceUnmetNeedInput,
): Promise<UnmetNeedResult> {
  // Parse through schema to apply defaults (e.g. currency: "USD", auto_check_regulatory: true)
  const params = evidenceUnmetNeedSchema.parse(rawParams);
  const registry = createRegistry();

  // ── Design log #26: auto-wire regulatory.status_check ─────────────────
  // Must run BEFORE rendering treatment_landscape so we can inject verbatim
  // label quotes into the rendered text and register citations.
  let regulatoryContext: RegulatoryContext[] | undefined;
  const regulatoryGaps: string[] = [];

  if (
    params.auto_check_regulatory &&
    params.treatment_landscape &&
    params.treatment_landscape.current_soc.length > 0
  ) {
    // Lazy import to maintain cycle-safety (autoCheck → regulatoryStatusCheck only)
    const { autoCheckRegulatory } =
      await import("../providers/regulatory/autoCheck.js");

    const regions = inferRegions(params.jurisdictions);
    const requests = params.treatment_landscape.current_soc.flatMap((drug) =>
      regions.map((region) => ({
        drug,
        region,
        indication: params.indication,
      })),
    );

    let autoResults: AutoCheckResult[] = [];
    try {
      autoResults = await autoCheckRegulatory(requests);
    } catch {
      // Never block — if autoCheckRegulatory itself throws (shouldn't), skip silently
    }

    regulatoryContext = [];

    for (const ar of autoResults) {
      const r = ar.result;
      const ctx: RegulatoryContext = {
        drug: ar.drug,
        region: ar.region,
        status: r.current_status,
        approved_indications: r.approved_indications,
        black_box_warnings: r.black_box_warnings,
        source_urls: r.source_urls.map((s) => ({
          claim_anchor: `regulatory_${ar.drug}_${ar.region}`,
          citation: `${s.source} — ${ar.drug} (${ar.region.toUpperCase()}) label, retrieved ${s.fetched_at.slice(0, 10)}`,
          url: s.url,
        })),
        data_fetched_at: r.data_fetched_at,
      };

      if (
        r.current_status === "approved" &&
        r.approved_indications.length > 0
      ) {
        // Auto-register source URL as citation (deduplicated by url via citation text)
        const firstIndication = r.approved_indications[0];
        const snippet = extractVerbatimSnippet(
          firstIndication.indication_text_verbatim,
        );
        const dateStr = r.data_fetched_at.slice(0, 10);
        const sourceLabel = ar.region === "eu" ? "EMA/OpenEPI" : "FDA/OpenFDA";

        if (r.source_urls.length > 0) {
          const srcCitation: Citation = {
            claim_anchor: `regulatory_${ar.drug}_${ar.region}`,
            citation: `${sourceLabel} — ${ar.drug} (${ar.region.toUpperCase()}) approved label, retrieved ${dateStr}`,
            url: r.source_urls[0].url,
          };
          const citNum = registerCitation(registry, srcCitation);
          // Inject verbatim label line into treatment_landscape rendered text
          // (stored for post-render injection — we attach to ctx)
          ctx.graceful_degradation_reason = undefined;
          // We store the rendered line as a property on ctx for injection below
          (ctx as RegulatoryContext & { _renderLine?: string })._renderLine =
            `Per ${sourceLabel} label retrieved ${dateStr}: ${ar.drug} is approved for ${snippet}${anchor(citNum)}`;
        }
      } else if (r.current_status === "unknown") {
        regulatoryGaps.push(
          buildUnknownGap(ar.drug, ar.region, r.did_you_mean),
        );
        ctx.graceful_degradation_reason = `${ar.drug} not found in ${ar.region} regulatory database`;
      } else if (r.current_status === "api_error") {
        regulatoryGaps.push(buildApiErrorGap(ar.drug, ar.region));
        ctx.graceful_degradation_reason =
          r.api_error?.message ?? "regulatory API error";
      }

      regulatoryContext.push(ctx);
    }
  }

  // ── Render each dimension ──────────────────────────────────────────────
  const dbResult = params.disease_burden
    ? renderDiseaseBurden(params.disease_burden, params.indication, registry)
    : missingDimension("disease_burden");

  const tlResult = params.treatment_landscape
    ? renderTreatmentLandscape(
        params.treatment_landscape,
        params.indication,
        registry,
      )
    : missingDimension("treatment_landscape");

  // ── Design log #26: inject verbatim label lines into treatment_landscape ─
  if (regulatoryContext && regulatoryContext.length > 0) {
    const renderLines: string[] = [];
    for (const ctx of regulatoryContext) {
      const line = (ctx as RegulatoryContext & { _renderLine?: string })
        ._renderLine;
      if (line) {
        renderLines.push(line);
        // Clean up the internal property
        delete (ctx as RegulatoryContext & { _renderLine?: string })
          ._renderLine;
      }
    }
    if (renderLines.length > 0) {
      tlResult.rendered = tlResult.rendered + "\n" + renderLines.join("\n");
    }
  }

  const qolResult = params.qol_impact
    ? renderQolImpact(params.qol_impact, params.indication, registry)
    : missingDimension("qol_impact");

  const ebResult = params.economic_burden
    ? renderEconomicBurden(params.economic_burden, params.indication, registry)
    : missingDimension("economic_burden");

  // Aggregate gaps (including regulatory gaps from auto-wire)
  const allGaps = [
    ...dbResult.gaps,
    ...tlResult.gaps,
    ...qolResult.gaps,
    ...ebResult.gaps,
    ...regulatoryGaps,
  ];

  // All citations (deduplicated by registry)
  const allCitations = registry.citations;

  // Markdown section
  const markdownSection = buildMarkdown(
    params.drug,
    params.indication,
    dbResult,
    tlResult,
    qolResult,
    ebResult,
    allCitations,
  );

  // 1-paragraph summary
  const summary = buildSummary(
    params.drug,
    params.indication,
    params.jurisdictions,
    dbResult,
    tlResult,
    qolResult,
    ebResult,
    params,
  );

  return {
    schema_version: "1.0",
    drug: params.drug,
    indication: params.indication,
    jurisdictions: params.jurisdictions,
    disease_burden: dbResult,
    treatment_landscape: tlResult,
    qol_impact: qolResult,
    economic_burden: ebResult,
    markdown_section: markdownSection,
    unmet_need_summary: summary,
    total_citations: allCitations,
    gaps: allGaps,
    ...(regulatoryContext !== undefined
      ? { regulatory_context: regulatoryContext }
      : {}),
  };
}

// ── Tool schema (MCP definition) ───────────────────────────────────────────

export const evidenceUnmetNeedToolSchema = {
  name: "evidence.unmet_need",
  description:
    "Generate a structured unmet need section for HTA dossiers (NICE STA, EMA, FDA, IQWiG, HAS, JCA, GVD, AMCP). Consume-only: first retrieve evidence with literature_search, then pass only cited facts across 4 HEOR dimensions — disease burden, treatment landscape, QoL impact, economic burden. By default (auto_check_regulatory=true), automatically checks current regulatory status of comparators in treatment_landscape.current_soc via primary-source databases (OpenFDA/EMA EPI) and injects verbatim label quotes with auto-numbered citations. Degrades gracefully on API errors — never blocks dossier output. Set auto_check_regulatory:false to skip. Produces a standardised markdown section plus a 1-paragraph unmet_need_summary for downstream tools. Pipe unmet_need_summary into hta_dossier(unmet_need_summary:...) to pre-fill NICE Section B (unmet need) or GVD Section 4. Design log #23 + #26.",
  annotations: {
    title: "Unmet Need Section Generator",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      drug: {
        type: "string",
        description: "Drug or intervention name",
      },
      indication: {
        type: "string",
        description: "Disease/condition being treated",
      },
      jurisdictions: {
        type: "array",
        items: {
          type: "string",
          enum: ["us", "uk", "de", "fr", "it", "es", "nl", "jp", "global"],
        },
        minItems: 1,
        description: "Target market(s) for this unmet need assessment",
      },
      disease_burden: {
        type: "object",
        description: "Epidemiology data for the indication",
        properties: {
          incidence_per_100k: { type: "number" },
          prevalence_per_100k: { type: "number" },
          annual_deaths: { type: "number" },
          five_year_survival: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "0-1 scale; rendered as percentage",
          },
          qualitative_summary: { type: "string" },
          citations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                claim_anchor: { type: "string" },
                citation: { type: "string" },
                url: { type: "string" },
              },
              required: ["claim_anchor", "citation"],
            },
          },
        },
      },
      treatment_landscape: {
        type: "object",
        description:
          "Current standard of care and its limitations. Use only evidence retrieved by literature_search or other audited sources. Regulatory/approval claims require current label/regulatory citation support; if not confirmed, leave out rather than infer.",
        properties: {
          current_soc: {
            type: "array",
            items: { type: "string" },
            description:
              "Molecule names for current standard of care, supported by cited guideline/label/HTA evidence where possible.",
          },
          response_rate_pct: { type: "number" },
          median_pfs_months: { type: "number" },
          treatment_failure_rate_pct: { type: "number" },
          discontinuation_rate_pct: { type: "number" },
          qualitative_summary: {
            type: "string",
            description:
              "Cited narrative summary only. Do not assert off-label/no pediatric approval/no approved options unless current regulatory sources confirmed it.",
          },
          citations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                claim_anchor: { type: "string" },
                citation: { type: "string" },
                url: { type: "string" },
              },
              required: ["claim_anchor", "citation"],
            },
          },
        },
        required: ["current_soc"],
      },
      qol_impact: {
        type: "object",
        description:
          "Patient-reported and health-related quality of life impact",
        properties: {
          eq5d_decrement: {
            type: "number",
            description: "EQ-5D utility decrement vs general population",
          },
          productivity_loss_pct: { type: "number" },
          caregiver_hours_per_week: { type: "number" },
          qualitative_summary: { type: "string" },
          citations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                claim_anchor: { type: "string" },
                citation: { type: "string" },
                url: { type: "string" },
              },
              required: ["claim_anchor", "citation"],
            },
          },
        },
      },
      economic_burden: {
        type: "object",
        description: "Direct and indirect economic burden of the disease",
        properties: {
          annual_direct_cost_per_patient: { type: "number" },
          annual_indirect_cost_per_patient: { type: "number" },
          currency: {
            type: "string",
            default: "USD",
            description: "ISO 4217 currency code",
          },
          qualitative_summary: { type: "string" },
          citations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                claim_anchor: { type: "string" },
                citation: { type: "string" },
                url: { type: "string" },
              },
              required: ["claim_anchor", "citation"],
            },
          },
        },
      },
      literature_evidence: {
        type: "array",
        description:
          "Optional: pass literature_search results here to include as supporting evidence",
        items: { type: "object" },
      },
      auto_check_regulatory: {
        type: "boolean",
        default: true,
        description:
          "When true (default), automatically fans out regulatory.status_check for each drug in treatment_landscape.current_soc × inferred regions. Injects verbatim label quotes inline with auto-numbered citations. Set false to skip (pre-v1.10.1 behaviour). Design log #26.",
      },
    },
    required: ["drug", "indication", "jurisdictions"],
  },
};
