import type { LiteratureResult } from "../types.js";

const BASE = "https://ghoapi.who.int/api";

interface GHOValue {
  IndicatorCode: string;
  SpatialDim: string; // country code
  TimeDim: string; // year
  NumericValue: number | null;
  Value: string;
  Dim1?: string; // sex, age group, etc.
}

interface GHOResponse {
  value?: GHOValue[];
}

// Map common HEOR search terms to GHO indicator codes
const INDICATOR_MAP: Record<string, string> = {
  mortality: "WHOSIS_000001", // Life expectancy at birth
  "life expectancy": "WHOSIS_000001",
  diabetes: "NCD_BMI_30A", // Prevalence of obesity (BMI≥30)
  obesity: "NCD_BMI_30A",
  cardiovascular: "NCDMORT3070", // NCD mortality 30-70
  cancer: "NCDMORT3070",
  tobacco: "M_Est_smk_curr_std", // Tobacco use prevalence
  alcohol: "SA_0000001688", // Alcohol consumption per capita
  "health expenditure": "GHED_CHE_pc_PPP_SHA2011", // Health expenditure per capita
};

function findIndicator(query: string): string {
  const q = query.toLowerCase();
  for (const [keyword, code] of Object.entries(INDICATOR_MAP)) {
    if (q.includes(keyword)) return code;
  }
  return "WHOSIS_000001"; // Default: life expectancy
}

export async function fetchWhoGho(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  try {
    const indicator = findIndicator(query);
    const url = `${BASE}/${indicator}?$filter=TimeDim ge '2018'&$top=${maxResults}&$orderby=TimeDim desc`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as GHOResponse;
    const values = data.value ?? [];

    return values
      .filter((v) => v.NumericValue !== null)
      .slice(0, maxResults)
      .map((v, i) => ({
        id: `who_gho_${indicator}_${v.SpatialDim}_${v.TimeDim}_${i}`,
        source: "who_gho" as const,
        title: `${indicator}: ${v.SpatialDim} (${v.TimeDim})`,
        authors: ["World Health Organization"],
        date: v.TimeDim ?? "",
        study_type: "registry",
        abstract: `Value: ${v.NumericValue}${v.Dim1 ? ` | Dimension: ${v.Dim1}` : ""} | Country: ${v.SpatialDim} | Year: ${v.TimeDim}`,
        url: `https://www.who.int/data/gho/data/indicators/indicator-details/GHO/${indicator}`,
      }));
  } catch {
    return [];
  }
}
