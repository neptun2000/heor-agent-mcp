import type { LiteratureResult } from "../types.js";

const BASE = "https://stats.oecd.org/SDMX-JSON/data";

// Map HEOR-relevant queries to OECD dataset/dimension combos
const DATASET_MAP: Record<
  string,
  { dataset: string; filter: string; label: string }
> = {
  "health expenditure": {
    dataset: "SHA",
    filter: ".HFTOT.HCTOT.HPTOT.PC_GDP",
    label: "Health expenditure as % of GDP",
  },
  pharmaceutical: {
    dataset: "SHA",
    filter: ".HFTOT.HC51.HPTOT.PC_CHE",
    label: "Pharmaceutical spending as % of health expenditure",
  },
  "hospital beds": {
    dataset: "HEALTH_REAC",
    filter: ".HOPITBED.RTOINPAM",
    label: "Hospital beds per 1,000 population",
  },
  physicians: {
    dataset: "HEALTH_REAC",
    filter: ".PHYS.PRPHYSAM",
    label: "Practising physicians per 1,000 population",
  },
  "life expectancy": {
    dataset: "HEALTH_STAT",
    filter: ".LIFE_EXP.TOTAL.0",
    label: "Life expectancy at birth",
  },
  mortality: {
    dataset: "HEALTH_STAT",
    filter: ".DEATH_RT.TOTAL",
    label: "Mortality rate",
  },
  obesity: {
    dataset: "HEALTH_STAT",
    filter: ".RISKF_OBESE.TOTAL",
    label: "Obesity rate (%)",
  },
};

function findDataset(query: string): {
  dataset: string;
  filter: string;
  label: string;
} {
  const q = query.toLowerCase();
  for (const [keyword, config] of Object.entries(DATASET_MAP)) {
    if (q.includes(keyword)) return config;
  }
  return DATASET_MAP["health expenditure"]; // default
}

export async function fetchOecd(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  try {
    const { dataset, filter, label } = findDataset(query);
    const url = `${BASE}/${dataset}${filter}/all?startTime=2018&dimensionAtObservation=AllDimensions&detail=dataonly`;
    const res = await fetch(url, {
      headers: { Accept: "application/vnd.sdmx.data+json; version=1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as Record<string, unknown>;
    const observations =
      ((data?.dataSets as Array<Record<string, unknown>>)?.[0]
        ?.observations as Record<string, unknown>) ?? {};
    const dimensions =
      (
        (data?.structure as Record<string, unknown>)?.dimensions as Record<
          string,
          unknown
        >
      )?.observation ?? [];

    // Find country and time dimensions
    const dimArray = dimensions as Array<Record<string, unknown>>;
    const countryDim = dimArray.find(
      (d) => d.id === "REF_AREA" || d.id === "COU",
    );
    const timeDim = dimArray.find(
      (d) => d.id === "TIME_PERIOD" || d.id === "YEAR",
    );

    if (!countryDim || !timeDim) return [];

    const results: LiteratureResult[] = [];
    const countryIdx = dimArray.indexOf(countryDim);
    const timeIdx = dimArray.indexOf(timeDim);

    for (const [key, obs] of Object.entries(observations)) {
      if (results.length >= maxResults) break;
      const indices = key.split(":").map(Number);
      const countryValues = countryDim.values as Array<Record<string, string>>;
      const timeValues = timeDim.values as Array<Record<string, string>>;
      const country =
        countryValues?.[indices[countryIdx]]?.name ??
        countryValues?.[indices[countryIdx]]?.id ??
        "Unknown";
      const countryCode = countryValues?.[indices[countryIdx]]?.id ?? "";
      const year = timeValues?.[indices[timeIdx]]?.id ?? "";
      const value = Array.isArray(obs) ? obs[0] : (obs as unknown);

      if (value === null || value === undefined) continue;

      results.push({
        id: `oecd_${dataset}_${countryCode}_${year}_${results.length}`,
        source: "oecd" as const,
        title: `${label}: ${country} (${year})`,
        authors: ["OECD"],
        date: year,
        study_type: "registry",
        abstract: `${label}: ${value} | Country: ${country} (${countryCode}) | Year: ${year} | Dataset: ${dataset}`,
        url: `https://data.oecd.org`,
      });
    }

    return results;
  } catch {
    return [];
  }
}
