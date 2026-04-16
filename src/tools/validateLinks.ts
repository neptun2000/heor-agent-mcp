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
 * Handles sites that block automated requests (return 403):
 *   - CADTH, HAS, and some others block bots but work in browsers
 *   - These are marked "browser_only" instead of "broken"
 */

const ValidateLinksSchema = z.object({
  urls: z
    .array(z.string().url())
    .min(1)
    .max(50)
    .describe("URLs to validate"),
  timeout_ms: z
    .number()
    .int()
    .min(1000)
    .max(30000)
    .default(10000)
    .optional(),
});

interface LinkStatus {
  url: string;
  status_code: number;
  ok: boolean;
  category: "working" | "browser_only" | "broken" | "timeout" | "error";
  message: string;
  final_url?: string; // after redirects
}

// Domains known to block bots but work in browsers
const BROWSER_ONLY_DOMAINS = [
  "cda-amc.ca",
  "cadth.ca",
  "has-sante.fr",
  "pbs.gov.au",
  "cochranelibrary.com",
];

function categorize(url: string, status: number): LinkStatus["category"] {
  if (status >= 200 && status < 400) return "working";
  if (status === 403) {
    const host = new URL(url).hostname;
    if (BROWSER_ONLY_DOMAINS.some((d) => host.includes(d))) {
      return "browser_only";
    }
    return "broken";
  }
  if (status === 404 || status === 410) return "broken";
  if (status === 429) return "broken"; // rate limited
  if (status === 0) return "timeout";
  return "error";
}

async function checkUrl(
  url: string,
  timeoutMs: number,
): Promise<LinkStatus> {
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
      category: msg.includes("abort") || msg.includes("timeout")
        ? "timeout"
        : "error",
      message: msg,
    };
  }
}

export async function handleValidateLinks(
  rawParams: unknown,
): Promise<ToolResult> {
  const params = ValidateLinksSchema.parse(rawParams);
  const timeoutMs = params.timeout_ms ?? 10000;

  let audit = createAuditRecord(
    "validate_links",
    { n_urls: params.urls.length } as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(audit, "HTTP HEAD request with redirect follow");
  audit = addAssumption(
    audit,
    `Timeout: ${timeoutMs}ms per URL. Sites blocking bots (403) marked "browser_only".`,
  );

  // Validate all URLs in parallel
  const results = await Promise.all(
    params.urls.map((url) => checkUrl(url, timeoutMs)),
  );

  const working = results.filter((r) => r.category === "working").length;
  const browserOnly = results.filter((r) => r.category === "browser_only").length;
  const broken = results.filter(
    (r) => r.category === "broken" || r.category === "timeout" || r.category === "error",
  ).length;

  const lines: string[] = [
    `## Link Validation Report`,
    ``,
    `**Summary:** ${working} working | ${browserOnly} browser-only (403 to bots, works in browser) | ${broken} broken`,
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
          : "BROKEN";
    const shortUrl = r.url.length > 60 ? r.url.slice(0, 57) + "..." : r.url;
    const note = r.final_url
      ? `Redirected to ${r.final_url}`
      : r.message || "";
    lines.push(
      `| ${shortUrl} | ${r.status_code || "—"} | ${icon} | ${note} |`,
    );
  }

  lines.push(``);
  if (broken > 0) {
    lines.push(
      `> **WARNING:** ${broken} link(s) are broken. Do NOT present these to the user. Replace with working alternatives or omit.`,
    );
  }
  if (browserOnly > 0) {
    lines.push(
      `> **Note:** ${browserOnly} link(s) return 403 to automated requests but work in browsers. These are safe to present.`,
    );
  }

  return {
    content: {
      summary: { total: results.length, working, browser_only: browserOnly, broken },
      results,
      text: lines.join("\n"),
    },
    audit,
  };
}

export const validateLinksToolSchema = {
  name: "validate_links",
  description:
    "Validate URLs by making HEAD requests and checking HTTP status codes. Returns categorization: working (200), browser_only (403 from bot-blocking sites that work in browsers), broken (404/410), or timeout/error. ALWAYS use this before presenting reference links to users — broken links destroy trust. Pass all URLs you plan to cite.",
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
