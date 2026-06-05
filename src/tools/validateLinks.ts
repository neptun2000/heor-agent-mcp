import { z } from "zod";
import type { ToolResult } from "../providers/types.js";
import {
  createAuditRecord,
  addAssumption,
  setMethodology,
} from "../audit/builder.js";

/**
 * Validate Links Tool
 *
 * Checks whether URLs return 200 OK, 404, or other status codes.
 * Validates links BEFORE presenting them to users so we never
 * mislead with broken references.
 *
 * Handles sites that block automated requests (return 401/403/407):
 *   - CADTH, HAS, and some others block bots but work in browsers
 *   - These are marked "browser_only" instead of "broken"
 */

const ValidateLinksSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(50).describe("URLs to validate"),
  timeout_ms: z.number().int().min(1000).max(30000).default(5000).optional(),
});

// Well-known stable domains — skip HTTP check, always treat as working.
// These are canonical scientific infrastructure that are essentially never broken.
const SKIP_VALIDATION_DOMAINS = [
  "doi.org", // DOI resolver — always up; actual content reachability is irrelevant
  "pubmed.ncbi.nlm.nih.gov",
  "ncbi.nlm.nih.gov",
  "europepmc.org",
  "clinicaltrials.gov",
  "who.int",
  "worldbank.org",
];

function shouldSkipValidation(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SKIP_VALIDATION_DOMAINS.some(
      (d) => host === d || host.endsWith("." + d),
    );
  } catch {
    return false;
  }
}

// Run up to CONCURRENCY checks at a time to avoid saturating Railway outbound connections
const CONCURRENCY = 10;

async function checkUrlsConcurrently(
  urls: string[],
  timeoutMs: number,
): Promise<LinkStatus[]> {
  const results: LinkStatus[] = new Array(urls.length);
  let head = 0;

  async function worker() {
    while (head < urls.length) {
      const i = head++;
      const url = urls[i];
      if (shouldSkipValidation(url)) {
        results[i] = {
          url,
          status_code: 200,
          ok: true,
          category: "working",
          message: "Skipped — trusted domain",
        };
      } else {
        results[i] = await checkUrl(url, timeoutMs);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker),
  );
  return results;
}

interface LinkStatus {
  url: string;
  status_code: number;
  ok: boolean;
  category:
    | "working"
    | "browser_only"
    | "broken"
    | "rate_limited"
    | "timeout"
    | "error";
  message: string;
  final_url?: string; // after redirects
}

// Block SSRF targets: private/loopback IPs, cloud metadata, non-http(s) schemes
function isSafeUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost") return false;
  const privateRanges = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./, // cloud metadata (AWS IMDS, GCP, Azure)
    /^::1$/,
    /^fc00:/,
    /^fd/,
  ];
  if (privateRanges.some((r) => r.test(host))) return false;
  return true;
}

// Domains known to block bots but work in browsers
const BROWSER_ONLY_DOMAINS = [
  "aifa.gov.it",
  "cda-amc.ca",
  "cadth.ca",
  "has-sante.fr",
  "pbs.gov.au",
  "cochranelibrary.com",
  "ispor.org", // presentations-database search returns 200 but times out on bot requests
  "tlv.se",
];

function categorize(url: string, status: number): LinkStatus["category"] {
  if (status >= 200 && status < 400) return "working";
  if (status === 401 || status === 403 || status === 407) {
    const host = new URL(url).hostname;
    if (BROWSER_ONLY_DOMAINS.some((d) => host.includes(d))) {
      return "browser_only";
    }
    return status === 403 ? "broken" : "error";
  }
  if (status === 404 || status === 410) return "broken";
  if (status === 429 || status === 503) return "rate_limited";
  if (status === 0) {
    const host = new URL(url).hostname;
    if (BROWSER_ONLY_DOMAINS.some((d) => host.includes(d)))
      return "browser_only";
    return "timeout";
  }
  return "error";
}

async function checkUrl(url: string, timeoutMs: number): Promise<LinkStatus> {
  if (!isSafeUrl(url)) {
    return {
      url,
      status_code: 0,
      ok: false,
      category: "error",
      message: "Blocked: private/internal URL not allowed",
    };
  }
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (HEORAgent Link Validator) AppleWebKit/537.36",
      },
    });

    // Some servers reject HEAD — fall back to GET
    if (res.status === 405 || res.status === 501) {
      const getRes = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (HEORAgent Link Validator) AppleWebKit/537.36",
        },
      });
      return {
        url,
        status_code: getRes.status,
        ok: getRes.ok,
        category: categorize(url, getRes.status),
        message: getRes.statusText || "",
        final_url: getRes.url !== url ? getRes.url : undefined,
      };
    }

    return {
      url,
      status_code: res.status,
      ok: res.ok,
      category: categorize(url, res.status),
      message: res.statusText || "",
      final_url: res.url !== url ? res.url : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      url,
      status_code: 0,
      ok: false,
      category:
        msg.includes("abort") || msg.includes("timeout") ? "timeout" : "error",
      message: msg,
    };
  }
}

export async function handleValidateLinks(
  rawParams: unknown,
): Promise<ToolResult> {
  const params = ValidateLinksSchema.parse(rawParams);
  const timeoutMs = params.timeout_ms ?? 5000;

  let audit = createAuditRecord(
    "utils.validate_links",
    { n_urls: params.urls.length } as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(audit, "HTTP HEAD request with redirect follow");
  audit = addAssumption(
    audit,
    `Timeout: ${timeoutMs}ms per URL, concurrency: ${CONCURRENCY}. Trusted domains (doi.org, PubMed, etc.) skipped. Sites blocking bots (401/403/407) marked "browser_only".`,
  );

  const results = await checkUrlsConcurrently(params.urls, timeoutMs);

  const working = results.filter((r) => r.category === "working").length;
  const browserOnly = results.filter(
    (r) => r.category === "browser_only",
  ).length;
  const rateLimited = results.filter(
    (r) => r.category === "rate_limited",
  ).length;
  const broken = results.filter(
    (r) =>
      r.category === "broken" ||
      r.category === "timeout" ||
      r.category === "error",
  ).length;

  const lines: string[] = [
    `## Link Validation Report`,
    ``,
    `**Summary:** ${working} working | ${browserOnly} browser-only | ${rateLimited} rate-limited | ${broken} broken`,
    ``,
    `| URL | Status | Category | Notes |`,
    `|-----|--------|----------|-------|`,
  ];

  for (const r of results) {
    const icon =
      r.category === "working"
        ? "OK"
        : r.category === "browser_only"
          ? "Browser"
          : r.category === "rate_limited"
            ? "Rate-limited"
            : "BROKEN";
    const shortUrl = r.url.length > 60 ? r.url.slice(0, 57) + "..." : r.url;
    const note = r.final_url ? `Redirected to ${r.final_url}` : r.message || "";
    lines.push(`| ${shortUrl} | ${r.status_code || "—"} | ${icon} | ${note} |`);
  }

  lines.push(``);
  if (broken > 0) {
    lines.push(
      `> **WARNING:** ${broken} link(s) are broken. Do NOT present these to the user. Replace with working alternatives or omit.`,
    );
  }
  if (browserOnly > 0) {
    lines.push(
      `> **Note:** ${browserOnly} link(s) return 401/403/407 to automated requests but work in browsers. These are safe to present.`,
    );
  }
  if (rateLimited > 0) {
    lines.push(
      `> **Note:** ${rateLimited} link(s) are rate-limited (429/503). URLs are probably fine — retry later or present with a caveat.`,
    );
  }

  return {
    content: {
      summary: {
        total: results.length,
        working,
        browser_only: browserOnly,
        rate_limited: rateLimited,
        broken,
      },
      results,
      text: lines.join("\n"),
    },
    audit,
  };
}

export const validateLinksToolSchema = {
  name: "utils.validate_links",
  description:
    "Validate URLs by making HEAD requests and checking HTTP status codes. Returns categorization: working (200), browser_only (401/403/407 from bot-blocking sites that work in browsers), broken (404/410), or timeout/error. ALWAYS use this before presenting reference links to users — broken links destroy trust. Pass all URLs you plan to cite.",
  annotations: {
    title: "Validate Reference Links",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      urls: {
        type: "array",
        items: { type: "string" },
        description: "List of URLs to validate (max 50)",
      },
      timeout_ms: {
        type: "number",
        description: "Timeout per URL in ms (default 10000, max 30000)",
      },
    },
    required: ["urls"],
  },
};
