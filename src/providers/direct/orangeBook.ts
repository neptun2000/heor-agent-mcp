import type { LiteratureResult } from "../types.js";

const BASE = "https://api.fda.gov/drug/drugsfda.json";

interface FdaProduct {
  product_number?: string;
  reference_drug?: string;
  brand_name?: string;
  active_ingredients?: Array<{ name?: string; strength?: string }>;
  reference_standard?: string;
  dosage_form?: string;
  route?: string;
  marketing_status?: string;
  te_code?: string;
}

interface FdaSubmission {
  submission_type?: string;
  submission_number?: string;
  submission_status?: string;
  submission_status_date?: string;
}

interface FdaApplication {
  application_number?: string;
  sponsor_name?: string;
  openfda?: {
    application_number?: string[];
    brand_name?: string[];
    generic_name?: string[];
    manufacturer_name?: string[];
  };
  products?: FdaProduct[];
  submissions?: FdaSubmission[];
}

interface FdaResponse {
  results?: FdaApplication[];
  error?: { message?: string };
}

export async function fetchOrangeBook(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  try {
    // Sanitize query before embedding in Lucene template — strip quotes to prevent syntax injection
    const safeQuery = query.replace(/"/g, " ").trim();
    const searchQuery = `(openfda.brand_name:"${safeQuery}"+openfda.generic_name:"${safeQuery}"+products.active_ingredients.name:"${safeQuery}")`;
    const url = `${BASE}?search=${encodeURIComponent(searchQuery)}&limit=${Math.min(maxResults, 100)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];

    const data = (await res.json()) as FdaResponse;
    if (!data.results) return [];

    const results: LiteratureResult[] = [];
    for (const app of data.results) {
      if (results.length >= maxResults) break;
      const product = app.products?.[0];
      const latestSubmission = app.submissions?.sort((a, b) =>
        (b.submission_status_date ?? "").localeCompare(
          a.submission_status_date ?? "",
        ),
      )[0];

      const brandName =
        product?.brand_name ?? app.openfda?.brand_name?.[0] ?? "Unknown";
      const ingredients =
        product?.active_ingredients
          ?.map((i) => `${i.name ?? ""} ${i.strength ?? ""}`.trim())
          .join(", ") ?? "";
      const teCode = product?.te_code ?? "N/A";

      results.push({
        id: `orange_book_${app.application_number ?? results.length}`,
        source: "orange_book" as const,
        title: `${brandName} — ${app.application_number ?? "N/A"} (${app.sponsor_name ?? "Unknown sponsor"})`,
        authors: [app.sponsor_name ?? "FDA"],
        date: latestSubmission?.submission_status_date ?? "",
        study_type: "regulatory",
        abstract: [
          `Application: ${app.application_number ?? "N/A"}`,
          `Sponsor: ${app.sponsor_name ?? "Unknown"}`,
          `Active ingredients: ${ingredients || "Not specified"}`,
          `Dosage form: ${product?.dosage_form ?? "N/A"} | Route: ${product?.route ?? "N/A"}`,
          `Therapeutic Equivalence (TE) Code: ${teCode}`,
          `Reference drug: ${product?.reference_drug ?? "N/A"}`,
          `Marketing status: ${product?.marketing_status ?? "N/A"}`,
          latestSubmission
            ? `Latest submission: ${latestSubmission.submission_type ?? ""} ${latestSubmission.submission_number ?? ""} (${latestSubmission.submission_status ?? ""}, ${latestSubmission.submission_status_date ?? ""})`
            : null,
        ]
          .filter(Boolean)
          .join(" | "),
        url: `https://www.accessdata.fda.gov/scripts/cder/ob/results_product.cfm?Appl_Type=N&Appl_No=${app.application_number ?? ""}`,
      });
    }
    return results;
  } catch {
    return [];
  }
}
