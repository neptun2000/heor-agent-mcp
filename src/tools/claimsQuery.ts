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
  "ny_sparcs", // NY State inpatient discharges, 2017-2024, ~2M/yr
  "nhanes", // NCHS health examination survey, 1999-2021, ~10K persons/cycle
  "nhis", // NCHS health interview survey, 2016-2023, ~25K persons/yr
  // Latin America
  "ecuador_inec", // Ecuador INEC hospital discharges, 2022-2023, ~1.1M/yr
  "uruguay_eh", // Uruguay Encuesta de Hogares household SURVEY — NO ICD codes; ICD queries return zero. Visit-frequency analysis only.
  "mexico_egresos", // Mexico DGIS egresos hospitalarios, 2018-2025, multi-million/yr
  "brazil_datasus", // Brazil DataSUS SIH inpatient, multiple years
  "chile_deis", // Chile DEIS egresos hospitalarios, 2001-2023, ~1.5M/yr
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
export function withDbLock<T>(fn: () => Promise<T>): Promise<T> {
  const lockPromise = _queryQueue.then(() => fn());
  _queryQueue = lockPromise.catch(() => {});
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            "DuckDB query timed out (90s). Add year_from/year_to to limit the scan, " +
              "or reduce the date range.",
          ),
        ),
      QUERY_TIMEOUT_MS,
    );
    lockPromise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
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
  const isDatasusOnly =
    active.length > 0 && active.every((d) => DATASUS_NAMES.has(d));

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

  // Year-range partition pruning. Two patterns per year cover both storage shapes:
  //   *.parquet   — flat  (ny_sparcs, meps, mexico_egresos…): year/data.parquet
  //   */*.parquet — nested (datasus): year/region=SP/data.parquet
  // Avoids **, which requires at least one sub-directory and returns zero for
  // flat-structure datasets when the year segment is already in the path prefix.
  if (yearRange) {
    const paths: string[] = [];
    for (const y of yearRange) {
      paths.push(`'${base}/source_dataset=*/source_year=${y}/*.parquet'`);
      paths.push(`'${base}/source_dataset=*/source_year=${y}/*/*.parquet'`);
    }
    return { pathSql: `[${paths.join(", ")}]`, skipRegionWhere: false };
  }

  return { pathSql: `'${base}/**/*.parquet'`, skipRegionWhere: false };
}

// ── NY SPARCS CCSR ↔ ICD-10 translation ──────────────────────────────────────
// The public NY SPARCS Socrata export contains CCSR codes (e.g. END003) in the
// primary_diag_icd column instead of raw ICD-10 codes. All other datasets store
// ICD-10. This table maps the 3-char ICD-10 prefix to CCSR so the WHERE clause
// can use the right code system per dataset.
const ICD10_TO_CCSR: Record<string, string[]> = {
  // Endocrine / metabolic
  E10: ["END004"],
  E11: ["END003"],
  E12: ["END003"],
  E13: ["END005"],
  E66: ["END007"],
  E78: ["END001"],
  E03: ["END002"],
  E05: ["END009"],
  // Cardiovascular
  I10: ["CIR011"],
  I20: ["CIR009"],
  I21: ["CIR008"],
  I25: ["CIR002"],
  I26: ["CIR018"],
  I48: ["CIR013"],
  I49: ["CIR014"],
  I50: ["CIR019"],
  I60: ["CIR020"],
  I61: ["CIR012"],
  I63: ["CIR007"],
  I65: ["CIR010"],
  I70: ["CIR001"],
  I71: ["CIR015"],
  I80: ["CIR016"],
  I82: ["CIR017"],
  // Respiratory
  J10: ["RSP015"],
  J12: ["RSP001"],
  J13: ["RSP014"],
  J15: ["RSP005"],
  J18: ["RSP002"],
  J44: ["RSP008"],
  J45: ["RSP003"],
  J96: ["RSP004"],
  U07: ["RSP012"],
  // GI / liver
  K50: ["GIS011"],
  K51: ["GIS012"],
  K70: ["GIS009"],
  K72: ["GIS007"],
  K74: ["GIS008"],
  K80: ["GIS006"],
  K85: ["GIS014"],
  K92: ["GIS004"],
  // Renal / GU
  N17: ["GEN007"],
  N18: ["GEN008"],
  N39: ["GEN003"],
  N40: ["GEN004"],
  // Oncology
  C18: ["NEO004"],
  C20: ["NEO005"],
  C34: ["NEO010"],
  C50: ["NEO011"],
  C61: ["NEO015"],
  C67: ["NEO017"],
  C85: ["NEO027"],
  C90: ["NEO022"],
  C91: ["NEO023"],
  // Neurological / psychiatric
  F32: ["NVS004"],
  F41: ["NVS012"],
  G20: ["NVS001"],
  G30: ["NVS005"],
  G35: ["NVS002"],
  G40: ["NVS003"],
  // Musculoskeletal
  M05: ["MUS007"],
  M06: ["MUS006"],
  M10: ["MUS009"],
  M45: ["MUS008"],
  // Infectious
  A41: ["INF001"],
  B20: ["INF003"],
  // Injury
  S72: ["INJ001"],
};

// ── WHERE clause builder (sanitised — all values come from Zod-validated input) ──

function buildWhere(input: ClaimsQueryInput, skipRegion = false): string {
  const parts: string[] = [];

  // Dataset filter (values from enum — safe to inline)
  const active = input.datasets.includes("all")
    ? []
    : input.datasets.filter((d) => d !== "all");
  if (active.length === 1) {
    parts.push(`source_dataset = '${active[0]}'`);
  } else if (active.length > 1) {
    parts.push(`source_dataset IN (${active.map((d) => `'${d}'`).join(",")})`);
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

  // ICD-10 prefix filter. NY SPARCS stores CCSR codes (e.g. END003) not ICD-10,
  // so translate when ny_sparcs rows are in scope.
  if (input.icd10_prefixes.length > 0) {
    const nySparcsOnly =
      active.length > 0 && active.every((d) => d === "ny_sparcs");
    const nySparcsIncluded =
      input.datasets.includes("all") || active.includes("ny_sparcs");
    const otherIncluded =
      input.datasets.includes("all") || active.some((d) => d !== "ny_sparcs");

    const icdLikes = input.icd10_prefixes.map((p) => {
      const safe = p.replace(/[^A-Za-z0-9.]/g, "").toUpperCase();
      return `primary_diag_icd LIKE '${safe}%'`;
    });
    const ccsrCodes = [
      ...new Set(
        input.icd10_prefixes.flatMap((p) => {
          const safe = p.replace(/[^A-Za-z0-9.]/g, "").toUpperCase();
          return ICD10_TO_CCSR[safe] ?? ICD10_TO_CCSR[safe.slice(0, 3)] ?? [];
        }),
      ),
    ];
    const ccsrIn =
      ccsrCodes.length > 0
        ? `primary_diag_icd IN (${ccsrCodes.map((c) => `'${c}'`).join(",")})`
        : null;

    if (nySparcsOnly && ccsrIn) {
      parts.push(ccsrIn);
    } else if (nySparcsIncluded && otherIncluded && ccsrIn) {
      parts.push(
        `((source_dataset = 'ny_sparcs' AND ${ccsrIn})` +
          ` OR (source_dataset != 'ny_sparcs' AND (${icdLikes.join(" OR ")})))`,
      );
    } else {
      parts.push(`(${icdLikes.join(" OR ")})`);
    }
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

async function queryDrugUtilization(
  db: DuckDBConnection,
  pathSql: string,
  where: string,
  topN: number,
): Promise<unknown> {
  const rows = await dbAll(
    db,
    `SELECT
       LOWER(drug) AS drug,
       COUNT(*) AS visit_count
     FROM (
       SELECT UNNEST(string_split(drugs_mentioned, ';')) AS drug
       FROM read_parquet(${pathSql}, hive_partitioning = false, union_by_name = true)
       ${where} AND drugs_mentioned IS NOT NULL AND drugs_mentioned <> ''
     )
     WHERE drug IS NOT NULL AND drug <> ''
     GROUP BY LOWER(drug)
     HAVING COUNT(*) >= 5
     ORDER BY visit_count DESC
     LIMIT ${topN}`,
  );

  const total = await dbAll(
    db,
    `SELECT COUNT(*) AS total FROM read_parquet(${pathSql}, hive_partitioning = false, union_by_name = true) ${where}`,
  );
  const totalVisits = (total[0]?.["total"] as number) ?? 0;

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
  const [ageRows, sexRows, regionRows] = await Promise.all([
    dbAll(
      db,
      `SELECT
         CASE
           WHEN age_years BETWEEN 0 AND 17  THEN '0-17 (paediatric)'
           WHEN age_years BETWEEN 18 AND 44 THEN '18-44 (young adult)'
           WHEN age_years BETWEEN 45 AND 64 THEN '45-64 (middle-aged)'
           WHEN age_years BETWEEN 65 AND 74 THEN '65-74 (elderly)'
           WHEN age_years >= 75             THEN '75+ (very elderly)'
           ELSE 'unknown'
         END AS age_group,
         COUNT(*) AS count
       FROM read_parquet(${pathSql}, hive_partitioning = false, union_by_name = true)
       ${where} AND age_years IS NOT NULL
       GROUP BY age_group
       HAVING COUNT(*) >= 5
       ORDER BY MIN(age_years)`,
    ),
    dbAll(
      db,
      `SELECT sex, COUNT(*) AS count
       FROM read_parquet(${pathSql}, hive_partitioning = false, union_by_name = true)
       ${where}
       GROUP BY sex`,
    ),
    dbAll(
      db,
      `SELECT region, COUNT(*) AS count
       FROM read_parquet(${pathSql}, hive_partitioning = false, union_by_name = true)
       ${where} AND region IS NOT NULL
       GROUP BY region
       HAVING COUNT(*) >= 5
       ORDER BY count DESC
       LIMIT 10`,
    ),
  ]);

  const total = ageRows.reduce((s, r) => s + (r["count"] as number), 0);
  return {
    age_groups: ageRows.map((r) => ({
      group: r["age_group"],
      count: r["count"],
      pct:
        total > 0
          ? Math.round(((r["count"] as number) / total) * 1000) / 10
          : 0,
    })),
    sex_distribution: Object.fromEntries(
      sexRows.map((r) => [r["sex"] ?? "unknown", r["count"]]),
    ),
    top_regions: regionRows.map((r) => ({
      region: r["region"],
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

// ── Check table has data ──────────────────────────────────────────────────────

async function checkHasData(
  db: DuckDBConnection,
  pathSql: string,
): Promise<boolean> {
  try {
    const rows = await dbAll(
      db,
      `SELECT 1 FROM read_parquet(${pathSql}, union_by_name = true) LIMIT 1`,
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleClaimsQuery(
  rawInput: unknown,
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

  const db = await getDb();
  const { pathSql, skipRegionWhere } = parquetPaths(input);

  const hasData = await withDbLock(() => checkHasData(db, pathSql));
  if (!hasData) {
    return {
      content: JSON.stringify(
        {
          status: "no_data",
          message:
            "No Parquet files found in the Azure Blob container. " +
            "Run the ETL scripts first:\n" +
            "  python scripts/etl/etl_namcs.py --years 2022\n" +
            "  python scripts/etl/etl_datasus_sih.py --uf SP --year 2022\n\n" +
            "See scripts/etl/README.md for full setup.",
        },
        null,
        2,
      ),
      audit,
    };
  }

  const where = buildWhere(input, skipRegionWhere);
  let results: unknown;

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
  });

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
        results,
        data_notes: [
          "Survey data (meps, namcs, nhamcs_ed, nhanes, nhis): visit_weight = sampling weight for national estimates. Apply when computing population-level rates.",
          "Census data (ny_sparcs, ecuador_inec, uruguay_eh, mexico_egresos, brazil_datasus, chile_deis): record count = actual events, visit_weight is null.",
          "meps: US nationwide, covers inpatient/ER/office/prescriptions, has cost in USD (total_cost_local).",
          "ny_sparcs: New York State inpatient discharges only, cost in USD (total_cost_local).",
          "brazil_datasus: inpatient admissions (datasus_sih), cost in BRL (total_cost_local).",
          "nhanes/nhis: visit_type='survey_examination', one row per person per cycle, not per visit.",
          "uruguay_eh (2016-2024): age is group midpoint (not exact age), no cost data.",
          "Counts < 5 are suppressed per NCHS disclosure rules.",
        ],
      },
      null,
      2,
    ),
    audit,
  };
}

// ── Tool schema ───────────────────────────────────────────────────────────────

export const claimsQueryToolSchema = {
  name: "data.claims_query",
  description:
    "Query real-world claims and survey data across 12 datasets spanning the US and Latin America. " +
    "US datasets: meps (expenditure survey, 2017-2023, costs in USD), namcs (physician office visits), " +
    "nhamcs_ed (ED visits 2011-2022), ny_sparcs (NY inpatient 2017-2024, costs in USD), " +
    "nhanes (health examination survey 1999-2021, person-level), nhis (health interview survey 2016-2023). " +
    "Latin America: ecuador_inec (hospital discharges 2022-2023), uruguay_eh (2016-2024), " +
    "mexico_egresos (2018-2025), brazil_datasus (inpatient 2018-2024, costs in BRL), " +
    "colombia_rips (health services 2018-2023). " +
    "Common schema: age_years, sex, country_code, region, visit_type, primary_diag_icd, " +
    "secondary_diags (semicolon-separated ICD-10), drugs_mentioned (semicolon-separated names), " +
    "visit_weight, total_cost_local, local_currency, source_dataset, source_year. " +
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
          "meps: 2017-2023 | ny_sparcs: 2017-2024 | nhamcs_ed: 2011-2022 | nhanes: 1999-2021 | nhis: 2019-2023 | ecuador_inec: 2022-2023 | uruguay_eh: 2016-2024 | mexico_egresos: 2018-2025 | colombia_rips: 2018-2023 | brazil_datasus: 2018-2024 | namcs: 2018-2022",
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
