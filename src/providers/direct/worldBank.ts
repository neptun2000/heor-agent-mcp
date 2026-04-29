import type { LiteratureResult } from "../types.js";

const BASE = "https://api.worldbank.org/v2";

interface WBValue {
  indicator: { id: string; value: string };
  country: { id: string; value: string };
  date: string;
  value: number | null;
}

// Map HEOR-relevant terms to World Bank indicator codes
const INDICATOR_MAP: Record<string, string> = {
  gdp: "NY.GDP.PCAP.PP.CD", // GDP per capita PPP
  population: "SP.POP.TOTL", // Total population
  "life expectancy": "SP.DYN.LE00.IN", // Life expectancy at birth
  "health expenditure": "SH.XPD.CHEX.PP.CD", // Health expenditure per capita PPP
  mortality: "SP.DYN.CDRT.IN", // Crude death rate
  "birth rate": "SP.DYN.CBRT.IN",
  elderly: "SP.POP.65UP.TO.ZS", // Population 65+
  "infant mortality": "SP.DYN.IMRT.IN",
};

function findIndicator(query: string): string {
  const q = query.toLowerCase();
  for (const [keyword, code] of Object.entries(INDICATOR_MAP)) {
    if (q.includes(keyword)) return code;
  }
  return "NY.GDP.PCAP.PP.CD"; // Default: GDP per capita PPP
}

export async function fetchWorldBank(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  try {
    const indicator = findIndicator(query);
    // Get most recent data for all countries
    const url = `${BASE}/country/all/indicator/${indicator}?format=json&date=2018:2025&per_page=${maxResults}&mrnev=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];

    const json = await res.json();
    // World Bank returns [metadata, data] array
    if (!Array.isArray(json) || json.length < 2) return [];
    const data = json[1] as WBValue[] | null;
    if (!data) return [];

    return data
      .filter((v) => v.value !== null)
      .slice(0, maxResults)
      .map((v, i) => ({
        id: `world_bank_${indicator}_${v.country.id}_${v.date}_${i}`,
        source: "world_bank" as const,
        title: `${v.indicator.value}: ${v.country.value} (${v.date})`,
        authors: ["World Bank"],
        date: v.date ?? "",
        study_type: "registry",
        abstract: `${v.indicator.value}: ${v.value} | Country: ${v.country.value} (${v.country.id}) | Year: ${v.date}`,
        url: `https://data.worldbank.org/indicator/${indicator}`,
      }));
  } catch {
    return [];
  }
}
