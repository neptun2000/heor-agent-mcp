import type { LiteratureResult } from "../types.js";

// openFDA drug label endpoint with biologics filter
const BASE = "https://api.fda.gov/drug/label.json";

interface LabelResult {
  id?: string;
  openfda?: {
    brand_name?: string[];
    generic_name?: string[];
    manufacturer_name?: string[];
    application_number?: string[];
    product_type?: string[];
  };
  description?: string[];
  indications_and_usage?: string[];
  effective_time?: string;
}

interface LabelResponse {
  results?: LabelResult[];
}

export async function fetchPurpleBook(query: string, maxResults: number): Promise<LiteratureResult[]> {
  try {
    // Filter for biologics (BLA applications)
    const searchQuery = `(openfda.application_number:BLA*+AND+(openfda.brand_name:"${query}"+openfda.generic_name:"${query}"))`;
    const url = `${BASE}?search=${encodeURIComponent(searchQuery)}&limit=${Math.min(maxResults, 100)}`;
    const res = await fetch(url);
    if (!res.ok) return getPurpleBookFallback(query, maxResults);

    const data = (await res.json()) as LabelResponse;
    if (!data.results || data.results.length === 0) return getPurpleBookFallback(query, maxResults);

    return data.results.slice(0, maxResults).map((r, i) => {
      const brand = r.openfda?.brand_name?.[0] ?? "Unknown";
      const generic = r.openfda?.generic_name?.[0] ?? "";
      const manuf = r.openfda?.manufacturer_name?.[0] ?? "Unknown";
      const appNum = r.openfda?.application_number?.[0] ?? "N/A";
      return {
        id: `purple_book_${r.id ?? i}`,
        source: "purple_book" as const,
        title: `${brand} (${generic}) — ${appNum}`,
        authors: [manuf],
        date: r.effective_time ?? "",
        study_type: "regulatory",
        abstract: [
          `BLA Application: ${appNum}`,
          `Manufacturer: ${manuf}`,
          `Brand: ${brand} | Generic: ${generic}`,
          r.indications_and_usage?.[0] ? `Indications: ${r.indications_and_usage[0].slice(0, 300)}` : null,
        ].filter(Boolean).join(" | "),
        url: `https://purplebooksearch.fda.gov/search?query=${encodeURIComponent(brand)}`,
      };
    });
  } catch {
    return getPurpleBookFallback(query, maxResults);
  }
}

function getPurpleBookFallback(query: string, maxResults: number): LiteratureResult[] {
  return [{
    id: "purple_book_search",
    source: "purple_book" as const,
    title: `FDA Purple Book Search: ${query}`,
    authors: ["U.S. Food and Drug Administration"],
    date: new Date().getFullYear().toString(),
    study_type: "registry",
    abstract: `Search the FDA Purple Book for licensed biological products including biosimilars and reference products for "${query}". Covers FDA-licensed allergenic, cellular, gene therapy, hematologic, and vaccine products.`,
    url: `https://purplebooksearch.fda.gov/search?query=${encodeURIComponent(query)}`,
  }].slice(0, maxResults);
}
