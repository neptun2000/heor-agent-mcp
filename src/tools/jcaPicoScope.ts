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
import { caseInsensitiveEnum } from "../util/caseInsensitive.js";
import { buildScope } from "../jca/scopeBuilder.js";
import { JCA_REVISION } from "../jca/countryRegistry.js";
import { checkScopeEligibility } from "../jca/scopeEligibility.js";
import type { ScopeEligibility } from "../jca/scopeEligibility.js";
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

const JURISDICTIONS = ["de", "fr", "it", "es", "nl", "uk", "eu_other"] as const;

const REG_CONTEXTS = [
  "pre_authorisation",
  "post_authorisation",
  "conditional_approval",
] as const;

const JcaPicoScopeSchema = z
  .object({
    drug: z.string().min(1, "drug is required"),
    indication: z.string().min(1, "indication is required"),
    drug_class: caseInsensitiveEnum(DRUG_CLASSES),
    mechanism_of_action: z.string().optional(),
    line_of_therapy: caseInsensitiveEnum(LINES).default("any"),
    biomarker_status: z.string().optional(),
    jurisdictions: z
      .array(caseInsensitiveEnum(JURISDICTIONS))
      .min(1)
      .default(["de", "fr", "it", "es", "nl"]),
    regulatory_context:
      caseInsensitiveEnum(REG_CONTEXTS).default("post_authorisation"),
    is_orphan: z
      .boolean()
      .optional()
      .describe(
        "Optional: orphan-designated medicinal product. Affects JCA scope eligibility (orphans enter scope 2028 vs 2030 for general medicinal products).",
      ),
    force_proceed_out_of_scope: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Override the JCA scope check. Default false. Set true to produce a JCA-style matrix anyway when the indication is not yet in JCA scope (e.g., for protocol-design or anticipatory market-access work). Output will carry an explicit out-of-scope warning either way.",
      ),
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

  // ── JCA scope eligibility check (Reg 2021/2282 phased rollout).
  //    Closes the gap surfaced by Claude.ai during the management
  //    benchmark — see design log #16. We compute eligibility against
  //    the indication category that scopeBuilder already classified.
  const eligibility = checkScopeEligibility({
    indication_category: matrix.indication_category,
    drug_class: input.drug_class,
    is_orphan: input.is_orphan,
  });

  audit = addAssumption(
    audit,
    `JCA scope produced for ${input.jurisdictions.join(", ")} (revision ${JCA_REVISION}). ${matrix.picos.length} consolidated PICO(s).`,
  );
  audit = addAssumption(
    audit,
    `JCA scope eligibility per Reg 2021/2282 Article 7: in_scope=${eligibility.in_scope} (phase: ${eligibility.phase}, in scope from ${eligibility.in_scope_from_year}).`,
  );

  // Out-of-scope short-circuit — refuse to produce a JCA matrix
  // and explain why, unless the caller explicitly set
  // force_proceed_out_of_scope=true (for anticipatory work).
  if (!eligibility.in_scope && !input.force_proceed_out_of_scope) {
    const refusalLines: string[] = [];
    refusalLines.push(
      `# JCA Scope Eligibility Check — ${input.drug} (${input.indication})`,
    );
    refusalLines.push("");
    refusalLines.push(
      `> ⚠️ **Not currently in JCA scope.** ${eligibility.explanation}`,
    );
    refusalLines.push("");
    refusalLines.push(`**Indication category:** ${matrix.indication_category}`);
    refusalLines.push(`**Drug class:** ${input.drug_class}`);
    refusalLines.push(
      `**JCA phase that gates scope entry:** ${eligibility.phase}`,
    );
    refusalLines.push(
      `**In JCA scope from:** 13 January ${eligibility.in_scope_from_year}`,
    );
    refusalLines.push("");
    refusalLines.push("## What to do instead");
    refusalLines.push(
      "Produce a **consolidated national-HTA PICO matrix** synthesising what each jurisdiction (G-BA/IQWiG, HAS, AIFA, AEMPS/RedETS, Zorginstituut, NICE) would require if the dossier were submitted today. This is what an MAH preparing for a future JCA dossier should compile now to anticipate consolidated PICOs at submission.",
    );
    refusalLines.push("");
    refusalLines.push(
      "To proceed anyway (e.g., for protocol-design or anticipatory market-access work), call this tool again with `force_proceed_out_of_scope: true`. The output will be labelled as out-of-scope.",
    );
    refusalLines.push("");
    refusalLines.push("## References");
    for (const r of eligibility.references) refusalLines.push(`- ${r}`);
    refusalLines.push("");

    audit = addWarning(
      audit,
      `Refused to produce JCA PICO matrix: indication "${input.indication}" (${matrix.indication_category}) is not in JCA scope until ${eligibility.in_scope_from_year}.`,
    );
    refusalLines.push(auditToMarkdown(audit));

    return {
      content: refusalLines.join("\n"),
      audit,
      pico_matrix: null,
      scope_eligibility: eligibility,
    } as ToolResult & {
      pico_matrix: null;
      scope_eligibility: ScopeEligibility;
    };
  }

  // If we got here either we're in scope, or the caller forced it.
  // Either way, emit the matrix — but add an out-of-scope warning
  // when forced, so downstream readers know.
  if (!eligibility.in_scope && input.force_proceed_out_of_scope) {
    audit = addWarning(
      audit,
      `JCA matrix produced under force_proceed_out_of_scope=true. Indication is not in JCA scope until ${eligibility.in_scope_from_year}. Output should be treated as anticipatory only.`,
    );
  }
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
  if (
    matrix.indication_category === "oncology_nsclc" &&
    input.line_of_therapy !== "second_line"
  ) {
    audit = addWarning(
      audit,
      `NSCLC comparator detail (chemo doublet + IO + alternative TKI) is currently modeled only for line_of_therapy="second_line"; you passed "${input.line_of_therapy}", so the per-country EGFR-mutant detail was skipped and a generic chemotherapy anchor was used instead. Re-run with line_of_therapy="second_line" for the well-modeled case.`,
    );
  }
  // Heart-failure ambiguity warning: HFpEF and HFrEF have completely
  // different comparator universes. When a user passes bare "heart
  // failure" without an EF qualifier, classifyIndication routes to
  // generic `cardiovascular` and serves placeholders. Surface this so
  // the user re-runs with HFrEF / HFpEF / HFmrEF specified.
  if (
    matrix.indication_category === "cardiovascular" &&
    /heart\s*failure/i.test(input.indication) &&
    !/reduced ejection|hfref|preserved ejection|hfpef|mildly reduced|hfmref/i.test(
      input.indication,
    )
  ) {
    audit = addWarning(
      audit,
      `Indication "${input.indication}" is ambiguous: HFpEF, HFmrEF, and HFrEF have materially different comparator universes (e.g., SGLT2i + ARNI structure differs). Currently routing to generic cardiovascular placeholders. Re-run with the specific phenotype (e.g., "heart failure with reduced ejection fraction" / "HFrEF" / "HFpEF") for the well-modeled case.`,
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

  if (
    matrix.indication_category === "oncology_nsclc" &&
    input.line_of_therapy !== "second_line"
  ) {
    lines.push(
      `> ⚠️ **NSCLC line-of-therapy gap.** Detailed EGFR-mutant comparator detail is modeled only for \`line_of_therapy: "second_line"\`. You passed \`"${input.line_of_therapy}"\`, so a generic chemotherapy anchor was used per country. Re-run with \`line_of_therapy: "second_line"\` for the well-modeled case (chemo doublet + IO + alternative TKI by country).`,
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
    '*Pipe `pico_matrix.picos` directly into `hta_dossier({hta_body:"jca", picos: ...})` to expand into a multi-PICO dossier.*',
  );
  lines.push("");

  for (const c of matrix.country_specific) {
    const flag =
      {
        de: "🇩🇪 Germany",
        fr: "🇫🇷 France",
        it: "🇮🇹 Italy",
        es: "🇪🇸 Spain",
        nl: "🇳🇱 Netherlands",
        uk: "🇬🇧 United Kingdom",
        eu_other: "🇪🇺 Other EU member states",
      }[c.jurisdiction] ?? c.jurisdiction;
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

  // Surrogate-endpoint note for oncology indications. Use the category
  // directly rather than guessing from outcome_priorities[0]==="OS" — the
  // proxy was correct only by coincidence and would misfire if any future
  // non-oncology category gets OS-first priorities.
  const isOncology =
    matrix.indication_category === "oncology_nsclc" ||
    matrix.indication_category === "oncology_other";
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
  lines.push("- EUnetHTA Coordination Group — Methodological Guidance Series");
  lines.push(
    "- Annex II — patient-relevant outcomes hierarchy (mortality, morbidity, HRQoL, AEs)",
  );
  lines.push(
    "- National HTA bodies: G-BA / IQWiG, HAS, AIFA, AEMPS / RedETS, Zorginstituut Nederland, NICE",
  );
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
    'Produce the canonical EU Joint Clinical Assessment (JCA) PICO matrix for a drug-indication pair. Returns a consolidated PICO list (per JCA process under Reg. 2021/2282) plus country-specific comparator universes, outcome instrument preferences, population subgroup focus, and a heterogeneity warning. Pipe `pico_matrix.picos` directly into `hta_dossier({hta_body:"jca", picos: ...})`. v1 covers DE/FR/IT/ES/NL + UK (post-Brexit context). Heterogeneity warning fires at ≥3 distinct comparator molecules across ≥2 jurisdictions — a tool-level assumption, not a published EUnetHTA threshold; treat the warning as a prompt to run evidence_network + itc_feasibility, not as a definitive diagnosis. NSCLC EGFR-mutant comparator detail is currently modeled only for line_of_therapy="second_line"; other lines use a generic chemotherapy anchor with a warning. Enum values are case-insensitive — `"DE"`/`"de"`, `"first_line"`/`"First_Line"` etc. all work.',
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
      is_orphan: {
        type: "boolean",
        description:
          "Optional. Orphan-designated medicinal product. Affects JCA scope eligibility (orphans enter scope from 13 January 2028 vs 13 January 2030 for general medicinal products).",
      },
      force_proceed_out_of_scope: {
        type: "boolean",
        default: false,
        description:
          "Override the JCA scope eligibility check. Default false. Set true to produce a JCA-style matrix anyway when the indication is not yet in JCA scope (e.g., for protocol-design or anticipatory market-access work). Output will carry an explicit out-of-scope warning either way.",
      },
    },
    required: ["drug", "indication", "drug_class"],
  },
} as const;
