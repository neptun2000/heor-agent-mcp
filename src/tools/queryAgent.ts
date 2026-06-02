/**
 * data.query_agent — validated epidemiology layer wrapping data.claims_query.
 *
 * Design log #33.
 *
 * Translates a natural-language clinical indication to ICD-10 prefixes,
 * selects the right dataset(s) by country, runs the query, performs QA checks
 * (year coverage, count plausibility, year-over-year consistency), and returns
 * a structured epidemiology block with a confidence tier.
 */

import { z } from "zod";
import type { ToolResult } from "../providers/types.js";
import { createAuditRecord } from "../audit/builder.js";
import { handleClaimsQuery } from "./claimsQuery.js";

// ── ICD-10 resolution map ─────────────────────────────────────────────────────

interface IcdEntry {
  prefixes: string[];
  note: string;
}

const ICD_MAP: Record<string, IcdEntry> = {
  // Diabetes
  "type 2 diabetes": { prefixes: ["E11"], note: "T2D primary ICD-10" },
  t2d: { prefixes: ["E11"], note: "T2D primary ICD-10" },
  "diabetes type 2": { prefixes: ["E11"], note: "T2D primary ICD-10" },
  "diabetes mellitus type 2": { prefixes: ["E11"], note: "T2D primary ICD-10" },
  "type 1 diabetes": { prefixes: ["E10"], note: "T1D primary ICD-10" },
  diabetes: { prefixes: ["E10", "E11", "E13"], note: "All diabetes types" },
  // Cardiovascular
  "heart failure": { prefixes: ["I50"], note: "Heart failure all types" },
  hfref: { prefixes: ["I50"], note: "HFrEF coded under I50" },
  hfpef: { prefixes: ["I50"], note: "HFpEF coded under I50" },
  "myocardial infarction": {
    prefixes: ["I21", "I22"],
    note: "AMI + subsequent AMI",
  },
  ami: { prefixes: ["I21", "I22"], note: "AMI + subsequent AMI" },
  "acute coronary syndrome": {
    prefixes: ["I20", "I21", "I22"],
    note: "ACS spectrum",
  },
  stroke: { prefixes: ["I63", "I64"], note: "Ischaemic + unspecified stroke" },
  "ischaemic stroke": { prefixes: ["I63"], note: "Ischaemic stroke" },
  "atrial fibrillation": { prefixes: ["I48"], note: "AF all types" },
  hypertension: {
    prefixes: ["I10", "I11", "I12", "I13"],
    note: "Essential + secondary HTN",
  },
  // Respiratory
  copd: { prefixes: ["J44"], note: "COPD all stages" },
  asthma: { prefixes: ["J45"], note: "Asthma all types" },
  pneumonia: { prefixes: ["J18"], note: "Pneumonia unspecified (most common)" },
  // Renal
  "chronic kidney disease": { prefixes: ["N18"], note: "CKD all stages" },
  ckd: { prefixes: ["N18"], note: "CKD all stages" },
  "end stage renal disease": { prefixes: ["N18.5", "N18.6"], note: "ESRD" },
  // Oncology
  "breast cancer": { prefixes: ["C50"], note: "Breast cancer" },
  "lung cancer": { prefixes: ["C34"], note: "Bronchus and lung" },
  "colorectal cancer": {
    prefixes: ["C18", "C19", "C20"],
    note: "Colon + rectosigmoid + rectum",
  },
  "prostate cancer": { prefixes: ["C61"], note: "Prostate cancer" },
  lymphoma: {
    prefixes: ["C81", "C82", "C83", "C84", "C85"],
    note: "Hodgkin + NHL",
  },
  // Metabolic / Endocrine
  obesity: { prefixes: ["E66"], note: "Obesity all types" },
  dyslipidaemia: {
    prefixes: ["E78"],
    note: "Disorders of lipoprotein metabolism",
  },
  dyslipidemia: {
    prefixes: ["E78"],
    note: "Disorders of lipoprotein metabolism",
  },
  // Musculoskeletal
  "rheumatoid arthritis": {
    prefixes: ["M05", "M06"],
    note: "RA seropositive + seronegative",
  },
  osteoporosis: {
    prefixes: ["M80", "M81"],
    note: "Osteoporosis with/without fracture",
  },
  // Mental health
  depression: {
    prefixes: ["F32", "F33"],
    note: "Depressive episode + recurrent",
  },
  schizophrenia: { prefixes: ["F20"], note: "Schizophrenia" },
};

function resolveIcd(
  indication: string,
  extra: string[],
): { prefixes: string[]; rationale: string } {
  const key = indication.toLowerCase().trim();
  // Exact match
  if (ICD_MAP[key]) {
    const e = ICD_MAP[key];
    return {
      prefixes: [...new Set([...e.prefixes, ...extra])],
      rationale:
        e.note +
        (extra.length ? ` + caller-supplied: ${extra.join(", ")}` : ""),
    };
  }
  // Partial match (indication contains a known key or vice versa)
  for (const [mapKey, entry] of Object.entries(ICD_MAP)) {
    if (key.includes(mapKey) || mapKey.includes(key)) {
      return {
        prefixes: [...new Set([...entry.prefixes, ...extra])],
        rationale:
          `Matched "${mapKey}": ${entry.note}` +
          (extra.length ? ` + ${extra.join(", ")}` : ""),
      };
    }
  }
  // No match — return extra or empty
  if (extra.length) {
    return {
      prefixes: extra,
      rationale: `No built-in mapping for "${indication}"; using caller-supplied prefixes.`,
    };
  }
  return {
    prefixes: [],
    rationale: `Unknown indication "${indication}". Provide additional_icd_prefixes.`,
  };
}

// ── Dataset selection by country ──────────────────────────────────────────────

const COUNTRY_DATASETS: Record<
  string,
  { primary: string; secondary?: string }
> = {
  BR: { primary: "datasus_sih" },
  US: { primary: "ny_sparcs", secondary: "meps" },
  MX: { primary: "mexico_egresos" },
  EC: { primary: "ecuador_inec" },
  UY: { primary: "uruguay_eh" },
  CO: { primary: "colombia_rips" },
  AR: { primary: "argentina_ba" },
};

function datasetsForCountry(config: {
  primary: string;
  secondary?: string;
}): string[] {
  return [
    ...new Set([config.primary, config.secondary].filter(Boolean)),
  ] as string[];
}

// ── Plausibility benchmarks ───────────────────────────────────────────────────

// Annual inpatient hospitalisations as fraction of national/state population
// (conservative range — flags obvious errors, not fine-grained epidemiology)
interface RateRange {
  min: number;
  max: number;
}
const INPATIENT_RATE: Record<string, RateRange> = {
  // Diabetes
  E11: { min: 0.00015, max: 0.003 },
  E10: { min: 0.00005, max: 0.001 },
  E13: { min: 0.00002, max: 0.0005 },
  // Cardiovascular
  I50: { min: 0.0002, max: 0.005 },
  I21: { min: 0.0001, max: 0.002 },
  I22: { min: 0.00003, max: 0.0005 },
  I48: { min: 0.0001, max: 0.003 },
  I20: { min: 0.00005, max: 0.001 },
  I10: { min: 0.0002, max: 0.006 },
  I11: { min: 0.00005, max: 0.001 },
  I12: { min: 0.00003, max: 0.0005 },
  I13: { min: 0.00002, max: 0.0003 },
  I63: { min: 0.0001, max: 0.003 },
  I64: { min: 0.00003, max: 0.001 },
  // Respiratory
  J44: { min: 0.0001, max: 0.002 },
  J45: { min: 0.00005, max: 0.002 },
  J18: { min: 0.0002, max: 0.005 },
  // Renal
  N18: { min: 0.00005, max: 0.001 },
  // Oncology
  C50: { min: 0.00003, max: 0.0005 },
  C34: { min: 0.00002, max: 0.0004 },
  C18: { min: 0.00002, max: 0.0004 },
  C19: { min: 0.000005, max: 0.0001 },
  C20: { min: 0.00001, max: 0.0002 },
  C61: { min: 0.00002, max: 0.0004 },
  C81: { min: 0.000005, max: 0.0001 },
  C82: { min: 0.000005, max: 0.0001 },
  C83: { min: 0.000005, max: 0.0001 },
  C84: { min: 0.000005, max: 0.0001 },
  C85: { min: 0.000005, max: 0.0001 },
  // Metabolic
  E66: { min: 0.00001, max: 0.0005 },
  E78: { min: 0.00001, max: 0.0003 },
  // Musculoskeletal
  M05: { min: 0.000005, max: 0.0001 },
  M06: { min: 0.000005, max: 0.0001 },
  M80: { min: 0.00002, max: 0.0005 },
  M81: { min: 0.000005, max: 0.0001 },
  // Mental health
  F20: { min: 0.00003, max: 0.001 },
  F32: { min: 0.0001, max: 0.003 },
  F33: { min: 0.00005, max: 0.002 },
};

// Population denominators (approximate, used for plausibility only)
const POPULATION: Record<string, number> = {
  // Countries
  BR: 215_000_000,
  US: 335_000_000,
  MX: 130_000_000,
  EC: 18_000_000,
  UY: 3_500_000,
  CO: 51_000_000,
  AR: 46_000_000,
  // Brazilian states (UF codes)
  SP: 47_000_000,
  RJ: 17_000_000,
  MG: 21_000_000,
  BA: 15_000_000,
  RS: 11_000_000,
  PR: 12_000_000,
  PE: 10_000_000,
  CE: 9_000_000,
  PA: 9_000_000,
  MA: 7_000_000,
  SC: 8_000_000,
  GO: 7_000_000,
  AM: 4_000_000,
  PB: 4_000_000,
  ES: 4_000_000,
  RN: 4_000_000,
  MT: 4_000_000,
  MS: 3_000_000,
  PI: 3_000_000,
  AL: 3_000_000,
  DF: 3_000_000,
  SE: 2_000_000,
  TO: 2_000_000,
  RO: 2_000_000,
  AP: 900_000,
  RR: 700_000,
  AC: 900_000,
};

function getPopDenominator(countryCodes: string[], regions: string[]): number {
  // Use region populations when regions are specified and all map to known regions
  if (regions.length > 0) {
    const regionPops = regions.map((r) => POPULATION[r.toUpperCase()] ?? 0);
    if (regionPops.every((p) => p > 0))
      return regionPops.reduce((a, b) => a + b, 0);
  }
  const countryPops = countryCodes.map((c) => POPULATION[c.toUpperCase()] ?? 0);
  if (countryPops.some((p) => p > 0))
    return countryPops.reduce((a, b) => a + b, 0);
  return 0;
}

function checkPlausibility(
  prefixes: string[],
  byYear: { year: number; record_count: number }[],
  population: number,
): { tier: "high" | "medium" | "low"; passed: string[]; failed: string[] } {
  const passed: string[] = [];
  const failed: string[] = [];

  if (byYear.length === 0 || population === 0) {
    return {
      tier: "low",
      passed,
      failed: ["No data or unknown population — cannot assess plausibility"],
    };
  }

  // Get the rate benchmark for the primary prefix
  const primaryPrefix = prefixes[0]?.substring(0, 3);
  const bench = primaryPrefix ? INPATIENT_RATE[primaryPrefix] : null;

  if (bench) {
    const nonCovid = byYear.filter((r) => r.year !== 2020);
    const avgCount =
      nonCovid.length > 0
        ? nonCovid.reduce((s, r) => s + r.record_count, 0) / nonCovid.length
        : byYear.reduce((s, r) => s + r.record_count, 0) / byYear.length;

    const rate = avgCount / population;
    if (rate >= bench.min && rate <= bench.max) {
      passed.push(
        `Annual count (avg ${Math.round(avgCount).toLocaleString()}) within expected range for ${primaryPrefix}`,
      );
    } else if (rate < bench.min / 10 || rate > bench.max * 10) {
      failed.push(
        `Annual count (avg ${Math.round(avgCount).toLocaleString()}) is far outside expected range for ${primaryPrefix} (rate ${(rate * 1000).toFixed(3)}‰ vs expected ${(bench.min * 1000).toFixed(3)}–${(bench.max * 1000).toFixed(3)}‰ of population)`,
      );
    } else {
      passed.push(
        `Annual count within order-of-magnitude range for ${primaryPrefix}`,
      );
    }
  }

  // YoY consistency (exclude 2020 COVID drop)
  const sorted = [...byYear].sort((a, b) => a.year - b.year);
  const anomalies: string[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.year === 2020 || prev.year === 2020) continue;
    if (prev.record_count > 0) {
      const change =
        Math.abs(curr.record_count - prev.record_count) / prev.record_count;
      if (change > 0.5)
        anomalies.push(
          `${prev.year}→${curr.year}: ${(change * 100).toFixed(0)}% change`,
        );
    }
  }
  if (anomalies.length === 0) {
    passed.push(
      "Year-over-year counts are consistent (no anomalous jumps outside COVID year)",
    );
  } else {
    failed.push(`Large YoY changes detected: ${anomalies.join("; ")}`);
  }

  // COVID note
  const covid = byYear.find((r) => r.year === 2020);
  if (covid) {
    const pre = byYear.find((r) => r.year === 2019);
    if (pre && pre.record_count > 0) {
      const drop = (pre.record_count - covid.record_count) / pre.record_count;
      if (drop > 0.05)
        passed.push(
          `2020 COVID-year drop (${(drop * 100).toFixed(0)}%) is expected — not flagged as anomaly`,
        );
    }
  }

  const tier: "high" | "medium" | "low" =
    failed.length === 0
      ? "high"
      : failed.length === 1 && passed.length > 0
        ? "medium"
        : "low";

  return { tier, passed, failed };
}

// ── Zod schema ────────────────────────────────────────────────────────────────

const QueryAgentSchema = z.object({
  indication: z
    .string()
    .min(2)
    .describe(
      "Clinical indication in plain English, e.g. 'type 2 diabetes inpatient' or 'heart failure'.",
    ),
  country_codes: z
    .array(z.string().length(2))
    .min(1)
    .describe("ISO-2 country codes, e.g. ['BR'] or ['US','BR']."),
  regions: z
    .array(z.string())
    .default([])
    .describe(
      "State/region codes, e.g. ['SP','RJ'] for Brazil or ['Northeast'] for US.",
    ),
  year_from: z.number().int().min(2010).max(2030).optional(),
  year_to: z.number().int().min(2010).max(2030).optional(),
  age_min: z.number().int().min(0).max(130).optional(),
  age_max: z.number().int().min(0).max(130).optional(),
  sex: z.enum(["male", "female", "all"]).default("all"),
  purpose: z
    .enum(["population_sizing", "budget_impact", "epidemiology"])
    .default("population_sizing"),
  additional_icd_prefixes: z.array(z.string()).default([]),
});

type QueryAgentInput = z.infer<typeof QueryAgentSchema>;

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleQueryAgent(rawInput: unknown): Promise<ToolResult> {
  const parsed = QueryAgentSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues
        .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
        .join("\n"),
    );
  }
  const input: QueryAgentInput = parsed.data;

  // Step 1: Resolve ICD codes
  const { prefixes, rationale } = resolveIcd(
    input.indication,
    input.additional_icd_prefixes,
  );
  if (prefixes.length === 0) {
    return {
      content: JSON.stringify({
        status: "no_data",
        message: `Cannot resolve ICD-10 codes for "${input.indication}". Provide additional_icd_prefixes to override.`,
        indication_resolved: { icd10_prefixes: [], rationale },
      }),
      audit: createAuditRecord(
        "data.query_agent",
        { indication: input.indication },
        "json",
      ),
    };
  }

  // Step 2: Run queries per country
  const results: unknown[] = [];
  for (const country of input.country_codes) {
    const countryCode = country.toUpperCase();
    const dsConfig = COUNTRY_DATASETS[countryCode];
    if (!dsConfig) {
      results.push({
        country,
        status: "unsupported",
        note: `No dataset mapped for country ${country}`,
      });
      continue;
    }
    const datasets = datasetsForCountry(dsConfig);
    const population = getPopDenominator([countryCode], input.regions);

    const queryInput = {
      datasets,
      icd10_prefixes: prefixes,
      regions: input.regions.length > 0 ? input.regions : undefined,
      year_from: input.year_from,
      year_to: input.year_to,
      age_min: input.age_min,
      age_max: input.age_max,
      sex: input.sex,
      aggregation: "prevalence" as const,
    };

    let rawResult: unknown;
    try {
      const toolResult = await handleClaimsQuery(queryInput);
      rawResult = JSON.parse(
        typeof toolResult.content === "string"
          ? toolResult.content
          : ((toolResult.content as Array<{ text: string }>)[0]?.text ?? "{}"),
      );
    } catch (e) {
      results.push({
        country,
        dataset: dsConfig.primary,
        datasets,
        status: "error",
        note: String(e),
      });
      continue;
    }

    const r = rawResult as Record<string, unknown>;
    if (r.status === "no_data") {
      results.push({
        country,
        dataset: dsConfig.primary,
        datasets,
        status: "no_data",
        note: r.message,
      });
      continue;
    }

    const queryResults = r.results as {
      total_records: number;
      by_year: { year: number; record_count: number }[];
    };
    const byYear = queryResults?.by_year ?? [];
    const yearsWithData = byYear.map((y) => y.year);

    // Year coverage check
    const yearsRequested: number[] = [];
    if (input.year_from && input.year_to) {
      for (let y = input.year_from; y <= input.year_to; y++)
        yearsRequested.push(y);
    }
    const yearsMissing = yearsRequested.filter(
      (y) => !yearsWithData.includes(y),
    );

    // Plausibility
    const plausibility = checkPlausibility(prefixes, byYear, population);

    // Recommended estimate: mean of non-COVID years within range
    const nonCovid = byYear.filter((y) => y.year !== 2020);
    const recValue =
      nonCovid.length > 0
        ? Math.round(
            nonCovid.reduce((s, y) => s + y.record_count, 0) / nonCovid.length,
          )
        : byYear.length > 0
          ? Math.round(
              byYear.reduce((s, y) => s + y.record_count, 0) / byYear.length,
            )
          : 0;

    const recBasis =
      nonCovid.length > 0
        ? `Mean ${nonCovid.map((y) => y.year).join("/")} ${input.regions.join("/") || country} ${datasets.join("+")} (COVID year 2020 excluded from mean)`
        : `Mean all years ${input.regions.join("/") || country} ${datasets.join("+")}`;

    results.push({
      country,
      dataset: dsConfig.primary,
      datasets,
      status: "ok",
      years_covered: yearsWithData,
      years_missing: yearsMissing,
      total_records: queryResults.total_records,
      by_year: byYear,
      plausibility,
      recommended_estimate: {
        value: recValue,
        basis: recBasis,
        uncertainty:
          plausibility.tier === "high"
            ? "low"
            : plausibility.tier === "medium"
              ? "medium"
              : "high",
      },
    });
  }

  // Overall status
  const okResults = results.filter(
    (r) => (r as Record<string, unknown>).status === "ok",
  );
  const overallStatus =
    okResults.length > 0
      ? okResults.some(
          (r) =>
            (r as Record<string, unknown>).plausibility &&
            (
              (r as Record<string, unknown>).plausibility as Record<
                string,
                unknown
              >
            ).tier === "low",
        )
        ? "low_confidence"
        : "ok"
      : "no_data";

  return {
    content: JSON.stringify(
      {
        status: overallStatus,
        indication_resolved: { icd10_prefixes: prefixes, rationale },
        results,
        data_caveats: [
          "Record counts represent inpatient admissions billed to the public health system only; private hospital admissions are not captured.",
          "Plausibility benchmarks are order-of-magnitude checks — do not use as epidemiological evidence.",
          "Year 2020 excluded from recommended estimate mean due to COVID-19 care disruption effect.",
          ...(results.some(
            (r) =>
              (r as Record<string, unknown>).years_missing &&
              ((r as Record<string, unknown>).years_missing as unknown[])
                .length > 0,
          )
            ? [
                "Some requested years have no data — check ETL completion for those years.",
              ]
            : []),
        ],
      },
      null,
      2,
    ),
    audit: createAuditRecord(
      "data.query_agent",
      { indication: input.indication, country_codes: input.country_codes },
      "json",
    ),
  };
}

// ── Tool schema ───────────────────────────────────────────────────────────────

export const queryAgentToolSchema = {
  name: "data.query_agent",
  description:
    "Validated epidemiology agent. Use this INSTEAD of data.claims_query when you need " +
    "population-level estimates for budget impact models or population sizing. " +
    "Automatically resolves clinical indications to ICD-10 codes, selects the right dataset " +
    "by country, runs the query, validates counts for plausibility, checks year coverage, " +
    "and returns a structured result with a confidence tier and recommended estimate. " +
    "Supports: BR (datasus_sih 2018-2024), US (ny_sparcs 2017-2024 + meps 2017-2023), " +
    "MX (mexico_egresos 2018-2025), EC (ecuador_inec 2022-2023), UY (uruguay_eh 2016-2024), " +
    "CO (colombia_rips 2018-2023), AR (argentina_ba 2016-2020). " +
    "Built-in ICD-10 map covers: T2D, HF, AMI, stroke, COPD, asthma, CKD, breast/lung cancer, and 20+ more.",
  annotations: {
    title: "Validated Epidemiology Query Agent",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      indication: {
        type: "string",
        description:
          "Clinical indication in plain English: 'type 2 diabetes inpatient', 'heart failure', 'COPD', 'breast cancer'. Maps to ICD-10 automatically.",
      },
      country_codes: {
        type: "array",
        items: { type: "string" },
        description:
          "ISO-2 country codes: ['BR'], ['US'], ['MX'], ['EC'], ['UY'], ['CO'], ['AR'].",
      },
      regions: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional region filter. Brazil UF codes: ['SP','RJ','MG']. US census: ['Northeast','South'].",
        default: [],
      },
      year_from: { type: "integer", minimum: 2010, maximum: 2030 },
      year_to: { type: "integer", minimum: 2010, maximum: 2030 },
      age_min: { type: "integer", minimum: 0, maximum: 130 },
      age_max: { type: "integer", minimum: 0, maximum: 130 },
      sex: { type: "string", enum: ["male", "female", "all"], default: "all" },
      purpose: {
        type: "string",
        enum: ["population_sizing", "budget_impact", "epidemiology"],
        description:
          "Drives how the recommended_estimate is framed in the output.",
        default: "population_sizing",
      },
      additional_icd_prefixes: {
        type: "array",
        items: { type: "string" },
        description:
          "Override or supplement auto-resolved ICD-10 prefixes. Use when the indication isn't in the built-in map.",
        default: [],
      },
    },
    required: ["indication", "country_codes"],
  },
} as const;
