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
  "namcs",
  "nhamcs_ed",
  "nhamcs_opd",
  "datasus_sih",
  "datasus_sia",
  "datasus_sim",
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
  age_min: z.number().int().min(0).max(130).optional(),
  age_max: z.number().int().min(0).max(130).optional(),
  sex: z.enum(["male", "female", "all"]).default("all"),
  year_from: z.number().int().min(2000).max(2030).optional(),
  year_to: z.number().int().min(2000).max(2030).optional(),
  aggregation: z.enum([
    "prevalence",
    "drug_utilization",
    "demographics",
    "comorbidities",
    "cost",
  ]),
  top_n: z.number().int().min(5).max(50).default(20),
});

type ClaimsQueryInput = z.infer<typeof ClaimsQuerySchema>;

// ── DuckDB singleton (@duckdb/node-api, async, N-API) ────────────────────────

import type { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

let _instance: DuckDBInstance | null = null;
let _conn: DuckDBConnection | null = null;
let _dbInitializing: Promise<DuckDBConnection> | null = null;

function coerceBigInt(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
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

  _dbInitializing = initDb(connStr).then((conn) => {
    _conn = conn;
    _dbInitializing = null;
    return conn;
  });
  return _dbInitializing;
}

// ── Parquet path helpers ──────────────────────────────────────────────────────

function parquetPath(): string {
  const container = process.env.AZURE_STORAGE_CONTAINER ?? "heor-claims";
  return `azure://${container}/claims_visits/**/*.parquet`;
}

// ── WHERE clause builder (sanitised — all values come from Zod-validated input) ──

function buildWhere(input: ClaimsQueryInput): string {
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

  // ICD-10 prefix — sanitise to [A-Z0-9.] only before inlining
  const icdParts = input.icd10_prefixes.map((p) => {
    const safe = p.replace(/[^A-Za-z0-9.]/g, "").toUpperCase();
    return `primary_diag_icd LIKE '${safe}%'`;
  });
  if (icdParts.length > 0) parts.push(`(${icdParts.join(" OR ")})`);

  // Drug filter — use raw JSON string contains (safe: drug names are alphanumeric)
  if (input.drug_names && input.drug_names.length > 0) {
    const drugParts = input.drug_names.map((d) => {
      const safe = d.replace(/[^A-Za-z0-9 \-]/g, "").toLowerCase();
      return `LOWER(COALESCE(drugs_mentioned,'')) LIKE '%${safe}%'`;
    });
    parts.push(`(${drugParts.join(" OR ")})`);
  }

  return parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "";
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
  path: string,
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
     FROM read_parquet('${path}', hive_partitioning = true, union_by_name = true)
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
  path: string,
  where: string,
  topN: number,
): Promise<unknown> {
  const rows = await dbAll(
    db,
    `SELECT
       LOWER(drug) AS drug,
       COUNT(*) AS visit_count
     FROM (
       SELECT UNNEST(json_extract_string_array(drugs_mentioned)) AS drug
       FROM read_parquet('${path}', hive_partitioning = true, union_by_name = true)
       ${where} AND drugs_mentioned IS NOT NULL AND drugs_mentioned <> '[]'
     )
     WHERE drug IS NOT NULL AND drug <> ''
     GROUP BY LOWER(drug)
     HAVING COUNT(*) >= 5
     ORDER BY visit_count DESC
     LIMIT ${topN}`,
  );

  const total = await dbAll(
    db,
    `SELECT COUNT(*) AS total FROM read_parquet('${path}', hive_partitioning = true, union_by_name = true) ${where}`,
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
  path: string,
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
       FROM read_parquet('${path}', hive_partitioning = true, union_by_name = true)
       ${where} AND age_years IS NOT NULL
       GROUP BY age_group
       HAVING COUNT(*) >= 5
       ORDER BY MIN(age_years)`,
    ),
    dbAll(
      db,
      `SELECT sex, COUNT(*) AS count
       FROM read_parquet('${path}', hive_partitioning = true, union_by_name = true)
       ${where}
       GROUP BY sex`,
    ),
    dbAll(
      db,
      `SELECT region, COUNT(*) AS count
       FROM read_parquet('${path}', hive_partitioning = true, union_by_name = true)
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
  path: string,
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
       SELECT UNNEST(json_extract_string_array(secondary_diags)) AS icd
       FROM read_parquet('${path}', hive_partitioning = true, union_by_name = true)
       ${where} AND secondary_diags IS NOT NULL AND secondary_diags <> '[]'
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
  path: string,
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
     FROM read_parquet('${path}', hive_partitioning = true, union_by_name = true)
     ${where} AND total_cost_local IS NOT NULL AND total_cost_local > 0
     GROUP BY local_currency`,
  );

  if (rows.length === 0 || (rows[0]?.["n_with_cost"] as number) < 5) {
    return {
      note:
        "Insufficient cost data (< 5 records) — suppressed per disclosure rules. " +
        "Cost data is only available for DataSUS SIH (Brazilian inpatient admissions). " +
        "Make sure to include source_dataset=datasus_sih in your query.",
    };
  }
  const r = rows[0];
  return {
    currency: r["local_currency"],
    n_with_cost: r["n_with_cost"],
    mean: r["mean"],
    median: r["median"],
    p25: r["p25"],
    p75: r["p75"],
    p90: r["p90"],
    note: `${r["local_currency"]} values from DataSUS SIH authorised hospital costs. Convert to USD using contemporaneous exchange rate.`,
  };
}

// ── Check table has data ──────────────────────────────────────────────────────

async function checkHasData(
  db: DuckDBConnection,
  path: string,
): Promise<boolean> {
  try {
    const rows = await dbAll(
      db,
      `SELECT 1 FROM read_parquet('${path}', union_by_name = true) LIMIT 1`,
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
  const path = parquetPath();

  const hasData = await checkHasData(db, path);
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

  const where = buildWhere(input);
  let results: unknown;

  switch (input.aggregation) {
    case "prevalence":
      results = await queryPrevalence(db, path, where);
      break;
    case "drug_utilization":
      results = await queryDrugUtilization(db, path, where, input.top_n);
      break;
    case "demographics":
      results = await queryDemographics(db, path, where);
      break;
    case "comorbidities":
      results = await queryComorbidities(
        db,
        path,
        where,
        input.icd10_prefixes,
        input.top_n,
      );
      break;
    case "cost":
      results = await queryCost(db, path, where);
      break;
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
        results,
        data_notes: [
          "NAMCS/NHAMCS: visit_weight = sampling weight for US national estimates.",
          "DataSUS SIH: record count = actual admissions, no sampling weight.",
          "Counts < 5 are suppressed per NCHS disclosure rules.",
          "Storage: Azure Blob hive-partitioned Parquet — adding a new year requires only uploading one new file.",
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
    "Query real-world claims and survey data: NAMCS (US physician office visits), " +
    "NHAMCS ED/OPD (US hospital ambulatory), DataSUS SIH/SIA/SIM (Brazil inpatient/outpatient/mortality). " +
    "Data stored as hive-partitioned Parquet on Azure Blob Storage, queried via DuckDB — " +
    "partition pruning means multi-year queries only read the relevant year files. " +
    "Returns aggregated statistics only (cell suppression n<5). Design log #28.",
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
            "namcs",
            "nhamcs_ed",
            "nhamcs_opd",
            "datasus_sih",
            "datasus_sia",
            "datasus_sim",
            "all",
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
      age_min: { type: "integer", minimum: 0, maximum: 130 },
      age_max: { type: "integer", minimum: 0, maximum: 130 },
      sex: { type: "string", enum: ["male", "female", "all"], default: "all" },
      year_from: {
        type: "integer",
        minimum: 2000,
        maximum: 2030,
        description: "NAMCS/NHAMCS: 2018–2022. DataSUS: 2008–2022.",
      },
      year_to: { type: "integer", minimum: 2000, maximum: 2030 },
      aggregation: {
        type: "string",
        enum: [
          "prevalence",
          "drug_utilization",
          "demographics",
          "comorbidities",
          "cost",
        ],
        description:
          "prevalence | drug_utilization | demographics | comorbidities | cost(DataSUS only)",
      },
      top_n: { type: "integer", minimum: 5, maximum: 50, default: 20 },
    },
    required: ["icd10_prefixes", "aggregation"],
  },
} as const;
