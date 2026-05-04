/**
 * jca_pico_scope — EU Joint Clinical Assessment PICO matrix analyzer.
 * Single-call tool that produces the canonical JCA consolidated-PICO list
 * for a drug-indication pair across selected EU jurisdictions. Designed
 * to feed directly into hta_dossier({hta_body:"jca", picos: ...}).
 *
 * See design log #13.
 */
import { z } from "zod";
import {
  addAssumption,
  addWarning,
  createAuditRecord,
  setMethodology,
} from "../audit/builder.js";
import { auditToMarkdown } from "../formatters/markdown.js";
import { suggestForEnum } from "../util/didYouMean.js";
import { buildScope } from "../jca/scopeBuilder.js";
import { JCA_REVISION } from "../jca/countryRegistry.js";
import type { PicoMatrix } from "../jca/types.js";
import type { ToolResult } from "../providers/types.js";

const DRUG_CLASSES = [
  "monoclonal_antibody",
  "small_molecule",
  "atmp_cell",
  "atmp_gene",
  "atmp_tissue",
  "biosimilar",
  "vaccine",
  "radiopharmaceutical",
  "other",
] as const;

const LINES = ["first_line", "second_line", "third_line_plus", "any"] as const;

const JURISDICTIONS = [
  "de",
  "fr",
  "it",
  "es",
  "nl",
  "uk",
  "eu_other",
] as const;

const REG_CONTEXTS = [
  "pre_authorisation",
  "post_authorisation",
  "conditional_approval",
] as const;

const JcaPicoScopeSchema = z
  .object({
    drug: z.string().min(1, "drug is required"),
    indication: z.string().min(1, "indication is required"),
    drug_class: z.enum(DRUG_CLASSES),
    mechanism_of_action: z.string().optional(),
    line_of_therapy: z.enum(LINES).default("any"),
    biomarker_status: z.string().optional(),
    jurisdictions: z
      .array(z.enum(JURISDICTIONS))
      .min(1)
      .default(["de", "fr", "it", "es", "nl"]),
    regulatory_context: z.enum(REG_CONTEXTS).default("post_authorisation"),
  })
  .strict();

export async function handleJcaPicoScope(
  rawInput: unknown,
): Promise<ToolResult> {
  const parsed = JcaPicoScopeSchema.safeParse(rawInput);
  if (!parsed.success) {
    const messages: string[] = [];
    for (const issue of parsed.error.issues) {
      if (
        issue.code === "invalid_enum_value" &&
        typeof issue.received === "string"
      ) {
        const suggestions = suggestForEnum(
          issue.received,
          issue.options as readonly string[],
        );
        messages.push(
          `Invalid ${issue.path.join(".")}: "${issue.received}". Allowed: ${(issue.options as string[]).join(", ")}.${
            suggestions.length
              ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(", ")}?`
              : ""
          }`,
        );
      } else {
        messages.push(`${issue.path.join(".") || "input"}: ${issue.message}`);
      }
    }
    throw new Error(messages.join("\n"));
  }
  const input = parsed.data;

  let audit = createAuditRecord(
    "jca.pico_scope",
    input as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "EU Regulation 2021/2282 (HTA Regulation) — Joint Clinical Assessment; EUnetHTA Coordination Group methodological guidance; Annex II patient-relevant outcomes hierarchy. National HTA preferences sourced from G-BA/IQWiG, HAS, AIFA, AEMPS/RedETS, Zorginstituut, NICE.",
  );

  const matrix = buildScope({
    drug: input.drug,
    indication: input.indication,
    drug_class: input.drug_class,
    mechanism_of_action: input.mechanism_of_action,
    line_of_therapy: input.line_of_therapy,
    biomarker_status: input.biomarker_status,
    jurisdictions: input.jurisdictions,
    regulatory_context: input.regulatory_context,
  });

  audit = addAssumption(
    audit,
    `JCA scope produced for ${input.jurisdictions.join(", ")} (revision ${JCA_REVISION}). ${matrix.picos.length} consolidated PICO(s).`,
  );
  if (matrix.heterogeneity_warning) {
    audit = addWarning(
      audit,
      `Comparator heterogeneity: ${matrix.distinct_comparator_count} distinct comparators across jurisdictions. NMA / Bucher feasibility may be compromised.`,
    );
  }
  if (input.regulatory_context === "pre_authorisation") {
    audit = addWarning(
      audit,
      "Pre-authorisation context — output is anticipatory only, not a JCA-finalised PICO list.",
    );
  }

  const lines: string[] = [];
  lines.push(`# JCA PICO Scope — ${input.drug} (${input.indication})`);
  lines.push("");
  lines.push(
    `**JCA revision:** ${JCA_REVISION} · **Jurisdictions:** ${input.jurisdictions.join(", ").toUpperCase()} · **Regulatory context:** ${input.regulatory_context}`,
  );
  lines.push("");

  if (input.regulatory_context === "pre_authorisation") {
    lines.push(
      "> ⚠️ **Anticipatory scope only.** JCA scope is finalised at marketing authorisation. Use this output for protocol-design and pre-MA market-access strategy — not for actual JCA submission.",
    );
    lines.push("");
  }

  if (matrix.heterogeneity_warning) {
    lines.push(
      `> ⚠️ **Comparator heterogeneity warning.** ${matrix.distinct_comparator_count} distinct comparator molecules across ${input.jurisdictions.length} jurisdictions. Run \`evidence_network\` + \`itc_feasibility\` before any quantitative estimation.`,
    );
    lines.push("");
  }

  lines.push("## Rationale");
  lines.push(matrix.rationale);
  lines.push("");

  lines.push(`## Consolidated PICO list (${matrix.picos.length} PICOs)`);
  lines.push("| ID | Population | Comparator | Outcomes |");
  lines.push("|----|------------|------------|----------|");
  for (const p of matrix.picos) {
    lines.push(
      `| ${p.id} | ${p.population} | ${p.comparator} | ${p.outcomes.join(", ")} |`,
    );
  }
  lines.push("");
  lines.push(
    "*Pipe `pico_matrix.picos` directly into `hta_dossier({hta_body:\"jca\", picos: ...})` to expand into a multi-PICO dossier.*",
  );
  lines.push("");

  for (const c of matrix.country_specific) {
    const flag =
      { de: "🇩🇪 Germany", fr: "🇫🇷 France", it: "🇮🇹 Italy", es: "🇪🇸 Spain", nl: "🇳🇱 Netherlands", uk: "🇬🇧 United Kingdom", eu_other: "🇪🇺 Other EU member states" }[
        c.jurisdiction
      ] ?? c.jurisdiction;
    lines.push(`## ${flag} — ${c.hta_body}`);
    if (c.jurisdiction === "uk") {
      lines.push(
        "*Post-Brexit, NICE alignment context only — UK is outside the JCA process but most submissions still target NICE in parallel.*",
      );
    }
    if (c.jurisdiction === "eu_other") {
      lines.push(
        "*v1 of `jca_pico_scope` covers DE/FR/IT/ES/NL + UK only — consult national HTA bodies for jurisdiction-specific comparator preferences.*",
      );
    }
    lines.push("");
    lines.push("**Comparators:**");
    for (const cmp of c.comparators) {
      lines.push(`- **${cmp.molecule}** — ${cmp.rationale}`);
      lines.push(
        `  Outcome instruments: ${cmp.outcome_instrument_preferences.join(", ")}`,
      );
    }
    if (c.population_subgroups.length > 0) {
      lines.push("");
      lines.push("**Population subgroups of HTA interest:**");
      for (const s of c.population_subgroups) lines.push(`- ${s}`);
    }
    lines.push("");
    lines.push(
      `**Outcome priority order:** ${c.outcome_priorities.join(" → ")}`,
    );
    lines.push("");
  }

  // Surrogate-endpoint note for oncology indications
  const isOncology = matrix.country_specific.some(
    (c) => c.outcome_priorities[0] === "OS",
  );
  if (isOncology) {
    lines.push("## Surrogate Endpoints");
    lines.push(
      "JCA prefers patient-relevant outcomes per Annex II of Implementing Regulation 2024/1381. **Surrogate endpoints (PFS, ORR, biomarker response) are accepted as secondary outcomes only and may face JCA scrutiny.** Plan an OS analysis even when PFS is the trial primary endpoint, and pre-specify any OS-from-PFS surrogacy assumptions in the dossier.",
    );
    lines.push("");
  }

  lines.push("## Suggested Next Steps");
  lines.push(
    `1. Pipe \`pico_matrix.picos\` into \`hta_dossier({hta_body:"jca", submission_type:"initial", drug_name:"${input.drug}", indication:"${input.indication}", picos: ...})\`.`,
  );
  lines.push(
    "2. Run `evidence_network` on the comparator universe to assess connectedness.",
  );
  lines.push(
    "3. Run `itc_feasibility` to determine whether anchored/unanchored ITC, MAIC, or full NMA is appropriate.",
  );
  if (matrix.heterogeneity_warning) {
    lines.push(
      "4. Given the heterogeneity warning, expect multiple PICOs to require separate ITCs rather than a single network analysis.",
    );
  }
  lines.push("");

  lines.push("## References");
  lines.push("- EU Regulation 2021/2282 — HTA Regulation");
  lines.push("- EU Implementing Regulation 2024/1381 — JCA procedural rules");
  lines.push(
    "- EUnetHTA Coordination Group — Methodological Guidance Series",
  );
  lines.push(
    "- Annex II — patient-relevant outcomes hierarchy (mortality, morbidity, HRQoL, AEs)",
  );
  lines.push("- National HTA bodies: G-BA / IQWiG, HAS, AIFA, AEMPS / RedETS, Zorginstituut Nederland, NICE");
  lines.push("");

  lines.push(auditToMarkdown(audit));

  return {
    content: lines.join("\n"),
    audit,
    pico_matrix: matrix,
  } as ToolResult & { pico_matrix: PicoMatrix };
}

export const jcaPicoScopeToolSchema = {
  name: "jca.pico_scope",
  description:
    "Produce the canonical EU Joint Clinical Assessment (JCA) PICO matrix for a drug-indication pair. Returns a consolidated PICO list (per JCA process under Reg. 2021/2282) plus country-specific comparator universes, outcome instrument preferences, population subgroup focus, and a heterogeneity warning when ≥3 distinct comparators emerge across jurisdictions. Pipe `pico_matrix.picos` directly into `hta_dossier({hta_body:\"jca\", picos: ...})`. v1 covers DE/FR/IT/ES/NL + UK (post-Brexit context).",
  annotations: {
    title: "JCA PICO Scope Analyzer",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      drug: { type: "string", description: "Drug name." },
      indication: { type: "string", description: "Disease/condition." },
      drug_class: { type: "string", enum: DRUG_CLASSES },
      mechanism_of_action: { type: "string" },
      line_of_therapy: { type: "string", enum: LINES, default: "any" },
      biomarker_status: {
        type: "string",
        description:
          "Optional biomarker status (e.g., 'EGFR T790M positive', 'PD-L1 TPS ≥50%').",
      },
      jurisdictions: {
        type: "array",
        items: { type: "string", enum: JURISDICTIONS },
        default: ["de", "fr", "it", "es", "nl"],
      },
      regulatory_context: {
        type: "string",
        enum: REG_CONTEXTS,
        default: "post_authorisation",
      },
    },
    required: ["drug", "indication", "drug_class"],
  },
} as const;
