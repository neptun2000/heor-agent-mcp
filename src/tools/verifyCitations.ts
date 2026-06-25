import { z } from "zod";
import type { ToolResult } from "../providers/types.js";
import {
  createAuditRecord,
  addAssumption,
  setMethodology,
  addSource,
} from "../audit/builder.js";
import {
  buildDisclosure,
  extractDisclosureLevel,
  AI_DISCLOSURE_LEVEL_SCHEMA_PROPERTY,
} from "../formatters/disclosure.js";

/**
 * verify_citations (utils.verify_citations) — Design log #43.
 *
 * Checks DOI / PMID citations against Crossref + NCBI E-utilities so we can
 * tell a REAL reference from a FABRICATED one (a plausible-but-invented DOI
 * that resolves to nothing — the failure mode general LLMs hit 36-40% of the
 * time per the PHAROS/Regulaido ISPOR 2026 study).
 *
 * NEVER throws on a network failure — a citation we couldn't reach is
 * `unverifiable`, never `fabricated`. We only assert `fabricated` when the
 * identifier is FORMAT-VALID but the database has no record of it. Mirrors the
 * "absence ≠ proof" invariant of regulatory.status_check.
 *
 * Live in production; mocked (global.fetch) in CI.
 */

const CitationSchema = z.object({
  id: z.string().optional(),
  doi: z.string().optional(),
  pmid: z.string().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
});

const VerifyCitationsSchema = z.object({
  citations: z.array(CitationSchema).min(1).max(100),
  timeout_ms: z.number().int().min(1000).max(30000).default(8000).optional(),
  ai_disclosure_level: z
    .enum(["off", "standard", "submission"])
    .default("standard")
    .optional(),
});

export type VerifyCitationStatus =
  | "verified"
  | "fabricated"
  | "unverifiable"
  | "url_only";

export interface VerifyCitationResult {
  input: { id?: string; doi?: string; pmid?: string; url?: string };
  status: VerifyCitationStatus;
  resolved_title?: string;
  resolved_year?: number;
  resolved_authors?: string[];
  crossref_ok: boolean;
  pubmed_ok: boolean;
  title_match?: "match" | "mismatch" | "not_checked";
  source: "crossref" | "pubmed" | "both" | "none";
  message: string;
  checked_at: string;
}

export interface VerifyCitationsContent {
  results: VerifyCitationResult[];
  summary: {
    total: number;
    verified: number;
    fabricated: number;
    unverifiable: number;
    url_only: number;
    fabrication_count: number;
    verified_rate: number;
  };
  text: string;
}

const DOI_RE = /^10\.\d{4,9}\/\S+$/i;
const PMID_RE = /^\d{1,8}$/;
const DOI_IN_URL_RE = /(10\.\d{4,9}\/[^\s?#]+)/i;
const PMID_IN_URL_RE = /pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,8})/i;

const CONCURRENCY = 8;
const UA = "HEORAgent Citation Verifier (mailto:support@heor-agent.dev)";

type ChannelOutcome = "ok" | "notfound" | "error" | "na";

interface ChannelResult {
  outcome: ChannelOutcome;
  title?: string;
  year?: number;
  authors?: string[];
}

async function checkCrossref(
  doi: string,
  timeoutMs: number,
): Promise<ChannelResult> {
  try {
    const res = await fetch(`https://api.crossref.org/works/${doi}`, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (res.status === 404 || res.status === 410) return { outcome: "notfound" };
    if (res.status < 200 || res.status >= 300) return { outcome: "error" };
    const body = (await res.json()) as {
      message?: {
        title?: string[];
        "published-print"?: { "date-parts"?: number[][] };
        "published-online"?: { "date-parts"?: number[][] };
        published?: { "date-parts"?: number[][] };
        issued?: { "date-parts"?: number[][] };
        author?: Array<{ family?: string; given?: string }>;
      };
    };
    const msg = body?.message;
    if (!msg) return { outcome: "notfound" };
    const dateParts =
      msg["published-print"]?.["date-parts"] ??
      msg["published-online"]?.["date-parts"] ??
      msg.published?.["date-parts"] ??
      msg.issued?.["date-parts"];
    const year = dateParts?.[0]?.[0];
    return {
      outcome: "ok",
      title: msg.title?.[0],
      year: typeof year === "number" ? year : undefined,
      authors: msg.author
        ?.map((a) => [a.given, a.family].filter(Boolean).join(" ").trim())
        .filter(Boolean),
    };
  } catch {
    return { outcome: "error" };
  }
}

async function checkPubmed(
  pmid: string,
  timeoutMs: number,
): Promise<ChannelResult> {
  const email = process.env.NCBI_EMAIL ?? "support@heor-agent.dev";
  const key = process.env.NCBI_API_KEY ? `&api_key=${process.env.NCBI_API_KEY}` : "";
  const url =
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}` +
    `&retmode=json&tool=heor-agent&email=${encodeURIComponent(email)}${key}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (res.status < 200 || res.status >= 300) return { outcome: "error" };
    const body = (await res.json()) as {
      result?: Record<string, unknown> & { uids?: string[] };
    };
    const entry = body?.result?.[pmid] as
      | { error?: string; title?: string; pubdate?: string; authors?: Array<{ name?: string }> }
      | undefined;
    if (!entry || entry.error) return { outcome: "notfound" };
    const year = entry.pubdate?.match(/\d{4}/)?.[0];
    return {
      outcome: "ok",
      title: entry.title,
      year: year ? Number(year) : undefined,
      authors: entry.authors?.map((a) => a.name ?? "").filter(Boolean),
    };
  } catch {
    return { outcome: "error" };
  }
}

function tokenOverlap(a: string, b: string): number {
  const norm = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2),
    );
  const sa = norm(a);
  const sb = norm(b);
  if (sa.size === 0) return 0;
  let hit = 0;
  for (const t of sa) if (sb.has(t)) hit++;
  return hit / sa.size;
}

async function verifyOne(
  citation: z.infer<typeof CitationSchema>,
  timeoutMs: number,
): Promise<VerifyCitationResult> {
  const checked_at = new Date().toISOString();
  const base = {
    input: {
      id: citation.id,
      doi: citation.doi,
      pmid: citation.pmid,
      url: citation.url,
    },
    crossref_ok: false,
    pubmed_ok: false,
    source: "none" as const,
    checked_at,
  };

  const validDoi = citation.doi && DOI_RE.test(citation.doi.trim())
    ? citation.doi.trim()
    : undefined;
  const validPmid = citation.pmid && PMID_RE.test(citation.pmid.trim())
    ? citation.pmid.trim()
    : undefined;

  // Pull an identifier out of a URL only when no explicit valid id was given.
  let urlDoi: string | undefined;
  let urlPmid: string | undefined;
  if (!validDoi && !validPmid && citation.url) {
    urlDoi = citation.url.match(DOI_IN_URL_RE)?.[1];
    urlPmid = citation.url.match(PMID_IN_URL_RE)?.[1];
  }
  const effectiveDoi = validDoi ?? urlDoi;
  const effectivePmid = validPmid ?? urlPmid;

  // No resolvable identifier at all.
  if (!effectiveDoi && !effectivePmid) {
    if (citation.url) {
      return {
        ...base,
        status: "url_only",
        title_match: "not_checked",
        message:
          "URL present but no resolvable DOI/PMID — use validate_links for reachability (a 200 page does not prove a real citation).",
      };
    }
    const malformed =
      (citation.doi && !validDoi) || (citation.pmid && !validPmid);
    return {
      ...base,
      status: "unverifiable",
      title_match: "not_checked",
      message: malformed
        ? "Malformed identifier — cannot assert fabrication on a non-DOI/PMID-shaped string."
        : "No DOI, PMID, or URL provided.",
    };
  }

  const [crossref, pubmed] = await Promise.all([
    effectiveDoi ? checkCrossref(effectiveDoi, timeoutMs) : Promise.resolve<ChannelResult>({ outcome: "na" }),
    effectivePmid ? checkPubmed(effectivePmid, timeoutMs) : Promise.resolve<ChannelResult>({ outcome: "na" }),
  ]);

  const crossref_ok = crossref.outcome === "ok";
  const pubmed_ok = pubmed.outcome === "ok";
  const verified = crossref_ok || pubmed_ok;

  const resolved = crossref_ok ? crossref : pubmed_ok ? pubmed : undefined;
  const source: VerifyCitationResult["source"] =
    crossref_ok && pubmed_ok ? "both" : crossref_ok ? "crossref" : pubmed_ok ? "pubmed" : "none";

  let title_match: VerifyCitationResult["title_match"] = "not_checked";
  if (citation.title && resolved?.title) {
    title_match = tokenOverlap(citation.title, resolved.title) >= 0.3 ? "match" : "mismatch";
  }

  if (verified) {
    return {
      ...base,
      status: "verified",
      crossref_ok,
      pubmed_ok,
      source,
      resolved_title: resolved?.title,
      resolved_year: resolved?.year,
      resolved_authors: resolved?.authors,
      title_match,
      message: `Resolved via ${source}.`,
    };
  }

  // No channel resolved. Distinguish fabricated (format-valid, not found) from
  // unverifiable (a network/server error left us unable to confirm).
  const queried = [crossref, pubmed].filter((c) => c.outcome !== "na");
  const anyError = queried.some((c) => c.outcome === "error");
  const allNotFound = queried.length > 0 && queried.every((c) => c.outcome === "notfound");

  if (allNotFound && !anyError) {
    return {
      ...base,
      status: "fabricated",
      title_match,
      message:
        "Format-valid identifier with no record in Crossref/PubMed — likely fabricated. Verify the source manually before citing.",
    };
  }
  return {
    ...base,
    status: "unverifiable",
    title_match,
    message:
      "Could not reach the citation database (network/server error). Status is unknown — NOT proof of fabrication. Retry later.",
  };
}

async function verifyConcurrently(
  citations: Array<z.infer<typeof CitationSchema>>,
  timeoutMs: number,
): Promise<VerifyCitationResult[]> {
  const results: VerifyCitationResult[] = new Array(citations.length);
  let head = 0;
  async function worker() {
    while (head < citations.length) {
      const i = head++;
      results[i] = await verifyOne(citations[i], timeoutMs);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, citations.length) }, worker),
  );
  return results;
}

export async function handleVerifyCitations(
  rawParams: unknown,
): Promise<ToolResult> {
  const params = VerifyCitationsSchema.parse(rawParams);
  const timeoutMs = params.timeout_ms ?? 8000;

  let audit = createAuditRecord(
    "utils.verify_citations",
    { n_citations: params.citations.length } as unknown as Record<string, unknown>,
    "json",
  );
  audit = setMethodology(
    audit,
    "DOI verified via Crossref REST API; PMID via NCBI E-utilities esummary. " +
      '"fabricated" = format-valid identifier with no database record; ' +
      '"unverifiable" = network/server error or malformed identifier (never asserts fabrication).',
  );
  audit = addAssumption(
    audit,
    `Timeout ${timeoutMs}ms per request, concurrency ${CONCURRENCY}. Absence of a record on a reachable API is treated as fabrication only when the identifier is well-formed.`,
  );

  const results = await verifyConcurrently(params.citations, timeoutMs);

  const verified = results.filter((r) => r.status === "verified").length;
  const fabricated = results.filter((r) => r.status === "fabricated").length;
  const unverifiable = results.filter((r) => r.status === "unverifiable").length;
  const url_only = results.filter((r) => r.status === "url_only").length;
  const total = results.length;

  audit = addSource(audit, {
    source: "Crossref + NCBI E-utilities",
    query_sent: `${params.citations.length} citation(s)`,
    results_returned: total,
    results_included: verified,
    latency_ms: 0,
    status: "ok",
  });

  const lines: string[] = [
    `## Citation Verification Report`,
    ``,
    `**Summary:** ${verified} verified | ${fabricated} fabricated | ${unverifiable} unverifiable | ${url_only} url-only (of ${total})`,
    ``,
    `| # | Identifier | Status | Resolved title |`,
    `|---|-----------|--------|----------------|`,
  ];
  results.forEach((r, i) => {
    const ident = r.input.doi
      ? `doi:${r.input.doi}`
      : r.input.pmid
        ? `pmid:${r.input.pmid}`
        : r.input.url
          ? r.input.url
          : "—";
    const shortIdent = ident.length > 48 ? ident.slice(0, 45) + "…" : ident;
    const title = r.resolved_title
      ? r.resolved_title.length > 50
        ? r.resolved_title.slice(0, 47) + "…"
        : r.resolved_title
      : "—";
    lines.push(`| ${i + 1} | ${shortIdent} | ${r.status} | ${title} |`);
  });
  lines.push(``);
  if (fabricated > 0) {
    lines.push(
      `> **WARNING:** ${fabricated} citation(s) are likely FABRICATED (format-valid but absent from Crossref/PubMed). Do NOT present these — they are probably invented.`,
    );
  }
  if (unverifiable > 0) {
    lines.push(
      `> **Note:** ${unverifiable} citation(s) could not be verified (network/server error or malformed identifier). Unknown ≠ fabricated — retry or confirm manually.`,
    );
  }

  const level = extractDisclosureLevel(rawParams, "standard");
  const disclosure = buildDisclosure(audit, { level });
  const text = disclosure ? `${lines.join("\n")}\n\n${disclosure}` : lines.join("\n");

  const content: VerifyCitationsContent = {
    results,
    summary: {
      total,
      verified,
      fabricated,
      unverifiable,
      url_only,
      fabrication_count: fabricated,
      verified_rate: total > 0 ? Math.round((verified / total) * 100) / 100 : 0,
    },
    text,
  };

  return { content, audit };
}

export const verifyCitationsToolSchema = {
  name: "utils.verify_citations",
  description:
    "Verify DOI/PMID citations against Crossref + NCBI E-utilities. Returns per-citation status: verified (resolved), fabricated (format-valid identifier that resolves to NOTHING — a likely invented DOI), unverifiable (network error or malformed identifier — never asserts fabrication), or url_only (a URL with no resolvable DOI/PMID). Use this to catch hallucinated references BEFORE presenting them — general LLMs fabricate ~36-40% of DOIs. Pass up to 100 citations.",
  annotations: {
    title: "Verify Citations (DOI/PMID)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      citations: {
        type: "array",
        description: "Citations to verify (max 100). Each may carry a doi, pmid, url, and/or title.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Caller correlation id (optional)" },
            doi: { type: "string", description: "DOI, e.g. 10.1056/NEJMoa1114287" },
            pmid: { type: "string", description: "PubMed ID, e.g. 20520642" },
            url: { type: "string", description: "URL (a DOI/PMID embedded in it will be extracted)" },
            title: { type: "string", description: "Title for an optional bibliographic cross-check" },
          },
        },
      },
      timeout_ms: {
        type: "number",
        description: "Timeout per request in ms (default 8000, max 30000)",
      },
      ai_disclosure_level: AI_DISCLOSURE_LEVEL_SCHEMA_PROPERTY,
    },
    required: ["citations"],
  },
};
