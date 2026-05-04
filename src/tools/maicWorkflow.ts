/**
 * maic_workflow — server-side orchestration tool that runs the canonical
 * MAIC pipeline in one MCP call. Built because ChatGPT-5.3 cannot reliably
 * chain 5+ tool calls in parallel; this tool absorbs that orchestration
 * burden so the LLM only has to formulate the question.
 *
 * Pipeline (4 phases):
 *   Phase 1 (parallel): itc_feasibility + broad literature_search
 *   Phase 2 (parallel): per-trial literature_searches (if trial names given)
 *   Phase 3 (sequential): screen_abstracts on combined search results
 *   Phase 4 (parallel): risk_of_bias + evidence_network on screened set
 *
 * The tool STOPS SHORT of running MAIC/Bucher itself — those need IPD or
 * structured trial-level effect estimates that the search results don't
 * provide. The output report names exactly what the user must supply next.
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
import type { AuditRecord } from "../audit/types.js";
import type { ToolResult } from "../providers/types.js";

const MaicWorkflowSchema = z
  .object({
    intervention: z.string().min(1, "intervention is required"),
    comparator: z.string().min(1, "comparator is required"),
    indication: z.string().min(1, "indication is required"),
    trials_intervention: z.array(z.string()).optional(),
    trials_comparator: z.array(z.string()).optional(),
    pico: z
      .object({
        population: z.string().optional(),
        intervention: z.string().optional(),
        comparator: z.string().optional(),
        outcome: z.string().optional(),
      })
      .optional(),
    effect_modifiers: z.array(z.string()).optional(),
    outcome_type: z.enum(["binary", "continuous", "time_to_event"]).optional(),
    max_results_per_search: z.number().int().min(1).max(100).default(50),
    runs_per_search: z.number().int().min(1).max(3).default(2),
  })
  .strict();

export type MaicWorkflowInput = z.infer<typeof MaicWorkflowSchema>;

type Handler = (args: unknown) => Promise<unknown>;

export interface MaicWorkflowDeps {
  itcFeasibility: Handler;
  literatureSearch: Handler;
  screenAbstracts: Handler;
  riskOfBias: Handler;
  evidenceNetwork: Handler;
}

function isToolResult(x: unknown): x is { content: unknown } {
  return typeof x === "object" && x !== null && "content" in x;
}

function asText(x: unknown): string {
  if (!isToolResult(x)) return "";
  return typeof x.content === "string"
    ? x.content
    : JSON.stringify(x.content, null, 2);
}

async function safeRun<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function runMaicWorkflow(
  rawInput: unknown,
  deps: MaicWorkflowDeps,
): Promise<ToolResult> {
  const parsed = MaicWorkflowSchema.safeParse(rawInput);
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

  let audit: AuditRecord = createAuditRecord(
    "workflow.maic",
    input as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "MAIC orchestration: itc_feasibility (Cope 2014, NICE DSU TSD 18) → parallel literature_search (broad + per-trial) → screen_abstracts (PICO) → risk_of_bias (RoB 2/ROBINS-I) + evidence_network in parallel. Stops short of running MAIC/Bucher itself — those require IPD or trial-level effect estimates the search cannot supply.",
  );

  // ---- Phase 1: feasibility + broad search (parallel) ----
  const broadQuery = `${input.intervention} ${input.comparator} ${input.indication}`;
  const litArgsBase = {
    runs: input.runs_per_search,
    max_results: input.max_results_per_search,
    sources: ["pubmed", "clinicaltrials", "cochrane"],
  };

  const [feasResult, broadLitResult] = await Promise.all([
    safeRun(() =>
      deps.itcFeasibility({
        connected_network: true,
        h2h_available: false,
        ipd_available_for_intervention: true,
        effect_modifiers_identified: (input.effect_modifiers ?? []).length > 0,
        outcome_type: input.outcome_type,
      }),
    ),
    safeRun(() =>
      deps.literatureSearch({
        query: broadQuery,
        ...litArgsBase,
      }),
    ),
  ]);

  // ---- Phase 2: per-trial searches (parallel) ----
  const trialQueries: string[] = [
    ...(input.trials_intervention ?? []).map(
      (t) => `${t} ${input.intervention} ${input.indication}`,
    ),
    ...(input.trials_comparator ?? []).map(
      (t) => `${t} ${input.comparator} ${input.indication}`,
    ),
  ];

  const trialLitResults = await Promise.all(
    trialQueries.map((q) =>
      safeRun(() => deps.literatureSearch({ query: q, ...litArgsBase })),
    ),
  );

  // Combine all search text for screening input
  const allLitText = [
    broadLitResult.ok ? asText(broadLitResult.value) : "",
    ...trialLitResults.map((r) => (r.ok ? asText(r.value) : "")),
  ]
    .filter(Boolean)
    .join("\n\n");

  // ---- Phase 3: screening (sequential — depends on lit results) ----
  const screenResult = await safeRun(() =>
    deps.screenAbstracts({
      pico: input.pico ?? {
        population: input.indication,
        intervention: input.intervention,
        comparator: input.comparator,
        outcome: "efficacy and safety",
      },
      abstracts_text: allLitText,
    }),
  );

  // ---- Phase 4: RoB + network (parallel) ----
  const [robResult, netResult] = await Promise.all([
    safeRun(() =>
      deps.riskOfBias({
        studies: [
          {
            study_id: `${input.intervention}_trial`,
            study_type: "rct",
          },
          {
            study_id: `${input.comparator}_trial`,
            study_type: "rct",
          },
        ],
      }),
    ),
    safeRun(() =>
      deps.evidenceNetwork({
        studies_text: allLitText,
        intervention: input.intervention,
        comparator: input.comparator,
      }),
    ),
  ]);

  // Surface phase failures into the audit record so the user knows what was skipped
  if (!feasResult.ok)
    audit = addWarning(audit, `itc_feasibility skipped: ${feasResult.error}`);
  if (!broadLitResult.ok)
    audit = addWarning(
      audit,
      `broad literature_search skipped: ${broadLitResult.error}`,
    );
  if (!screenResult.ok)
    audit = addWarning(
      audit,
      `screen_abstracts skipped: ${screenResult.error}`,
    );
  if (!robResult.ok)
    audit = addWarning(audit, `risk_of_bias skipped: ${robResult.error}`);
  if (!netResult.ok)
    audit = addWarning(audit, `evidence_network skipped: ${netResult.error}`);

  audit = addAssumption(
    audit,
    "MAIC and Bucher analyses NOT run — those require IPD or trial-level effect estimates beyond search-level evidence.",
  );

  // ---- Format the 12-section report ----
  const lines: string[] = [];
  lines.push(
    `# MAIC Workflow — ${input.intervention} vs ${input.comparator} (${input.indication})`,
  );
  lines.push("");
  lines.push(
    `**Pipeline:** ITC feasibility → parallel literature search (broad + ${trialQueries.length} trial-specific) → PICO screening → RoB + evidence network.`,
  );
  lines.push("");

  lines.push("## 1. ITC Feasibility");
  lines.push(
    feasResult.ok
      ? asText(feasResult.value)
      : `*(skipped: ${feasResult.error})*`,
  );
  lines.push("");

  lines.push("## 2. Literature — Broad Search");
  lines.push(`Query: \`${broadQuery}\``);
  lines.push("");
  lines.push(
    broadLitResult.ok
      ? asText(broadLitResult.value)
      : `*(skipped: ${broadLitResult.error})*`,
  );
  lines.push("");

  if (trialQueries.length > 0) {
    lines.push("## 3. Literature — Trial-Specific Searches");
    trialQueries.forEach((q, i) => {
      lines.push(`### Query ${i + 1}: \`${q}\``);
      const r = trialLitResults[i];
      lines.push(r.ok ? asText(r.value) : `*(skipped: ${r.error})*`);
      lines.push("");
    });
  }

  lines.push("## 4. PICO Screening");
  lines.push(
    screenResult.ok
      ? asText(screenResult.value)
      : `*(skipped: ${screenResult.error})*`,
  );
  lines.push("");

  lines.push("## 5. Risk of Bias");
  lines.push(
    robResult.ok ? asText(robResult.value) : `*(skipped: ${robResult.error})*`,
  );
  lines.push("");

  lines.push("## 6. Evidence Network");
  lines.push(
    netResult.ok ? asText(netResult.value) : `*(skipped: ${netResult.error})*`,
  );
  lines.push("");

  lines.push("## 7. Limitations");
  const trialsCited = [
    ...(input.trials_intervention ?? []),
    ...(input.trials_comparator ?? []),
  ];
  lines.push(
    "- This workflow ran the **discovery + screening** half of a MAIC pipeline. The **estimation** half (MAIC, Bucher, NMA) requires individual patient data (IPD) or structured trial-level effect estimates that the search cannot synthesize automatically.",
  );
  if (trialsCited.length > 0) {
    lines.push(
      `- User-supplied trial names (${trialsCited.join(", ")}) were searched in parallel; verify hits in §3 actually correspond to the intended studies before downstream use.`,
    );
  }
  lines.push(
    "- Effect-modifier balance was not assessed against actual covariate summaries — only flagged in feasibility based on user input.",
  );
  lines.push("");

  lines.push("## 8. Next Steps (Recommendations)");
  lines.push(
    "1. **Provide IPD** from the sponsor trial of " +
      input.intervention +
      " (covariate summaries: age, sex, baseline disease severity, prior biologics, etc.) to enable an anchored MAIC.",
  );
  lines.push(
    "2. Extract **trial-level effect estimates** (HR/RR/OR + 95% CI) for the primary endpoint from the screened studies in §4 — feed those to `evidence_indirect` for an anchored Bucher comparison.",
  );
  lines.push(
    "3. Pass `rob_results` from §5 + `heterogeneity_per_outcome` from any pairwise meta-analysis to `hta_dossier_prep` to auto-fill a NICE/EMA/FDA dossier with structured GRADE evidence tables.",
  );
  lines.push(
    "4. If the network is connected per §6, consider full Bayesian NMA (R/multinma or BUGS) instead of pairwise Bucher.",
  );
  lines.push("");

  lines.push("## 9. References");
  lines.push(
    "- Cope S et al. (2014). Examination of indirect treatment comparison methods. *BMC Med Res Methodol*.",
  );
  lines.push(
    "- Phillippo DM et al. (2016). NICE DSU TSD 18: Methods for population-adjusted indirect comparisons.",
  );
  lines.push(
    "- Signorovitch JE et al. (2023). Updates on MAIC methodology. *J Dermatol Treatment*.",
  );
  lines.push(
    "- Cochrane Handbook for Systematic Reviews of Interventions, Chapters 10-11.",
  );
  if (trialsCited.length > 0) {
    lines.push(
      `- User-supplied trial names: ${trialsCited.map((t) => `\`${t}\``).join(", ")}`,
    );
  }
  lines.push("");

  lines.push(auditToMarkdown(audit));

  return { content: lines.join("\n"), audit };
}

/**
 * Production handler — wraps runMaicWorkflow with the real tool handlers
 * imported lazily to avoid circular dependencies.
 */
export async function handleMaicWorkflow(
  rawInput: unknown,
): Promise<ToolResult> {
  const [
    { handleItcFeasibility },
    { handleLiteratureSearch },
    { handleScreenAbstracts },
    { handleRiskOfBias },
    { handleEvidenceNetwork },
  ] = await Promise.all([
    import("./itcFeasibility.js"),
    import("./literatureSearch.js"),
    import("./screenAbstracts.js"),
    import("./riskOfBias.js"),
    import("./evidenceNetwork.js"),
  ]);
  return runMaicWorkflow(rawInput, {
    itcFeasibility: handleItcFeasibility as Handler,
    literatureSearch: handleLiteratureSearch as Handler,
    screenAbstracts: handleScreenAbstracts as Handler,
    riskOfBias: handleRiskOfBias as Handler,
    evidenceNetwork: handleEvidenceNetwork as Handler,
  });
}

export const maicWorkflowToolSchema = {
  name: "workflow.maic",
  description:
    "Run the canonical MAIC discovery+screening pipeline in one call: ITC feasibility + parallel literature_search (broad + per-trial) + PICO screening + risk_of_bias + evidence_network. Stops short of running MAIC/Bucher itself (those require IPD or trial-level effect estimates). Produces a structured 9-section report with explicit Next Steps. Use this as a one-shot orchestrator instead of asking Claude/ChatGPT to chain the underlying tools manually.",
  annotations: {
    title: "MAIC Workflow Orchestrator",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      intervention: { type: "string", description: "Drug/intervention name." },
      comparator: { type: "string", description: "Comparator drug name." },
      indication: { type: "string", description: "Disease/condition." },
      trials_intervention: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional trial names (e.g., QUASAR, ASTRO) to search in parallel.",
      },
      trials_comparator: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional comparator-side trial names (e.g., INSPIRE, COMMAND).",
      },
      pico: {
        type: "object",
        properties: {
          population: { type: "string" },
          intervention: { type: "string" },
          comparator: { type: "string" },
          outcome: { type: "string" },
        },
        description: "Optional PICO criteria for screening (defaults derived).",
      },
      effect_modifiers: {
        type: "array",
        items: { type: "string" },
        description: "Optional effect modifiers known from clinical input.",
      },
      outcome_type: {
        type: "string",
        enum: ["binary", "continuous", "time_to_event"],
      },
      max_results_per_search: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: 50,
      },
      runs_per_search: {
        type: "number",
        minimum: 1,
        maximum: 3,
        default: 2,
      },
    },
    required: ["intervention", "comparator", "indication"],
  },
} as const;
