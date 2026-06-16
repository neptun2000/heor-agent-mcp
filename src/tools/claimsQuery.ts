/**
 * data.claims_query — real-world claims & survey data query tool.
 *
 * Design log #28. Tool #29. Target: v1.12.0.
 *
 * Storage: Hive-partitioned Parquet on Azure Blob Storage.
 *   heor-claims/claims_visits/
 *     source_dataset=namcs/source_year=2022/data.parquet
 *     source_dataset=datasus_sih/source_year=2022/region=SP/data.parquet
 *
 * Query engine: DuckDB (embedded, azure extension) — partition pruning means
 * querying 2022 never reads 2019 files; adding a new year = upload one file.
 *
 * Env vars:
 *   AZURE_STORAGE_CONNECTION_STRING  — Blob Storage connection string
 *   AZURE_STORAGE_CONTAINER          — container name (default: heor-claims)
 */

import { z } from "zod";
import type { ToolResult } from "../providers/types.js";
import { createAuditRecord } from "../audit/builder.js";

// ── Zod schema ────────────────────────────────────────────────────────────────

const DATASET_VALUES = [
  // US datasets
  "namcs", // NCHS National Ambulatory Medical Care Survey (physician office visits)
  "nhamcs_ed", // NCHS NHAMCS Emergency Department, 2011-2022, ~250K visits/yr
  "meps", // AHRQ Medical Expenditure Panel Survey, 2017-2023, ~500K events/yr with costs
  "ny_sparcs", // NY State inpatient discharges, 2017-2022 + 2024 (no 2023), ~2M/yr
  "nhanes", // NCHS health examination survey, 1999-2021, ~10K persons/cycle
  "nhis", // NCHS health interview survey, 2016-2023, ~25K persons/yr
  // Latin America
  "ecuador_inec", // Ecuador INEC hospital discharges, 2022-2023, ~1.1M/yr
  "uruguay_eh", // Uruguay Encuesta de Hogares household SURVEY — NO ICD codes; ICD queries return zero. Visit-frequency analysis only.
  "mexico_egresos", // Mexico DGIS egresos hospitalarios, 2018-2025, multi-million/yr
  "brazil_datasus", // Brazil DataSUS SIH inpatient, multiple years
  "chile_deis", // Chile DEIS egresos hospitalarios, 2018-2024, ~1.6M/yr
  "colombia_rips", // Colombia RIPS health services 2018-2023 — secondary_diags field sparse; comorbidity queries return empty
  "argentina_ba", // Argentina Buenos Aires hospital discharges, 2016-2020
  // Legacy names kept for backward compat
  "datasus_sih",
  "datasus_sia",
  "datasus_sim",
  "nhamcs_opd",
  "all",
] as const;

const ClaimsQuerySchema = z.object({
  datasets: z.array(z.enum(DATASET_VALUES)).min(1).default(["all"]),
  icd10_prefixes: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "ICD-10 prefixes: ['E11'] = Type 2 diabetes, ['I21'] = AMI, ['C50'] = breast cancer.",
    ),
  drug_names: z.array(z.string().min(1)).optional(),
  regions: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Region/state codes to filter on. For Brazil datasus: UF codes e.g. ['SP','RJ','MG']. " +
        "For US NAMCS/MEPS: census region codes e.g. ['Northeast','South']. Leave unset for all regions.",
    ),
  age_min: z.number().int().min(0).max(130).optional(),
  age_max: z.number().int().min(0).max(130).optional(),
  sex: z.enum(["male", "female", "all"]).default("all"),
  year_from: z
    .number()
    .int()
    .min(2000)
    .max(2030)
    .optional()
    .describe(
      "Start year (inclusive). Always specify for comorbidities/drug_utilization on large datasets " +
        "(colombia_rips, mexico_egresos) — unfiltered scans time out at 90s.",
    ),
  year_to: z.number().int().min(2000).max(2030).optional(),
  aggregation: z
    .enum([
      "prevalence",
      "count",
      "drug_utilization",
      "demographics",
      "comorbidities",
      "cost",
    ])
    .describe(
      "prevalence/count: record counts and weighted estimates by year (use for population sizing). " +
        "drug_utilization: top drugs by frequency. demographics: age/sex breakdown. " +
        "comorbidities: top co-diagnosis ICD-10 codes. cost: cost distribution statistics.",
    ),
  top_n: z.number().int().min(5).max(50).default(20),
});

type ClaimsQueryInput = z.infer<typeof ClaimsQuerySchema>;

// ── DuckDB singleton (@duckdb/node-api, async, N-API) ────────────────────────

import type { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

let _instance: DuckDBInstance | null = null;
let _conn: DuckDBConnection | null = null;
let _dbInitializing: Promise<DuckDBConnection> | null = null;

// Serialize all DuckDB queries — concurrent large scans on the same in-process
// DuckDB instance exhaust Azure App Service memory (1.75 GB limit) and crash.
// The timeout rejects the caller after 90s but keeps the lock until the underlying
// DuckDB query finishes — no orphaned concurrent scans, no OOM.
const QUERY_TIMEOUT_MS = 90_000;
let _queryQueue: Promise<unknown> = Promise.resolve();

function abortError(): Error {
  return new Error(
    "DuckDB query cancelled before execution because the client disconnected.",
  );
}

export function withDbLock<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let started = false;
  const run = async () => {
    if (signal?.aborted) throw abortError();
    started = true;
    return fn();
  };
  const lockPromise = _queryQueue.then(run);
  _queryQueue = lockPromise.catch(() => {});
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup: Array<() => void> = [];
    const resolveOnce = (value: T) => {
      if (settled) return;
      settled = true;
      cleanup.forEach((fn) => fn());
      resolve(value);
    };
    const rejectOnce = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup.forEach((fn) => fn());
      reject(err);
    };

    const timer = setTimeout(
      () =>
        rejectOnce(
          new Error(
            "DuckDB query timed out (90s). Reduce the date range, filter to specific regions, " +
              "or build/use the claims summary layer for nationwide population-sizing scans.",
          ),
        ),
      QUERY_TIMEOUT_MS,
    );
    cleanup.push(() => clearTimeout(timer));

    if (signal) {
      const onAbort = () => {
        if (!started) rejectOnce(abortError());
      };
      if (signal.aborted) {
        rejectOnce(abortError());
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
        cleanup.push(() => signal.removeEventListener("abort", onAbort));
      }
    }

    lockPromise.then(
      (v) => resolveOnce(v),
      (e: unknown) => rejectOnce(e),
    );
  });
}

function coerceBigInt(v: unknown): unknown {
  if (typeof v === "bigint") {
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) return String(v);
    return Number(v);
  }
  return v;
}

async function dbAll(
  conn: DuckDBConnection,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const reader = await conn.runAndReadAll(sql);
  const rows = reader.getRowObjects() as Record<string, unknown>[];
  return rows.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, coerceBigInt(v)])),
  );
}

async function initDb(connStr: string): Promise<DuckDBConnection> {
  const { DuckDBInstance: DDB } = await import("@duckdb/node-api");
  _instance = await DDB.create(":memory:");
  const conn = await _instance.connect();
  // Install azure extension once — cached in ~/.duckdb/extensions/
  try {
    await conn.run("INSTALL azure;");
  } catch {
    // already installed — ok
  }
  await conn.run("LOAD azure;");
  // Cap memory to 1 GB — Azure App Service B2 has 1.75 GB total; leave headroom for Node.js
  await conn.run("SET memory_limit = '1GB';");
  await conn.run("SET threads = 2;");
  const safe = connStr.replace(/'/g, "''");
  await conn.run(`SET azure_storage_connection_string = '${safe}';`);
  return conn;
}

async function getDb(): Promise<DuckDBConnection> {
  if (_conn) return _conn;
  if (_dbInitializing) return _dbInitializing;

  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) {
    throw new Error(
      "AZURE_STORAGE_CONNECTION_STRING is not set. " +
        "Set it in your environment to use data.claims_query. " +
        "Format: DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net",
    );
  }

  _dbInitializing = initDb(connStr)
    .then((conn) => {
      _conn = conn;
      _dbInitializing = null;
      return conn;
    })
    .catch((e: unknown) => {
      _dbInitializing = null;
      throw e;
    });
  return _dbInitializing;
}

// ── Parquet path helpers ──────────────────────────────────────────────────────

const DATASUS_NAMES = new Set(["datasus_sih", "brazil_datasus"]);
const SUMMARY_ENABLED_DATASETS = new Set([
  "datasus_sih",
  "mexico_egresos",
  "chile_deis",
  "ny_sparcs",
]);
const SUMMARY_AVAILABLE_YEARS: Record<string, number[]> = {
  datasus_sih: [2018, 2019, 2020, 2021, 2022, 2023, 2024],
  mexico_egresos: [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
  chile_deis: [2018, 2019, 2020, 2021, 2022, 2023, 2024],
  ny_sparcs: [2017, 2018, 2019, 2020, 2021, 2022, 2024],
};
const DATASET_STORAGE_NAMES: Record<string, string> = {
  brazil_datasus: "datasus_sih",
};
const storageDatasetName = (ds: string): string =>
  DATASET_STORAGE_NAMES[ds] ?? ds;

function activeStorageDatasets(input: ClaimsQueryInput): string[] {
  const active = input.datasets.includes("all")
    ? []
    : input.datasets.filter((d) => d !== "all");
  return [...new Set(active.map(storageDatasetName))];
}

function isDatasusOnlyInput(input: ClaimsQueryInput): boolean {
  const active = input.datasets.includes("all")
    ? []
    : input.datasets.filter((d) => d !== "all");
  return active.length > 0 && active.every((d) => DATASUS_NAMES.has(d));
}

function summaryDatasetForInput(input: ClaimsQueryInput): string | null {
  const activeStorage = activeStorageDatasets(input);
  if (
    (input.aggregation === "prevalence" || input.aggregation === "count") &&
    activeStorage.length === 1 &&
    !input.drug_names?.length &&
    SUMMARY_ENABLED_DATASETS.has(activeStorage[0])
  ) {
    return activeStorage[0];
  }
  return null;
}

function shouldUseClaimsSummary(input: ClaimsQueryInput): boolean {
  return summaryDatasetForInput(input) != null;
}

// Build explicit year list for partition pruning. Querying year_from=2021,year_to=2023
// produces paths like source_year=2021/**, source_year=2022/**, source_year=2023/**
// so DuckDB never downloads files outside the requested range.
function buildYearRange(
  yearFrom: number | undefined,
  yearTo: number | undefined,
): number[] | null {
  if (yearFrom === undefined && yearTo === undefined) return null;
  const from = yearFrom ?? 2000;
  const to = yearTo ?? 2030;
  const span = to - from + 1;
  if (span <= 0 || span > 50) return null;
  return Array.from({ length: span }, (_, i) => from + i);
}

function parquetPaths(input: ClaimsQueryInput): {
  pathSql: string;
  skipRegionWhere: boolean;
} {
  const container = process.env.AZURE_STORAGE_CONTAINER ?? "heor-claims";
  const base = `azure://${container}/claims_visits`;

  const active = input.datasets.includes("all")
    ? []
    : input.datasets.filter((d) => d !== "all");
  const isDatasusOnly = isDatasusOnlyInput(input);

  const yearRange = buildYearRange(input.year_from, input.year_to);

  // datasus_sih stores `region` as a Hive path segment, not a data column.
  // With hive_partitioning=false that column is unavailable, so WHERE region='SP'
  // always returns zero rows. Use path-based filtering whenever regions are requested.
  if (
    (isDatasusOnly || input.datasets.includes("all")) &&
    input.regions != null &&
    input.regions.length > 0
  ) {
    const paths: string[] = [];
    for (const r of input.regions) {
      const safeR = r.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      const yearSegs = yearRange
        ? yearRange.map((y) => `source_year=${y}`)
        : ["*"];
      for (const yearSeg of yearSegs) {
        paths.push(
          `'${base}/source_dataset=datasus_sih/${yearSeg}/region=${safeR}/*.parquet'`,
        );
      }
    }
    return { pathSql: `[${paths.join(", ")}]`, skipRegionWhere: true };
  }

  // Year-range partition pruning.
  // DataSUS stores files one level deeper: source_year=Y/region=XX/data.parquet
  // All other datasets are flat:           source_year=Y/data.parquet
  // DuckDB Azure extension throws "No files found" when any pattern in a list
  // has zero matches, so we cannot mix *.parquet (flat) with */*.parquet
  // (nested) in a single list — each dataset gets the correct depth.
  // Wildcard ds="*" gets both patterns so mixed-dataset queries still work.
  const dsSegs =
    active.length > 0 ? [...new Set(active.map(storageDatasetName))] : ["*"];

  if (yearRange) {
    const paths: string[] = [];
    for (const y of yearRange) {
      for (const ds of dsSegs) {
        if (ds === "*") {
          // Mixed: both patterns needed; DuckDB tolerates empty globs in "all"
          // queries because at least one pattern will always match.
          paths.push(`'${base}/source_dataset=*/source_year=${y}/*.parquet'`);
          paths.push(`'${base}/source_dataset=*/source_year=${y}/*/*.parquet'`);
        } else if (DATASUS_NAMES.has(ds)) {
          // Nested: region=XX/ subdirectory between year and file
          paths.push(
            `'${base}/source_dataset=${ds}/source_year=${y}/*/*.parquet'`,
          );
        } else {
          // Flat: file sits directly under source_year=Y/
          paths.push(
            `'${base}/source_dataset=${ds}/source_year=${y}/*.parquet'`,
          );
        }
      }
    }
    return { pathSql: `[${paths.join(", ")}]`, skipRegionWhere: false };
  }

  if (dsSegs[0] !== "*") {
    const paths = dsSegs.map(
      (ds) => `'${base}/source_dataset=${ds}/**/*.parquet'`,
    );
    return {
      pathSql: paths.length === 1 ? paths[0] : `[${paths.join(", ")}]`,
      skipRegionWhere: false,
    };
  }
  return { pathSql: `'${base}/**/*.parquet'`, skipRegionWhere: false };
}

function claimsSummaryPathSql(input: ClaimsQueryInput, dataset: string): string {
  const container = process.env.AZURE_STORAGE_CONTAINER ?? "heor-claims";
  const safeDataset = dataset.replace(/[^A-Za-z0-9_]/g, "");
  const base = `azure://${container}/claims_visits_summary/source_dataset=${safeDataset}`;
  const yearRange = buildYearRange(input.year_from, input.year_to);

  if (yearRange) {
    const availableYears = SUMMARY_AVAILABLE_YEARS[safeDataset] ?? yearRange;
    const selectedYears = yearRange.filter((y) => availableYears.includes(y));
    if (selectedYears.length === 0) {
      throw new Error(
        `No claims summary parquet years loaded for ${safeDataset} in requested range.`,
      );
    }
    const paths = selectedYears.map(
      (y) => `'${base}/source_year=${y}/primary_diag_counts.parquet'`,
    );
    return paths.length === 1 ? paths[0] : `[${paths.join(", ")}]`;
  }

  return `'${base}/*/primary_diag_counts.parquet'`;
}

// ── WHERE clause builder (sanitised — all values come from Zod-validated input) ──

function buildWhere(input: ClaimsQueryInput, skipRegion = false): string {
  const parts: string[] = [];

  // Dataset filter (values from enum — safe to inline)
  // Map aliases (brazil_datasus → datasus_sih) so the WHERE matches the actual
  // source_dataset column value written by the ETL.
  const activeStorage = activeStorageDatasets(input);
  if (activeStorage.length === 1) {
    parts.push(`source_dataset = '${activeStorage[0]}'`);
  } else if (activeStorage.length > 1) {
    parts.push(
      `source_dataset IN (${activeStorage.map((d) => `'${d}'`).join(",")})`,
    );
  }

  // Year range (integers — safe to inline)
  if (input.year_from !== undefined)
    parts.push(`source_year >= ${input.year_from}`);
  if (input.year_to !== undefined)
    parts.push(`source_year <= ${input.year_to}`);

  // Age (integers — safe)
  if (input.age_min !== undefined) parts.push(`age_years >= ${input.age_min}`);
  if (input.age_max !== undefined) parts.push(`age_years <= ${input.age_max}`);

  // Sex (enum — safe)
  if (input.sex !== "all") parts.push(`sex = '${input.sex}'`);

  // ICD-10 prefix filter. ETL normalises source-specific coding quirks (for
  // example NY SPARCS CCSR categories) into ICD-10 prefixes before upload.
  if (input.icd10_prefixes.length > 0) {
    const icdLikes = input.icd10_prefixes.map((p) => {
      const safe = p.replace(/[^A-Za-z0-9.]/g, "").toUpperCase();
      return `primary_diag_icd LIKE '${safe}%'`;
    });
    parts.push(`(${icdLikes.join(" OR ")})`);
  }

  // Region filter — sanitise to [A-Za-z0-9 \-] only before inlining.
  // Skipped when path-based region filtering is active (datasus_sih).
  if (!skipRegion && input.regions && input.regions.length > 0) {
    const safeRegions = input.regions.map((r) =>
      r.replace(/[^A-Za-z0-9 \-]/g, "").toUpperCase(),
    );
    if (safeRegions.length === 1) {
      parts.push(`region = '${safeRegions[0]}'`);
    } else {
      parts.push(`region IN (${safeRegions.map((r) => `'${r}'`).join(",")})`);
    }
  }

  // Drug filter — use raw JSON string contains (safe: drug names are alphanumeric)
  if (input.drug_names && input.drug_names.length > 0) {
    const drugParts = input.drug_names.map((d) => {
      const safe = d.replace(/[^A-Za-z0-9 \-]/g, "").toLowerCase();
      return `LOWER(COALESCE(drugs_mentioned,'')) LIKE '%${safe}%'`;
    });
    parts.push(`(${drugParts.join(" OR ")})`);
  }

  return parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "WHERE 1=1";
}

function buildClaimsSummaryWhere(
  input: ClaimsQueryInput,
  dataset: string,
): string {
  const safeDataset = dataset.replace(/[^A-Za-z0-9_]/g, "");
  const parts: string[] = [`source_dataset = '${safeDataset}'`];

  if (input.year_from !== undefined)
    parts.push(`source_year >= ${input.year_from}`);
  if (input.year_to !== undefined)
    parts.push(`source_year <= ${input.year_to}`);

  if (input.age_min !== undefined) parts.push(`age_years >= ${input.age_min}`);
  if (input.age_max !== undefined) parts.push(`age_years <= ${input.age_max}`);

  if (input.sex !== "all") parts.push(`sex = '${input.sex}'`);

  if (input.icd10_prefixes.length > 0) {
    const icdLikes = input.icd10_prefixes.map((p) => {
      const safe = p.replace(/[^A-Za-z0-9.]/g, "").toUpperCase();
      return `primary_diag_icd LIKE '${safe}%'`;
    });
    parts.push(`(${icdLikes.join(" OR ")})`);
  }

  if (input.regions && input.regions.length > 0) {
    const safeRegions = input.regions.map((r) =>
      r.replace(/[^A-Za-z0-9 \-]/g, "").toUpperCase(),
    );
    if (safeRegions.length === 1) {
      parts.push(`region = '${safeRegions[0]}'`);
    } else {
      parts.push(`region IN (${safeRegions.map((r) => `'${r}'`).join(",")})`);
    }
  }

  return `WHERE ${parts.join(" AND ")}`;
}

// Exclusion prefixes for comorbidities (exclude the queried condition itself)
function buildIcdExclusion(prefixes: string[]): string {
  return prefixes
    .map((p) => {
      const safe = p.replace(/[^A-Za-z0-9.]/g, "").toUpperCase();
      return `icd NOT LIKE '${safe}%'`;
    })
    .join(" AND ");
}

// ── Aggregation queries ───────────────────────────────────────────────────────

function formatPrevalenceRows(rows: Record<string, unknown>[]): unknown {
  const byYear = new Map<
    number,
    {
      record_count: number;
      weighted_sum: number;
      hasWeight: boolean;
      datasets: Set<string>;
    }
  >();
  for (const r of rows) {
    const yr = r["source_year"] as number;
    const wc = r["weighted_count"] as number;
    if (!byYear.has(yr))
      byYear.set(yr, {
        record_count: 0,
        weighted_sum: 0,
        hasWeight: false,
        datasets: new Set(),
      });
    const b = byYear.get(yr)!;
    b.record_count += r["record_count"] as number;
    b.weighted_sum += r["weighted_sum"] as number;
    b.hasWeight = b.hasWeight || wc > 0;
    b.datasets.add(r["source_dataset"] as string);
  }

  const by_year = [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, v]) => ({
      year,
      record_count: v.record_count,
      ...(v.hasWeight ? { weighted_estimate: Math.round(v.weighted_sum) } : {}),
      datasets: [...v.datasets],
    }));

  const totalWeight = by_year.some((r) => r.weighted_estimate != null)
    ? by_year.reduce((s, r) => s + (r.weighted_estimate ?? 0), 0)
    : null;

  return {
    total_records: rows.reduce((s, r) => s + (r["record_count"] as number), 0),
    total_weighted_estimate: totalWeight,
    by_year,
  };
}

async function queryPrevalence(
  db: DuckDBConnection,
  pathSql: string,
  where: string,
): Promise<unknown> {
  const rows = await dbAll(
    db,
    `SELECT
       source_year,
       source_dataset,
       COUNT(*) AS record_count,
       SUM(CASE WHEN visit_weight IS NOT NULL THEN visit_weight ELSE 0 END) AS weighted_sum,
       COUNT(CASE WHEN visit_weight IS NOT NULL THEN 1 END) AS weighted_count
     FROM read_parquet(${pathSql}, hive_partitioning = false, union_by_name = true)
     ${where}
     GROUP BY source_year, source_dataset
     ORDER BY source_year`,
  );

  return formatPrevalenceRows(rows);
}

async function queryClaimsSummaryPrevalence(
  db: DuckDBConnection,
  input: ClaimsQueryInput,
  dataset: string,
): Promise<unknown> {
  const safeDataset = dataset.replace(/[^A-Za-z0-9_]/g, "");
  const pathSql = claimsSummaryPathSql(input, safeDataset);
  const where = buildClaimsSummaryWhere(input, safeDataset);
  const rows = await dbAll(
    db,
    `SELECT
       source_year,
       '${safeDataset}' AS source_dataset,
       SUM(record_count) AS record_count,
       0 AS weighted_sum,
       0 AS weighted_count
     FROM read_parquet(${pathSql}, hive_partitioning = false, union_by_name = true)
     ${where}
     GROUP BY source_year
     ORDER BY source_year`,
  );

  return formatPrevalenceRows(rows);
}

async function queryDrugUtilization(
  db: DuckDBConnection,
  pathSql: string,
  where: string,
  topN: number,
): Promise<unknown> {
  const rows = await dbAll(
    db,
    `WITH base AS (
       SELECT drugs_mentioned
       FROM read_parquet(${pathSql}, hive_partitioning = false, union_by_name = true)
       ${where}
     ),
     total AS (SELECT COUNT(*) AS n FROM base),
     top AS (
       SELECT LOWER(drug) AS drug, COUNT(*) AS visit_count
       FROM (SELECT UNNEST(string_split(drugs_mentioned, ';')) AS drug
             FROM base WHERE drugs_mentioned IS NOT NULL AND drugs_mentioned <> '')
       WHERE drug IS NOT NULL AND drug <> ''
       GROUP BY LOWER(drug)
       HAVING COUNT(*) >= 5
       ORDER BY visit_count DESC
       LIMIT ${topN}
     )
     SELECT top.drug, top.visit_count, total.n AS total_visits
     FROM top, total`,
  );

  const totalVisits = (rows[0]?.["total_visits"] as number) ?? 0;
  return {
    top_drugs: rows.map((r) => ({
      drug: r["drug"],
      visit_count: r["visit_count"],
      pct_of_visits:
        totalVisits > 0
          ? Math.round(((r["visit_count"] as number) / totalVisits) * 1000) / 10
          : 0,
    })),
    total_visits: totalVisits,
  };
}

async function queryDemographics(
  db: DuckDBConnection,
  pathSql: string,
  where: string,
): Promise<unknown> {
  const rows = await dbAll(
    db,
    `WITH base AS (
       SELECT age_years, sex, region
       FROM read_parquet(${pathSql}, hive_partitioning = false, union_by_name = true)
       ${where}
     ),
     age AS (
       SELECT
         'age' AS breakdown,
         CASE
           WHEN age_years BETWEEN 0 AND 17  THEN '0-17 (paediatric)'
           WHEN age_years BETWEEN 18 AND 44 THEN '18-44 (young adult)'
           WHEN age_years BETWEEN 45 AND 64 THEN '45-64 (middle-aged)'
           WHEN age_years BETWEEN 65 AND 74 THEN '65-74 (elderly)'
           WHEN age_years >= 75             THEN '75+ (very elderly)'
           ELSE 'unknown'
         END AS label,
         COUNT(*) AS count,
         MIN(age_years) AS sort_num
       FROM base
       WHERE age_years IS NOT NULL
       GROUP BY label
       HAVING COUNT(*) >= 5
     ),
     sex_breakdown AS (
       SELECT
         'sex' AS breakdown,
         COALESCE(sex, 'unknown') AS label,
         COUNT(*) AS count,
         0 AS sort_num
       FROM base
       GROUP BY COALESCE(sex, 'unknown')
     ),
     region_counts AS (
       SELECT
         'region' AS breakdown,
         region AS label,
         COUNT(*) AS count
       FROM base
       WHERE region IS NOT NULL
       GROUP BY region
       HAVING COUNT(*) >= 5
     ),
     region_ranked AS (
       SELECT
         breakdown,
         label,
         count,
         ROW_NUMBER() OVER (ORDER BY count DESC, label) AS sort_num
       FROM region_counts
     )
     SELECT breakdown, label, count, sort_num FROM age
     UNION ALL
     SELECT breakdown, label, count, sort_num FROM sex_breakdown
     UNION ALL
     SELECT breakdown, label, count, sort_num FROM region_ranked WHERE sort_num <= 10
     ORDER BY breakdown, sort_num`,
  );

  const ageRows = rows.filter((r) => r["breakdown"] === "age");
  const sexRows = rows.filter((r) => r["breakdown"] === "sex");
  const regionRows = rows.filter((r) => r["breakdown"] === "region");

  const total = ageRows.reduce((s, r) => s + (r["count"] as number), 0);
  return {
    age_groups: ageRows.map((r) => ({
      group: r["label"],
      count: r["count"],
      pct:
        total > 0
          ? Math.round(((r["count"] as number) / total) * 1000) / 10
          : 0,
    })),
    sex_distribution: Object.fromEntries(
      sexRows.map((r) => [r["label"] ?? "unknown", r["count"]]),
    ),
    top_regions: regionRows.map((r) => ({
      region: r["label"],
      count: r["count"],
    })),
    total,
  };
}

async function queryComorbidities(
  db: DuckDBConnection,
  pathSql: string,
  where: string,
  icd10Prefixes: string[],
  topN: number,
): Promise<unknown> {
  const exclusion =
    icd10Prefixes.length > 0 ? `AND ${buildIcdExclusion(icd10Prefixes)}` : "";
  return dbAll(
    db,
    `SELECT
       UPPER(icd) AS icd10,
       COUNT(*) AS count
     FROM (
       SELECT UNNEST(string_split(secondary_diags, ';')) AS icd
       FROM read_parquet(${pathSql}, hive_partitioning = false, union_by_name = true)
       ${where} AND secondary_diags IS NOT NULL AND secondary_diags <> ''
     )
     WHERE icd IS NOT NULL ${exclusion}
     GROUP BY UPPER(icd)
     HAVING COUNT(*) >= 5
     ORDER BY count DESC
     LIMIT ${topN}`,
  );
}

async function queryCost(
  db: DuckDBConnection,
  pathSql: string,
  where: string,
): Promise<unknown> {
  const rows = await dbAll(
    db,
    `SELECT
       local_currency,
       COUNT(*) AS n_with_cost,
       ROUND(AVG(total_cost_local), 2) AS mean,
       ROUND(MEDIAN(total_cost_local), 2) AS median,
       ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY total_cost_local), 2) AS p25,
       ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY total_cost_local), 2) AS p75,
       ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY total_cost_local), 2) AS p90
     FROM read_parquet(${pathSql}, hive_partitioning = false, union_by_name = true)
     ${where} AND total_cost_local IS NOT NULL AND total_cost_local > 0
     GROUP BY local_currency`,
  );

  if (rows.length === 0 || (rows[0]?.["n_with_cost"] as number) < 5) {
    return {
      note:
        "Insufficient cost data (< 5 records) — suppressed per disclosure rules. " +
        "Cost data is available for: meps (USD, total event cost), ny_sparcs (USD, total charges), " +
        "brazil_datasus/datasus_sih (BRL, authorised inpatient cost). " +
        "Make sure to include one of those datasets in your query.",
    };
  }
  return rows.map((r) => ({
    currency: r["local_currency"],
    n_with_cost: r["n_with_cost"],
    mean: r["mean"],
    median: r["median"],
    p25: r["p25"],
    p75: r["p75"],
    p90: r["p90"],
  }));
}

// ── Result cache (1 h TTL) ───────────────────────────────────────────────────

const CACHE_TTL_MS = 60 * 60 * 1000;
const _cache = new Map<string, { result: unknown; ts: number }>();

function _cacheKey(input: ClaimsQueryInput): string {
  return JSON.stringify([
    [...input.datasets].sort(),
    [...input.icd10_prefixes].sort(),
    input.drug_names ? [...input.drug_names].sort() : null,
    input.regions ? [...input.regions].sort() : null,
    input.age_min ?? null,
    input.age_max ?? null,
    input.sex,
    input.year_from ?? null,
    input.year_to ?? null,
    input.aggregation,
    input.top_n,
  ]);
}

function _cacheGet(key: string): unknown {
  const e = _cache.get(key);
  if (!e) return undefined;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    _cache.delete(key);
    return undefined;
  }
  return e.result;
}

function _cacheSet(key: string, result: unknown): void {
  if (_cache.size >= 100) {
    const oldest = [..._cache.entries()].sort(([, a], [, b]) => a.ts - b.ts)[0];
    if (oldest) _cache.delete(oldest[0]);
  }
  _cache.set(key, { result, ts: Date.now() });
}

type ClaimsExecutionSource =
  | "cache"
  | "datasus_summary"
  | "claims_summary"
  | "raw_parquet";

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleClaimsQuery(
  rawInput: unknown,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const parsed = ClaimsQuerySchema.safeParse(rawInput);
  if (!parsed.success) {
    const msgs = parsed.error.issues.map(
      (i) => `${i.path.join(".") || "input"}: ${i.message}`,
    );
    throw new Error(msgs.join("\n"));
  }
  const input: ClaimsQueryInput = parsed.data;

  const audit = createAuditRecord(
    "data.claims_query",
    rawInput as Record<string, unknown>,
    "json",
    "Azure Blob Storage hive-partitioned Parquet via DuckDB. " +
      "Sources: NAMCS/NHAMCS (CDC/NCHS), DataSUS SIH/SIA/SIM (Brazilian MOH). Design log #28.",
  );

  const cacheKey = _cacheKey(input);
  const cachedResults = _cacheGet(cacheKey);

  const db = await getDb();
  const { pathSql, skipRegionWhere } = parquetPaths(input);
  const where = buildWhere(input, skipRegionWhere);
  const summaryDataset = summaryDatasetForInput(input);
  let results: unknown;
  let executionSource: ClaimsExecutionSource = "raw_parquet";
  let summaryFallbackError: string | null = null;

  if (cachedResults !== undefined) {
    results = cachedResults;
    executionSource = "cache";
  } else {
    if (summaryDataset) {
      try {
        results = await withDbLock(
          () => queryClaimsSummaryPrevalence(db, input, summaryDataset),
          signal,
        );
        executionSource =
          summaryDataset === "datasus_sih" ? "datasus_summary" : "claims_summary";
      } catch (e) {
        summaryFallbackError = String(e);
      }
    }

    if (results === undefined) {
      results = await withDbLock(async () => {
        switch (input.aggregation) {
          case "prevalence":
          case "count":
            return queryPrevalence(db, pathSql, where);
          case "drug_utilization":
            return queryDrugUtilization(db, pathSql, where, input.top_n);
          case "demographics":
            return queryDemographics(db, pathSql, where);
          case "comorbidities":
            return queryComorbidities(
              db,
              pathSql,
              where,
              input.icd10_prefixes,
              input.top_n,
            );
          case "cost":
            return queryCost(db, pathSql, where);
          default:
            throw new Error(
              `Unknown aggregation type: ${(input as { aggregation: string }).aggregation}`,
            );
        }
      }, signal);
      executionSource = "raw_parquet";
    }

    _cacheSet(cacheKey, results);
  }

  return {
    content: JSON.stringify(
      {
        status: "ok",
        aggregation: input.aggregation,
        filters: {
          datasets: input.datasets,
          icd10_prefixes: input.icd10_prefixes,
          ...(input.drug_names ? { drug_names: input.drug_names } : {}),
          ...(input.year_from || input.year_to
            ? {
                year_range: `${input.year_from ?? "any"}–${input.year_to ?? "any"}`,
              }
            : {}),
          ...(input.age_min !== undefined || input.age_max !== undefined
            ? { age_range: `${input.age_min ?? 0}–${input.age_max ?? 130}` }
            : {}),
          sex: input.sex,
        },
        execution: {
          source: executionSource,
          ...(summaryFallbackError
            ? {
                summary_fallback:
                  "Claims summary layer unavailable; used raw parquet scan.",
              }
            : {}),
        },
        results,
      },
      null,
      2,
    ),
    audit,
  };
}

export const __claimsQueryTestHooks = {
  buildClaimsSummaryWhere,
  claimsSummaryPathSql,
  parquetPaths,
  shouldUseClaimsSummary,
  summaryDatasetForInput,
  SUMMARY_AVAILABLE_YEARS,
};

// ── Tool schema ───────────────────────────────────────────────────────────────

export const claimsQueryToolSchema = {
  name: "data.claims_query",
  description:
    "Query real-world claims and survey data across 14 datasets spanning the US and Latin America. " +
    "US datasets: meps (expenditure survey, 2017-2023, costs in USD), namcs (physician office visits 2018-2022), " +
    "nhamcs_ed (ED visits 2011-2022), ny_sparcs (NY inpatient 2017-2024, costs in USD), " +
    "nhanes (health examination survey 1999-2021, person-level), nhis (health interview survey 2019-2023), " +
    "wa_chars (Washington State inpatient+observation 2016-2024, ~700K/yr, ICD-10-CM primary only). " +
    "Latin America: ecuador_inec (hospital discharges 2022-2023), uruguay_eh (2013-2024), " +
    "mexico_egresos (2018-2025), brazil_datasus (inpatient 2018-2024, costs in BRL), " +
    "chile_deis (hospital discharges 2018-2024, ~1.6M/yr), " +
    "colombia_rips (health services 2018-2023), " +
    "argentina_ba (Buenos Aires province inpatient 2016-2020). " +
    "Common schema: age_years, sex, country_code, region, visit_type, primary_diag_icd (ICD-10), " +
    "secondary_diags (semicolon-separated ICD-10), drugs_mentioned (semicolon-separated names), " +
    "visit_weight, total_cost_local, local_currency, source_dataset, source_year. " +
    "METADATA NOTE — primary_diag_icd coding varies by dataset: " +
    "ny_sparcs source exports CCSR categories, normalised by ETL to representative ICD-10 prefixes — always pass ICD-10; " +
    "brazil_datasus stores ICD-10 but E11 rarely appears as principal diagnosis (complications coded separately); " +
    "colombia_rips and mexico_egresos have sparse/empty secondary_diags. " +
    "Returns aggregated statistics only (cell suppression n<5). " +
    "Use 'regions' to filter by state/region: Brazil UF codes ['SP','RJ'] or US census regions ['Northeast']. " +
    "IMPORTANT: do NOT pass raw SQL — use the structured parameters: datasets, icd10_prefixes, aggregation, regions. " +
    "For population sizing and budget impact: use aggregation='count' or 'prevalence'. " +
    "Design log #28.",
  annotations: {
    title: "Real-World Claims & Survey Data Query",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      datasets: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "all",
            "meps",
            "namcs",
            "nhamcs_ed",
            "ny_sparcs",
            "nhanes",
            "nhis",
            "ecuador_inec",
            "uruguay_eh",
            "mexico_egresos",
            "brazil_datasus",
            "chile_deis",
            "colombia_rips",
            "wa_chars",
            "argentina_ba",
            "datasus_sih",
            "datasus_sia",
            "datasus_sim",
            "nhamcs_opd",
          ],
        },
        default: ["all"],
      },
      icd10_prefixes: {
        type: "array",
        items: { type: "string" },
        description:
          "ICD-10 prefixes: ['E11'] = T2D, ['I21'] = AMI, ['C50'] = breast cancer, ['J45'] = asthma.",
        minItems: 1,
      },
      drug_names: {
        type: "array",
        items: { type: "string" },
        description:
          "Substring match in drug list. E.g. ['metformin'] or ['empagliflozin', 'dapagliflozin'].",
      },
      regions: {
        type: "array",
        items: { type: "string" },
        description:
          "Region/state filter. Brazil datasus UF codes: ['SP'] = São Paulo, ['SP','RJ','MG'] = top 3 states. US NAMCS/MEPS census regions: ['Northeast','South','West','Midwest']. Omit for all regions.",
      },
      age_min: { type: "integer", minimum: 0, maximum: 130 },
      age_max: { type: "integer", minimum: 0, maximum: 130 },
      sex: { type: "string", enum: ["male", "female", "all"], default: "all" },
      year_from: {
        type: "integer",
        minimum: 2000,
        maximum: 2030,
        description:
          "meps: 2017-2023 | ny_sparcs: 2017-2022, 2024 (no 2023) | nhamcs_ed: 2011-2022 | nhanes: 1999-2021 | nhis: 2019-2023 | ecuador_inec: 2022-2023 | uruguay_eh: 2016-2024 | mexico_egresos: 2018-2025 | colombia_rips: 2018-2023 | brazil_datasus/datasus_sih: 2018-2024 | chile_deis: 2018-2024 | namcs: 2018-2022",
      },
      year_to: { type: "integer", minimum: 2000, maximum: 2030 },
      aggregation: {
        type: "string",
        enum: [
          "prevalence",
          "count",
          "drug_utilization",
          "demographics",
          "comorbidities",
          "cost",
        ],
        description:
          "prevalence or count: record counts + weighted estimates by year — USE THIS for population sizing and budget impact. drug_utilization: top drugs by frequency. demographics: age/sex breakdown. comorbidities: top co-diagnosis ICD codes. cost: cost distribution (BRL for datasus, USD for meps/ny_sparcs).",
      },
      top_n: { type: "integer", minimum: 5, maximum: 50, default: 20 },
    },
    required: ["icd10_prefixes", "aggregation"],
  },
} as const;
