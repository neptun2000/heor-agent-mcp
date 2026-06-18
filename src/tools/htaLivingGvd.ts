/**
 * hta.living_gvd — Living Global Value Dossier as a diffable artifact.
 *
 * `snapshot` records which registry claims each GVD section is built from,
 * capturing each claim's current value. `refresh` diffs that snapshot
 * against the live claim registry and returns ONLY the sections whose
 * underlying figures changed (stale) — so a refresh regenerates the
 * minimum, not the whole dossier. Persists a manifest in the project KB.
 * Pairs with evidence.claim_registry + workflow.living_evidence.
 * See design log #24.
 */
import { z } from "zod";
import {
  addAssumption,
  addWarning,
  createAuditRecord,
  setMethodology,
} from "../audit/builder.js";
import { auditToMarkdown } from "../formatters/markdown.js";
import { extractDisclosureLevel } from "../formatters/disclosure.js";
import { suggestForEnum } from "../util/didYouMean.js";
import { caseInsensitiveEnum } from "../util/caseInsensitive.js";
import { projectExists } from "../knowledge/projectStore.js";
import { loadClaimRegistry } from "../knowledge/claimStore.js";
import {
  loadGvdManifest,
  saveGvdManifest,
} from "../knowledge/gvdManifestStore.js";
import { sanitizeProjectId } from "../knowledge/paths.js";
import { claimValue, diffLivingGvd } from "../gvd/livingGvd.js";
import type { GvdManifest, LivingGvdDiff } from "../gvd/types.js";
import type { ToolResult } from "../providers/types.js";

const ACTIONS = ["snapshot", "refresh"] as const;

const SectionSchema = z.object({
  name: z.string().min(1),
  claim_ids: z.array(z.string()).default([]),
});

const HtaLivingGvdSchema = z
  .object({
    project_id: z.string().min(1, "project_id is required"),
    action: caseInsensitiveEnum(ACTIONS),
    sections: z.array(SectionSchema).optional(),
  })
  .strict();

export async function handleHtaLivingGvd(
  rawInput: unknown,
): Promise<ToolResult> {
  const parsed = HtaLivingGvdSchema.safeParse(rawInput);
  if (!parsed.success) {
    const messages: string[] = [];
    for (const issue of parsed.error.issues) {
      if (issue.code === "invalid_enum_value" && typeof issue.received === "string") {
        const suggestions = suggestForEnum(
          issue.received,
          issue.options as readonly string[],
        );
        messages.push(
          `Invalid ${issue.path.join(".")}: "${issue.received}". Allowed: ${(issue.options as string[]).join(", ")}.${
            suggestions.length ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(", ")}?` : ""
          }`,
        );
      } else {
        messages.push(`${issue.path.join(".") || "input"}: ${issue.message}`);
      }
    }
    throw new Error(messages.join("\n"));
  }
  const input = parsed.data;
  const projectId = sanitizeProjectId(input.project_id);

  if (!(await projectExists(projectId))) {
    throw new Error(
      `Project "${projectId}" not found. Create it first with project.create.`,
    );
  }

  let audit = createAuditRecord(
    "hta.living_gvd",
    input as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "Living GVD as a diffable artifact: a section→claims manifest is snapshotted at generation time and diffed against the live claim registry by value (0.5% tolerance / exact), so a refresh regenerates only sections whose underlying figures changed. Persisted in the project knowledge base.",
  );

  const registry = await loadClaimRegistry(projectId);
  const now = new Date().toISOString();
  const lines: string[] = [];

  if (input.action === "snapshot") {
    if (!input.sections || input.sections.length === 0) {
      throw new Error(
        "action 'snapshot' requires sections [{ name, claim_ids }].",
      );
    }
    const byId = new Map(registry.claims.map((c) => [c.id, c]));
    const unknownClaims: string[] = [];
    const manifest: GvdManifest = {
      schema_version: "1.0",
      project_id: projectId,
      generated_at: now,
      sections: input.sections.map((s) => {
        const snapshot_values: Record<string, number | string | null> = {};
        for (const id of s.claim_ids) {
          const c = byId.get(id);
          if (!c) {
            unknownClaims.push(id);
            snapshot_values[id] = null;
          } else {
            snapshot_values[id] = claimValue(c);
          }
        }
        return {
          name: s.name,
          claim_ids: s.claim_ids,
          snapshot_values,
          generated_at: now,
        };
      }),
    };
    const path = await saveGvdManifest(projectId, manifest);
    audit = addAssumption(
      audit,
      `Snapshotted ${manifest.sections.length} GVD section(s) against ${registry.claims.length} registry claim(s).`,
    );
    if (unknownClaims.length > 0) {
      audit = addWarning(
        audit,
        `Section(s) reference claim id(s) not in the registry: ${[...new Set(unknownClaims)].join(", ")}. Register them (evidence.claim_registry) for diffing to work.`,
      );
    }

    lines.push(`# Living GVD — snapshot (${projectId})`);
    lines.push("");
    lines.push(
      `Recorded ${manifest.sections.length} section(s); baseline captured from the claim registry.`,
    );
    lines.push("");
    lines.push("| Section | Claims tracked |");
    lines.push("|---------|----------------|");
    for (const s of manifest.sections) {
      lines.push(`| ${s.name} | ${s.claim_ids.length ? s.claim_ids.map((i) => `\`${i}\``).join(", ") : "—"} |`);
    }
    lines.push("");
    if (unknownClaims.length > 0) {
      lines.push(
        `⚠️ Unknown claim id(s): ${[...new Set(unknownClaims)].map((i) => `\`${i}\``).join(", ")} — register them so refresh can diff their values.`,
      );
      lines.push("");
    }
    lines.push(`_Manifest saved to ${path}_`);
    lines.push("");
    lines.push(
      auditToMarkdown(audit, {
        disclosure: { level: extractDisclosureLevel(rawInput, "standard") },
      }),
    );
    return {
      content: lines.join("\n"),
      audit,
      living_gvd_manifest: manifest,
    } as ToolResult & { living_gvd_manifest: GvdManifest };
  }

  // action === "refresh"
  const manifest = await loadGvdManifest(projectId);
  if (!manifest) {
    throw new Error(
      "No GVD snapshot found for this project. Run action 'snapshot' first.",
    );
  }
  const diff: LivingGvdDiff = diffLivingGvd(manifest, registry.claims);

  audit = addAssumption(
    audit,
    `Diffed ${diff.total_sections} section(s): ${diff.current_count} current, ${diff.stale_count} stale.`,
  );
  for (const w of diff.warnings) audit = addWarning(audit, w);

  lines.push(`# Living GVD — refresh diff (${projectId})`);
  lines.push("");
  lines.push(
    `**Sections:** ${diff.total_sections} · **Current:** ${diff.current_count} · **Stale (regenerate):** ${diff.stale_count}`,
  );
  lines.push("");

  if (diff.regenerate.length > 0) {
    lines.push("## ♻️ Regenerate these sections");
    for (const s of diff.sections.filter((x) => x.status !== "current")) {
      const changes = s.changed_claims
        .map((c) => `\`${c.claim_id}\`: ${fmt(c.old)} → ${fmt(c.new)}`)
        .join("; ");
      const missing = s.missing_claims.length
        ? ` · missing: ${s.missing_claims.map((m) => `\`${m}\``).join(", ")}`
        : "";
      lines.push(`- **${s.name}** (${s.status}) — ${changes || "—"}${missing}`);
    }
    lines.push("");
  } else {
    lines.push("✅ All sections current — GVD is in sync with the claim registry.");
    lines.push("");
  }

  lines.push("## Section status");
  lines.push("| Section | Status |");
  lines.push("|---------|--------|");
  for (const s of diff.sections) {
    lines.push(`| ${s.name} | ${s.status === "current" ? "✅ current" : s.status === "stale" ? "♻️ stale" : "⚠️ claim missing"} |`);
  }
  lines.push("");
  lines.push(
    "_Next: regenerate the listed sections via `hta.dossier`, then re-run `snapshot` to re-baseline._",
  );
  lines.push("");
  lines.push(
    auditToMarkdown(audit, {
      disclosure: { level: extractDisclosureLevel(rawInput, "standard") },
    }),
  );

  return {
    content: lines.join("\n"),
    audit,
    living_gvd_diff: diff,
  } as ToolResult & { living_gvd_diff: LivingGvdDiff };
}

function fmt(v: number | string | null): string {
  if (v === null) return "—";
  return typeof v === "number" ? v.toLocaleString("en-US") : v;
}

export const htaLivingGvdToolSchema = {
  name: "hta.living_gvd",
  description:
    "Maintain a Living Global Value Dossier as a diffable artifact, so a refresh regenerates only the sections whose figures changed instead of the whole GVD. Actions: 'snapshot' (record which registry claims each GVD section is built from — pass sections [{name, claim_ids}] — capturing each claim's current value as the baseline) and 'refresh' (diff the snapshot against the live claim registry and return the stale sections to regenerate, with old→new values per claim). Builds on evidence.claim_registry (the single source of truth) and pairs with workflow.living_evidence (which calls this on each living-evidence cycle). Diff is by value (0.5% tolerance / exact), and also flags sections whose claims were removed/superseded. Requires an existing project. This tool computes the diff and regeneration list; regeneration itself is done by hta.dossier. Enum values case-insensitive.",
  annotations: {
    title: "Living GVD (diffable)",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      project_id: { type: "string" },
      action: { type: "string", enum: ACTIONS },
      sections: {
        type: "array",
        description:
          "For 'snapshot': the GVD sections and the claim ids each is built from.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "GVD section name, e.g. 'Health Economic Summary'." },
            claim_ids: { type: "array", items: { type: "string" } },
          },
          required: ["name"],
        },
      },
      ai_disclosure_level: {
        type: "string",
        enum: ["off", "standard", "submission"],
      },
    },
    required: ["project_id", "action"],
  },
} as const;
