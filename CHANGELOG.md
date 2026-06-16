# Changelog

All notable changes to HEORAgent MCP Server.

## v1.16.0 (2026-06-16) — literature.living_review (protocol-locked living SLR)

### Added

- **`literature.living_review` tool.** A stateless living systematic review. `init` locks a protocol and runs a baseline `literature.search`, returning the baseline records for the caller to persist; `refresh` takes the protocol + the caller's `previous_records`, re-runs the search, and returns the **delta** — new/dropped records, a deterministic **material-change** flag (a new RCT, ≥ threshold new records, or a conference late-breaker), a recommended downstream re-run list (`evidence_network` / `itc_feasibility`), and the next-refresh date from the chosen cadence (monthly/quarterly/half-yearly/annual/conference-adhoc). The MCP server holds **no state** — persistence + scheduling are host-owned (web-tier store + scheduler, a follow-up). Record identity = source `id` → normalised title+year; `recommended_downstream` is surfaced, never auto-fired (no silent schedule-triggered ITC). 13 tests. Design log #39.

## v1.15.1 (2026-06-16) — Public/internal claims-data separation (security)

### Security

- **Internal claims tools (`data.claims_query`, `data.query_agent`) are now fail-closed behind an explicit opt-in.** Previously they registered whenever `AZURE_STORAGE_CONNECTION_STRING` was present, so accidental credential presence on a public host could expose internal-only real-world claims / hospital-discharge datasets. They now require **both** `HEOR_ENABLE_INTERNAL_CLAIMS=true` **and** `AZURE_STORAGE_CONNECTION_STRING`; storage credentials alone are never sufficient (`internalClaimsEnabled()` gate + a `serverDispatchShape` source guard that prevents reverting to credential-only registration). The web tier mirrors the gate (public `toolDefinitions`, OpenAPI, ChatGPT adapter, and streaming chat exclude the claims tools unless the flag is set; landing-page examples + dataset table require `NEXT_PUBLIC_HEOR_ENABLE_INTERNAL_CLAIMS=true`; the public prompt swaps internal-claims guidance for public-source epidemiology). Design log #40.

### Fixed

- Dockerfile copies `.well-known` into the runtime image so the server card is served.

## v1.15.0 (2026-06-16) — hta.review_simulation (predict HTA clarification questions)

### Added

- **`hta.review_simulation` tool.** Predicts the clarification questions an HTA body will ask about a dossier, *before* submission. Consumes an `hta.dossier` / `hta.workflow` output (`dossier_markdown`), structured `dossier_sections`, or just `{drug, indication, pico, model_results}` for a pre-mortem. A deterministic gap/risk scan over a **10-category taxonomy** (comparator choice, indirect comparison, survival extrapolation, clinical risk-of-bias, economic-model structure, utilities, decision uncertainty, subgroups, real-world evidence, innovation/added-benefit) returns **ranked anticipated questions** with rationale, severity (critical/standard/minor), what-the-committee-looks-for, and a suggested response. **v1 bodies: NICE EAG + G-BA/IQWiG** (FDA, HAS, EU JCA → v2). Precedent links are **whitelist-only** (verified `niceTaPrecedents.ts`) and never claim a question was historically asked — every question is labelled "anticipated". Fully deterministic (no LLM call; the calling chat model presents the output); carries an ISPOR ELEVATE-GenAI disclosure block (`submission` default). New `src/review/{clarificationTaxonomy,dossierScan}.ts` + `src/formatters/reviewMarkdown.ts` + `src/tools/htaReviewSimulation.ts`. Registered in `server.ts`; web UI wired (`tools.ts`, `mcpSession.ts` TOOL_NAME_MAP, schema-parity fixture). 24 new tests. Design log #38.

## v1.14.9 (2026-06-07) — trial.enrollment_criteria + provider error surfacing

### Added

- **`trial.enrollment_criteria` tool.** Fetches enrollment/eligibility criteria for any clinical trial from ClinicalTrials.gov by NCT number. Returns structured inclusion/exclusion split, primary outcomes, study design, and audit block. Use before building any trial-vs-real-world population gap analysis. Registered in server.ts; web UI wired (tools.ts, mcpSession.ts TOOL_NAME_MAP, systemPrompt.ts mandatory-call rule).

### Fixed

- **12 literature/data providers now surface HTTP errors instead of silently returning [].** `allOfUs`, `chembl`, `citeline`, `clinicalTrials`, `cochrane`, `cortellis`, `oecd`, `orangeBook`, `pharmapendium`, `proxyClient`, `wiley`, `worldBank` previously returned empty arrays on any non-2xx response, making failures indistinguishable from "no results" in the PRISMA audit trail. All now throw a named error (`[Provider] API ${status}: ...`) with **no outer `catch { return [] }`** so the dispatcher (`providers/direct/index.ts`) records `status:"failed"` in the audit. Enterprise fetchers that use an optional localhost proxy (`cochrane`, `citeline`, `cortellis`, `pharmapendium`) catch proxy failures only to fall through to the direct API when a key is set.

### Tooling

- Web drift-guard tests updated to tool count 32 (was 31).
- `mcpInputSchemaKeys.json` fixture extended with `trial_enrollment_criteria: ["nct_id"]`.
- Version strings synced to 1.14.9 across `server.json`, `.well-known/mcp/server-card.json`, `package-lock.json`, `web/lib/openApiSpec.ts`.

Tests: `npm run build`; `npm test -- --runInBand` (130 suites, 1283 tests).

## v1.14.8 (2026-06-06) — Multi-country claims summary fast path

### Fixed

- **Population-sizing summaries now cover Mexico DGIS, Chile DEIS, and NY SPARCS, not only Brazil DataSUS.** `data.claims_query` uses the compact `claims_visits_summary` layer for single-dataset `prevalence`/`count` requests on `datasus_sih`, `mexico_egresos`, `chile_deis`, and `ny_sparcs`, then falls back to raw parquet if a requested summary is unavailable.
- **NY SPARCS ICD queries use ICD-10 prefixes directly.** The raw ETL already normalises SPARCS CCSR categories to representative ICD-10 prefixes, so `data.claims_query({ datasets:["ny_sparcs"], icd10_prefixes:["E11"] })` no longer translates back to obsolete CCSR codes such as `END003`.
- **NY SPARCS 2023 is treated as known-missing.** The summary path prunes only loaded years (`2017-2022`, `2024`), so multi-year NY requests can return available years instead of failing on an empty 2023 glob.
- **`data.query_agent` now routes Chile (`CL`) to `chile_deis` and keeps US inpatient sizing on summary-backed NY SPARCS primary data.** This avoids bundling MEPS into the same raw scan, which could defeat the summary fast path or hit missing-year globs.
- **MAIC workflow keeps the historical “Next Steps” heading text while retaining the stricter required-tool-call guidance.** This restores the existing output contract without changing the workflow behavior.

### Added

- **Generic flat-claims summary builder.** `scripts/etl/build_claims_primary_diag_summary.py` builds and uploads compact `primary_diag_counts.parquet` files for `mexico_egresos`, `chile_deis`, and `ny_sparcs` using parallel dataset-year workers.

Tests: `npm run build`; `npm test -- --runInBand` (129 suites, 1262 tests).

## v1.14.6 (2026-06-06) — DATASUS nationwide query fast path

### Fixed

- **Brazil DataSUS SIH population-sizing queries no longer time out on nationwide multi-year scans.** `data.claims_query` now uses a compact `datasus_sih` diagnosis-count summary layer for `prevalence`/`count` requests and falls back to raw parquet if the summary layer is unavailable. The raw fallback still keeps DATASUS nested `source_year/region` paths separate from flat datasets to avoid DuckDB empty-glob IO errors.
- **`data.query_agent` keeps output parseable while telling the model when live claims data succeeded.** Live-data confirmations and presentation instructions now live inside JSON fields instead of a non-JSON preamble, preventing downstream parsers from seeing different shapes while still blocking fabricated "DataSUS unavailable" fallbacks.

### Added

- **Parallel DATASUS summary map-reduce builder.** `scripts/etl/build_datasus_sih_summary.py` maps each `year x UF` raw parquet partition, reduces counts by `source_year`, `region`, `primary_diag_icd`, `sex`, and `age_years`, and uploads one compact summary parquet per year under `claims_visits_summary/source_dataset=datasus_sih/`.
- Uploaded 2018-2024 DataSUS SIH summary parquet files to Azure Blob Storage and verified the failing Brazil T2D 2019-2022 query returns live counts with `execution.source = "datasus_summary"`.

Tests: `npm run build`; `npm test -- --runInBand` (129 suites, 1254 tests).

## v1.14.4 (2026-06-06) — Placeholder ICER now propagates into dossier prose (#37)

Completes the design-log #35 guard: the `_placeholder` tag set by `hta_workflow` survives Zod (`CEModelResultSchema` is `.passthrough()`) but the dossier renderers were silently discarding it. Two defects fixed + one overclaim.

### Fixed

- **GVD path no longer renders a placeholder ICER as authoritative prose.** `hta_dossier({hta_body:"gvd"})` printed defaulted ICERs as clean *"estimated to be cost-effective at X/QALY"* in both the Executive Summary and Section 9 (Health Economic Summary), `status:"complete"`, no warning. The `_placeholder`/`_defaulted_inputs` flags now flow through `gvdSectionRouter` into the section generators → a `⚠️ PLACEHOLDER ICER — NOT VALID FOR SUBMISSION` banner with `status:"missing"` (listed under Gap Analysis).
- **NICE / EMA / FDA / IQWiG / HAS now render piped `model_results`.** `buildSection` never received `model_results`, so the "Economic Evidence Summary" section always said *"Economic model results not provided"* — a real, valid piped ICER was silently dropped for all five bodies. It now renders the ICER (placeholder-aware: banner + gap when flagged).
- **Removed an unsupported cost-effectiveness claim.** Section 9 asserted *cost-effectiveness* from the ICER alone with no willingness-to-pay-threshold comparison. Reworded to *"has a deterministic ICER of X/QALY. Compare against the relevant WTP threshold to draw a cost-effectiveness conclusion."*

New shared `src/tools/htaDossier/economicSummary.ts` (`extractEconomicSummary` + `renderPlaceholderBanner`) keeps the GVD and NICE-family paths consistent. +6 regression tests; full suite 1249 passing.

## v1.14.3 (2026-06-05) — Close-out: hta_workflow placeholder guard (#35) + live-API smoke

Closes the remaining tracked follow-ups from design log #36.

### Added

- **`hta_workflow` no longer presents fabricated economics as real (design log #35).** Phase 4 now detects which `ce_inputs` the caller omitted (drug/comparator cost, effect measure). By default it still runs the CE model but **loudly flags the ICER as `⚠️ PLACEHOLDER … NOT VALID FOR SUBMISSION`** (in `ceSummaryText`, an audit warning, and a `_placeholder` tag on `model_results` for the dossier) instead of emitting an authoritative-looking number from defaults (drug £1000, efficacy_delta 0.25). New **`require_real_ce_inputs`** flag (default false) makes it **skip the CE phase entirely** with guidance when real inputs aren't supplied. Exposed in the web tool definition; web↔MCP parity fixture updated.
- **`scripts/smoke/live-api-smoke.mjs`** — opt-in smoke that drives a live MCP `literature.search` with an edge-case parenthesized/boolean query and asserts the hardened fetchers return results or surface an explicit error (never a silent empty). Verified against live Azure MCP.

## v1.14.2 (2026-06-05) — Bug-hunt second pass: external-API hardening + anti-fabrication

Second pass of the cross-tool audit (design log #36), split between Claude (tools/models) and Codex (providers/external-API). All changes are MCP-server-side; the web tool surface is unchanged (stays at API version 1.14.1).

### Fixed — anti-fabrication (tools/models)

- **`workflow.maic` no longer fabricates studies.** It passed mechanically-named `"<drug>_trial"` stubs to `risk_of_bias`, producing a RoB table for studies that don't exist. RoB is no longer auto-run; §5 now directs the user to run `risk_of_bias` on the actual screened trials.
- **`cost_effectiveness_model` discloses placeholder inputs.** Loud ⚠️ "INDICATIVE ONLY" warning when PartSA survival medians are defaulted (24/12/18/9 months); Markov structural assumptions (2% mortality, the `efficacy_delta`→transition formula, the 0.7× comparator scalar) are now disclosed as illustrative assumptions instead of being invisible.
- **`ai_disclosure_level` is now discoverable.** It was placed outside `inputSchema.properties` in `survival_fitting`, `hta_workflow`, `hta_dossier`, `cost_effectiveness_model`, so external MCP clients couldn't see it. Moved inside `properties`; guarded by `tests/schemas/aiDisclosurePlacement.test.ts`.

### Fixed — external-API hardening (providers)

- Sanitize/encode requests and stop silently swallowing non-2xx across the live-API fetchers: `scienceDirect` (Scopus-400 + throw), `purpleBook` (Lucene quote injection), `biorxiv` (boolean-query tokenizer + first-page note), `cmsNadac`/`whoGho` (URL-encode filter keys), `pubmed`/`googleScholar` (surface 429/`{error}` instead of returning `[]`). Thrown errors now record `status:"failed"` + an audit warning via the dispatcher. `validateLinks`: AIFA/TLV added to browser-only; HTA 401/407 treated like 403 bot-blocks.

## v1.14.1 (2026-06-05) — Fixes: dispatch double-wrap, EMBASE query, fabricated-utility disclosure

Bug-hunt pass after several user-found production issues. The common thread: failures that live in the integration/runtime layer (server dispatch, real external APIs, defaulted inputs) which unit tests structurally miss. Adds guards so these classes are now caught automatically.

### Fixed

- **Server-dispatch double-wrap (5 tools).** `regulatory.status_check`, `evidence.unmet_need`, `evidence.clinical_scale`, `data.claims_query`, `data.query_agent` set `result = { content: [{type,text}] }`, which the post-switch JSON-stringified a second time — the LLM received a stringified envelope instead of the payload. Now `result = { content: <payload> }` (single wrap), matching `governance.self_check`. Same class fixed there in v1.14.0.
- **EMBASE query 400 (MCP-side).** `providers/direct/embase.ts` sent the raw query to Scopus, which rejects parentheses/bare boolean operators (`400 "Error translating query"`), and then swallowed the error into an empty result. Now sanitizes the query to a flat term list (mirrors the web fix) and propagates the error to the PRISMA audit instead of silently returning `[]`.
- **Fabricated utility values now loudly disclosed.** `cost_effectiveness_model` defaulted `qaly_on_treatment=0.75 / qaly_comparator=0.7` when `utility_inputs` was omitted (the common case), producing a real-looking QALY ICER from placeholders with only a buried note. Now emits a prominent ⚠️ "UTILITY VALUES DEFAULTED — INDICATIVE ONLY" warning next to the ICER headline and in the Warnings section.

### Added (test guards)

- **`tests/serverDispatchShape.test.ts`** — fails CI if any dispatch case re-introduces the `result = { content: [` double-wrap pattern.
- Web **`__tests__/webMcpSchemaParity.test.ts`** — fails if `web/lib/tools.ts` omits a functional parameter the MCP `inputSchema` exposes (caught `cost_effectiveness_model` `survival_inputs`/`scenarios`/`run_owsa`, `hta_dossier` ×6 JCA/severity params, `survival_fitting` `event_data`, + `knowledge_search`/`budget_impact_model`/`jca_pico_scope` drift — all now added to the web tool definitions).

## v1.14.0 (2026-06-04) — Feature: GenAI Governance Self-Check (`governance.self_check`)

Adds a new tool that scores an AI-assisted HTA/HEOR workflow against six governance dimensions, each traced to the **verified** ELEVATE-GenAI reporting domains (ISPOR Working Group on Generative AI; Fleurence RL et al., Value Health 2025;28(11):1611–1625). Companion to design log #34 and the "Risk Register → Reference Implementation" responsible-GenAI initiative.

### New

- **`governance.self_check` tool** — six dimensions (transparency, citation validation, human-in-the-loop, PHI/data handling, bias & equity, auditability), each footnoted to the verified ELEVATE-GenAI domains (10 domains extracted from the published checklist). Two input modes:
  - `describe` — free-text `workflow_description` + structured probes. A blank/omitted probe scores **`insufficient`**, never a pass (silence ≠ Green).
  - `audit_record` — pass a prior HEORAgent `AuditRecord` to auto-derive transparency / citation validation / auditability from the real trace (human-oversight / PHI / bias remain `insufficient` unless probed).
- **Deterministic scoring** — Red/Amber/Green/Insufficient per dimension, `use_case`-gated aggregate verdict ("any Red blocks submission-ready"; no gameable composite score). Pure scoring core in `src/governance/{crosswalk,scoring}.ts`; renderer in `src/formatters/governanceMarkdown.ts`.
- Emits a pipeable `governance_summary` and carries its own ELEVATE disclosure block (reuses `src/formatters/disclosure.ts`).
- Web tier routes governance keywords ("governance", "ELEVATE", "responsible AI", …) to the Azure `smart` tier (in-tenant inference). Preflight guard gains `anyOf` support so an empty call returns conversational guidance, not a ZodError.
- Tool count 30 → 31.

### Fixed

- Version manifests realigned: `server.json`, `.well-known/mcp/server-card.json`, and `web/lib/openApiSpec.ts:MCP_API_VERSION` were stale at 1.11.3 (missed during the v1.12.0/v1.13.0 releases) — all now synced to 1.14.0.

## v1.13.0 (2026-05-28) — Feature: AI Transparency Disclosure (ISPOR ELEVATE-GenAI aligned)

Adds a structured AI-assistance disclosure block to tool outputs, aligned with the ISPOR ELEVATE-GenAI reporting guidelines (Fleurence RL et al., Value Health 2025;28(11):1611–1625).

### New

- **`ai_disclosure_level` parameter** on 16 tools: `"off"` | `"standard"` (default for most) | `"submission"` (default for HTA/regulatory tools). Controls whether and how the disclosure block is appended to tool output.
- **`buildDisclosure(audit, opts)`** in `src/formatters/disclosure.ts`: renders a formatted AI Assistance Disclosure section from the audit record. Derives data sources from the existing `sources_queried: SourceAudit[]` field — no schema duplication.
- **`extractDisclosureLevel(args, default)`**: safe extraction from raw args before Zod parsing, allowing per-call override without modifying 30 Zod schemas.
- **`AI_DISCLOSURE_LEVEL_SCHEMA_PROPERTY`**: reusable JSON Schema fragment published in `inputSchema.properties` for all 16 wired tools.
- **`addToolCall(record, trace)`** in `src/audit/builder.ts`: appends a `ToolCallTrace` to `audit.tools_called` (immutable append).
- **`ToolCallTrace` interface** in `src/audit/types.ts`: `{ name, ms, outcome, output_size_bytes? }`.
- **Persona-driven defaults** in `web/lib/systemPrompt.ts`: payer/HTA-reviewer personas default to `"submission"`; analyst personas default to `"standard"`; scratchpad intent → `"off"`.
- **3 new homepage example cards** in `Chat.tsx` demonstrating submission-ready disclosure, payer dossier full disclosure, and disclosure-off scratchpad workflows.

### Wiring by tool tier

| Tier | Tools | Default level |
|------|-------|---------------|
| Standard | riskOfBias, screenAbstracts, itcFeasibility, populationAdjustedComparison, survivalFitting, costEffectivenessModel, budgetImpactModel | `"standard"` |
| Submission | htaDossierPrep, htaWorkflow, utilityValueSet, maicWorkflow, jcaPicoScope, pvClassify, pvSignalWorkflow, irbReview, icfReadabilityCheck | `"submission"` |
| Excluded | knowledge.*, project.create, utils.validate_links | no change |

### ISPOR citation

> Fleurence RL, Dawoud D, Bian J, Higashi MK, Wang X, Xu H, Chhatwal J, Ayer T; ISPOR Working Group on Generative AI. ELEVATE-GenAI: Reporting Guidelines for the Use of Large Language Models in Health Economics and Outcomes Research: An ISPOR Working Group Report. Value Health. 2025;28(11):1611–1625. doi:10.1016/j.jval.2025.06.018

---

## v1.11.3 (2026-05-22) — Fix: expose run_owsa and study_types in MCP schemas

`run_owsa` was accepted by the `models.cost_effectiveness` handler (`if (params.run_owsa !== false)`) but absent from the JSON `inputSchema` — MCP clients couldn't discover or disable one-way sensitivity analysis. `study_types` was defined as a Zod enum in `literature.search` but similarly missing from the JSON schema.

Both fields are now published in their respective `inputSchema` objects with full type and description. `tests/schemas/mcpToolSchemas.test.ts` extended with 2 new drift-guard assertions (total: 13).

## v1.11.2 (2026-05-22) — Fix: expose 6 hidden hta_dossier fields in MCP schema

`heterogeneity_per_outcome`, `upgrading_per_outcome`, `severity_modifier`, `health_inequalities`, `pv_classification`, and `regulatory_landscape` were all accepted and used by the `hta.dossier` handler but absent from the published MCP JSON `inputSchema`. External MCP clients (Claude Desktop, Smithery, etc.) could not discover or pass these fields, silently breaking the pipe workflows that `pv_classify` and `regulatory_status_check` were designed to feed into `hta.dossier`.

All 6 fields are now fully documented in the `inputSchema` with types and descriptions matching the Zod schemas. `tests/schemas/mcpToolSchemas.test.ts` extended with 6 new drift-guard assertions.

## v1.11.1 (2026-05-22) — Bug fixes: MFN schema exposure, PartSA MFN runner, telemetry

### Fixed: MFN fields missing from MCP-published tool schemas

`mfn_sensitivity` was implemented in the `models.cost_effectiveness` Zod schema and handler but absent from the exported `costEffectivenessModelToolSchema` JSON — external MCP clients (Claude Desktop, Smithery, etc.) could not discover the field. Likewise `mfn_context` was missing from the `hta.dossier` MCP inputSchema. Both fields are now present in the published schemas with full descriptions and required-field lists.

Added `tests/schemas/mcpToolSchemas.test.ts` as a permanent drift guard so Zod and MCP schemas can't diverge silently again.

### Fixed: MFN sensitivity always used Markov runner even for PartSA models

`runMfnSensitivity` was called with `runMarkovAndComputeICER` regardless of `model_type`. When the base model was `partsa`, the MFN curve was computed from a Markov run, producing mixed-method output (PartSA base case + Markov MFN curve). The callback now dispatches to `runPartSA` when `model_type="partsa"`, producing a consistent single-method result.

### Fixed (web): `hta_body` enum in `web/lib/tools.ts` missing `"gvd"`

The web-tier tool definition exposed `["nice", "ema", "fda", "iqwig", "has", "jca"]` — `"gvd"` was present in the MCP server schema but not in the Claude web UI tool definition. GVD dossiers were silently inaccessible from the web UI.

### Fixed (web): MCP tool errors tracked as `status=ok` in PostHog

`McpSession.dispatch()` catches all errors and returns `"Error: ..."` strings (by design — so Claude receives the error text). The chat route's `trackToolCall` call sat immediately after `dispatch()` and always emitted `status: "ok"`. The route now checks for the `"Error: "` prefix and emits `status: "error"` with `error_class: "McpError"` and the message body.

Also fixed: the PostHog `distinctId` was hardcoded to `"chatgpt_adapter"` for all surfaces. Claude web UI calls now use `distinctId: "anon_claude_web"` so the two surfaces are distinguishable in analytics.

## v1.11.0 (2026-05-09) — MFN-aware tooling: basket data, dossier section, CE price sweep

Implements the Most-Favored-Nation pricing layer across three tool surfaces. Triggered by CMS proposed GUARD (Part D) and GLOBE (Part B) payment models, which anchor US drug prices to a 19-country OECD basket minimum — a structural shift that makes the gap between US net price and the MFN ceiling a first-order market-access input. Design log #27.

### New: `src/data/mfnBasket.ts` — 19-country basket data + ceiling math

- `MFN_BASKET_2026` — canonical 19-country ISO-2 list (AT BE CZ DK FR DE IE IT NL NO ES SE CH GB AU JP KR CA IL) per CMS GUARD/GLOBE proposed rule, revision 2026-03.
- `computeMfnCeiling(basket_prices, opts?)` — returns `{ ceiling: number|null, contributing_countries, missing_countries }`. Returns `null` when no basket prices supplied; never fabricates a ceiling from memory.
- Rejects negative / NaN / Infinity prices with `TypeError`.
- 16 unit tests in `tests/data/mfnBasket.test.ts`.

### New: `src/models/mfnSensitivity.ts` — deterministic ICER price sweep

`runMfnSensitivity(baseParams, inputs, runModel)` sweeps drug price from `min_basket` to `current_us_price` at N discrete points (default 11) and returns:
- `curve` — ICER at each price point.
- `crossovers` — price at which ICER crosses each WTP threshold (linear interpolation); `null` when the curve never crosses.
- `icer_at_ceiling` / `icer_at_current` — convenience aliases for first/last curve points.

Why deterministic sweep instead of another PSA? MFN is an exogenous price shock, not statistical uncertainty. 11 Markov runs vs 1000+ PSA runs; output is payer-readable ("ICER drops from $X to $Y; WTP crossover at price $Z").

13 unit tests in `tests/models/mfnSensitivity.test.ts`.

### Extended: `models.cost_effectiveness` — `mfn_sensitivity` input field

When caller supplies `mfn_sensitivity: { min_basket, current_us_price, n_points?, wtp_thresholds? }`:
- Runs the deterministic price sweep after the base-case model.
- JSON output gains `mfn_sensitivity: { range, curve, crossovers, icer_at_ceiling, icer_at_current }`.
- Text output gains a `### MFN Price Sensitivity` section with the price table and WTP crossover bullets.
- Zod schema enforces `min_basket ≥ 0`, `current_us_price ≥ 0`, `n_points` 2–101.

6 integration tests in `tests/tools/costEffectivenessModelMfn.test.ts`.

### Extended: `hta.dossier` — `mfn_context` input field

When caller supplies `mfn_context: { basket_prices, us_current_net_price?, basket_revision?, excluded_countries? }` and the HTA body is NICE / EMA / FDA / IQWiG / HAS / GVD:
- Renders an **MFN Exposure** section with the full 19-country basket table, computed MFN ceiling, gap-to-US %, and 4 mitigation strategy recommendations (evidence-package investment, managed-entry agreements, launch sequencing, confidential rebate structures).
- The section is opt-in (requires `basket_prices` to be non-empty). No auto-render body in v1.11.0 — AMCP is pending design log #24.
- GVD dossier early-return branch also includes the MFN section (mirrors design log #26 Regulatory Landscape pattern).

15 integration tests in `tests/tools/htaDossierMfn.test.ts`.

### Extended: `src/server.ts` — MFN telemetry flags

`trackToolCall` on success now includes:
- `mfn_sensitivity_invoked: true` when `models.cost_effectiveness` is called with `mfn_sensitivity`.
- `mfn_context_emitted: true` + `mfn_basket_countries: N` when `hta.dossier` is called with `mfn_context`.

Enables PostHog HogQL queries to measure MFN feature adoption without schema changes.

### Extended: web tier — SYSTEM_PROMPT + tool schema

- `web/lib/claude.ts` SYSTEM_PROMPT: new **MFN (MOST-FAVORED-NATION) PRICING & GLOBAL ACCESS STRATEGY** block. Covers 3 market archetypes (evidence-constrained / IRP-influenced / structural), evidence-anchor strategy, when to call `mfn_sensitivity` vs `mfn_context`, and a hard rule against fabricating basket prices.
- `web/lib/tools.ts`: `cost_effectiveness_model` schema gains `mfn_sensitivity` object; `hta_dossier` schema gains `mfn_context` object. Claude can now pass both without schema errors.

12 web tests in `web/__tests__/mfnPhase4.test.ts`.

### Full test suite

1133 tests passing (1121 MCP + 12 new web). 0 failures.

---

## v1.10.2 (2026-05-12) — stop reusing the 500-char telemetry cap as the client response

A 0-CRITICAL hygiene release that fixes a quiet bug discovered while debugging a real ChatGPT failure on 2026-05-12 09:15:24 (user `1be263` called `hta.dossier` with no payload).

### The bug

`classifyToolError` in `src/analytics.ts` returned a single `error_message` field, truncated to 500 chars. That truncation was intended for telemetry hygiene — PostHog event properties have a size limit, and a multi-issue ZodError dump on a heavy schema can run 1-2KB.

`src/server.ts:475` then used that same truncated string as the **client-facing response** content (the `text` of the `text` content block returned to whoever called the tool). Multi-issue ZodErrors arrived at clients (ChatGPT Custom GPT especially) **with the JSON cut mid-key** — `"received": "string", "rece` — and were unparseable. ChatGPT bounced instead of retrying with the missing fields. Five real-user errors followed this pattern in the 14 days before discovery.

### The fix

Split the field. `classifyToolError` now returns:

```ts
{
  error_class: string;       // unchanged — Error subclass name for dashboards
  error_message: string;     // FULL text — for the client response
  telemetry_message: string; // capped at 500 chars — for PostHog
}
```

`server.ts:472` now passes `telemetry_message` to `trackToolCall` (PostHog hygiene preserved) and uses `error_message` for the `text` content (full message reaches the client).

### Why it isn't strictly redundant with the web-tier fix (deployed 2026-05-12)

The web tier (`web/lib/zodErrorFormatter.ts`) already reformats raw ZodError JSON arriving from MCP into one-line "field.path: Required" text, AND salvages complete issues from truncated arrays. So clients calling via the web/ChatGPT adapter are protected today even on v1.10.1.

But:
1. **Direct MCP clients (Claude Desktop, Cursor, the npm `npx` users) don't go through the web tier.** They see the raw truncated ZodError straight from Railway. v1.10.2 fixes their experience.
2. **The web-tier fix is defensive masking; v1.10.2 is the root-cause fix.** Both layers help — defense in depth.

### Tests

`tests/analytics/errorClassification.test.ts` updated to cover the split:
- `error_message` preserves full text (2000-char input → 2000-char output).
- `telemetry_message` capped at ≤500.
- ZodError on an 8-required-field schema produces an `error_message` > 500 chars (regression for the 2026-05-12 `hta.dossier` failure pattern).

Full suite: 8/8 in errorClassification, no other tests touched.

### Non-breaking for consumers

`error_class` and `error_message` are still present and PostHog dashboards keep working unchanged (telemetry is now slightly more selective about which message it stores). The only behavioral change visible to a client of the MCP server is: error responses are no longer truncated mid-message. That's a strict improvement.

---

## v1.10.1 (2026-05-10) — auto-wire `regulatory.status_check` (the "make the right thing easy" follow-up to v1.10.0)

v1.10.0 shipped the primary-source regulatory lookup tool. v1.10.1 closes the loop: the tool now fires *automatically* inside `evidence.unmet_need` and a new `hta_workflow` Phase 3.6, so the model can no longer fabricate a "no approved option" claim by simply forgetting to call it. Design log #26.

### `evidence.unmet_need` — default-on regulatory fan-out

When `treatment_landscape.current_soc[]` is supplied, the handler now fans out to `regulatory.status_check` for each molecule across the user-supplied `jurisdictions[]`. Results are injected as a structured `regulatory_context[]` array AND rendered as inline label-quote attributions in the treatment-landscape paragraph ("Per FDA/OpenFDA label retrieved 2026-05-10: fremanezumab is approved for the preventive treatment of migraine in adults and in pediatric patients 6 years of age and older [citation N].").

- Default-on; opt out via `auto_check_regulatory: false`.
- Region mapping: `us` → `us`; `de/fr/it/es/nl` → `eu`; `uk` → `uk` (currently degrades gracefully — no UK source yet); `jp` → graceful gap.
- Citations auto-numbered into the existing registry.
- Concurrency capped at 8 per request (see autoCheck.ts).
- 24h cache shared with explicit `regulatory.status_check` calls — repeated drug/region lookups within a workflow are free.

### `hta_workflow` Phase 3.6 — new "regulatory_landscape" phase

Inserted between Phase 3.5 (evidence.unmet_need) and Phase 4 (CE model). Fans out across comparators surfaced in earlier phases, pipes results into `hta_dossier` as a new `regulatory_landscape[]` parameter. Always runs when comparators are present, regardless of `hta_body`. Adds ~5-10s to total workflow time on a typical 4-comparator dossier.

### `hta_dossier` — new "Regulatory Landscape" section

Renders for `nice` / `jca` / `gvd` / `amcp` bodies. Table format: comparator × region × current approved indication × label-revision date × source URL. Provides auditable provenance for the regulatory claims that downstream payers verify line-by-line.

### Graceful degradation — non-negotiable

`api_error` or `current_status: "unknown"` from `regulatory.status_check` never blocks dossier rendering. Instead the failure is appended to `gaps[]`:
- `"regulatory_status check failed for {drug} ({region}) — verify label manually before submission"`
- `"{drug} not found in {region} regulatory database — primary-source verification needed; did you mean: {suggestion_1}, {suggestion_2}?"`

The dossier proceeds with whatever regulatory context is available. This is the same design philosophy as the literature-search degradation: surface gaps explicitly, don't fail the workflow.

### Cycle safety

`regulatory.status_check`'s handler is statically prevented from importing `evidence.unmet_need` (per design log #26 Q10). Tests assert this so a future contributor doesn't create an A→B→A loop.

### Rate-limit headroom

`OPENFDA_API_KEY` env var is now respected by the OpenFDA client (the v1.10.0 implementation accepted it but the wiring shipped here). Anonymous OpenFDA limit is 240 req/min; with key, 120K/day. Production should set the env var.

### Tests

29 new regression tests across autoCheck (9), evidence.unmet_need integration (8), hta_workflow Phase 3.6 (6), hta_dossier regulatory-landscape rendering (8). Full suite: **111 suites / 1069 tests** (up from 110 / 1037).

### Compatibility

- Tool count stays at **28** — no new tool, only auto-wiring of v1.10.0's tool into two existing tools.
- `auto_check_regulatory: false` preserves the v1.10.0 behavior for callers that want the explicit-call path.
- Existing `evidence.unmet_need` callers see no breaking change unless they were depending on the absence of `regulatory_context[]` in the output (unlikely).

---

## v1.10.0 (2026-05-10) — `regulatory.status_check` tool (#28) — primary-source label lookup

New tool that closes a real-user incident category. Design log #25.

### The trigger — fremanezumab/pediatric-migraine, 2026-05-07

Michael's colleagues at work asked `evidence.unmet_need` for a fremanezumab/pediatric-migraine dossier. The output asserted "CGRP mAbs have no approved pediatric indication" — true at LLM training cutoff, **false since FDA approval of AJOVY (fremanezumab-vfrm) for pediatric episodic migraine in August 2025** (sBLA 761089/s031). Same staleness trap is waiting on every drug with recent label changes (Aimovig, lecanemab, donanemab, biosimilars, withdrawals…). Pointing the LLM at `orange_book` via `literature_search` returns product index entries, not the current Indications and Usage section. **HEORAgent had no canonical regulatory-status lookup.** v1.10.0 ships one.

### What the tool does

```ts
regulatory.status_check({ drug: "fremanezumab", region: "us", indication?: "migraine" })
```

Returns:
- `current_status` — `approved` | `pending` | `withdrawn` | **`unknown`** (never `not_approved` on database miss)
- `approved_indications[]` — verbatim label text + age/weight constraints + approval date
- `recent_label_revisions[]` — last 12 months of changes
- `source_urls[]` + `data_fetched_at` for full auditability
- `did_you_mean[]` — Levenshtein suggestions on no-match (catches typos before the analyst burns hours)

### The CRITICAL invariant

`current_status` **never** equals `"not_approved"`. Primary-source absence ≠ proof of non-approval — that's the exact fremanezumab failure inverted. Database miss → `unknown` + `did_you_mean[]`. Documented in the tool description, asserted in tests.

### Sources

- **US: OpenFDA** (drug/label endpoint) — primary. Optional `OPENFDA_API_KEY` for higher rate limits (wiring landed in v1.10.1).
- **US: DailyMed** — cross-check for verbatim Indications and Usage text.
- **EU: EMA EPI FHIR** — adapter against the EMA Open Data clinical-data API.
- **UK: stub** — placeholder for eMC + NICE TA index; v1.7.x lookahead.

### Caching

24h TTL, in-memory, shared across MCP sessions. `force_refresh: true` bypasses. Cache key includes drug-name normalisation so `Fremanezumab` / `fremanezumab-vfrm` / `AJOVY` hit the same entry.

### Tests

Live OpenFDA smoke test confirmed primary-source retrieval on real label queries. Full suite **110 suites / 1037 tests** at v1.10.0 ship.

### Companion fix bundled in this release: Codex review P1+P2+P3

Three correctness fixes that shipped alongside the new tool:

- **P1 (CE model)**: `model_type: "partsa"` silently fell through to Markov when `survival_inputs` was missing — Zod stripped the field because it was never in the schema. Added `survival_inputs` to `CEModelSchema` + the exported tool schema; the handler now hard-fails when `partsa` is set without it instead of degrading to the wrong model class.
- **P2 (workflow)**: `utility_inputs` was being built with only one of two QALY fields, then rejected by CE schema (silent fallthrough). Now requires both fields together.
- **P3 (workflow)**: `unmet_need_inputs` existed in the internal Zod schema but was missing from the exported MCP tool schema — clients couldn't discover the GVD Phase 3.5 surface. Added to tool inputSchema with description.

7 new regression tests for these (3 PartSA, 2 utility, 2 schema-exposure).

---

## v1.6.3 (2026-05-07) — code-review polish for v1.6.2 + Slack-digest hardening

Two parallel reviewers audited v1.6.2 and the new Slack weekly-digest feature within hours of ship. Combined: 0 CRITICAL, 0 HIGH, 6 MEDIUM, 6 LOW. All real findings addressed; cosmetic items deferred. Total tests 833 → 838.

### Fixed (schema, MCP server)

- **Whitespace tolerance in `caseInsensitiveEnum`.** `val.trim().toLowerCase()` before lookup — `"  NICE  "` now normalises to `"nice"` instead of falling through to invalid_enum_value. Test file already comment-promised this; now wired. +4 regression tests.
- **`risk_of_bias.instrument` + `risk_of_bias.output_format` + `hta_dossier.intervention_impact`** — three enums missed in v1.6.2's class-wide application. LLMs naturally pass `"RoB2"`, `"AUTO"`, `"Narrows"`. Now case-insensitive consistent with the rest of the surface.
- **Tool description hints** — every case-normalised tool now explicitly advertises case-insensitivity in its top-level description so LLMs reading the JSON Schema (project_create / pv_classify / irb_review / hta_dossier / jca_pico_scope / risk_of_bias) actually learn the schema is permissive.

### Fixed (Slack weekly digest)

- **PostHog 200-with-error-field check** in `hogql()`. PostHog returns HTTP 200 with `{error: "..."}` for query-level failures (bad HogQL, quota exceeded, project ID mismatch). Pre-fix, the digest silently posted "0 events, 0 users" without surfacing why. Now throws a typed error.
- **`runWeeklyDigest` Promise.all → `Promise.allSettled`** with per-source fallbacks. Single-source failure (esp. anonymous-rate-limited GitHub) no longer kills the whole digest. Failed sources surface as a "⚠️ Degraded sources this run: ..." prepended insight bullet so a missing GitHub-stars row is self-explanatory. PostHog stays load-bearing — both PostHog calls failing still throws.
- **`AbortSignal.timeout(8000)` on every external fetch** (npm, GitHub, Railway health, npm registry, all 7 PostHog HogQL queries). Pre-fix, a single stalled call could eat the cron route's 60s budget and silently miss the Monday digest.
- **Optional `GITHUB_TOKEN` env support.** Anonymous GitHub API limit is 60 req/hr per IP; Vercel functions share IP pools, so the limit is hit unexpectedly. A classic PAT (no scopes needed) raises the ceiling to 5,000/hr.

### Added — pinning tests

- `studies: {}` empty-object input — pins the documented degraded-but-non-erroring behavior (singleton-wrap → all-defaults → Unclear-on-all-domains result) so a future schema-strictness change can't silently break it.
- `risk_of_bias.instrument` case-insensitive regression test.

### Skipped (cosmetic)

- Type inference widening (`z.ZodEffects` → `string` instead of `T[number]`) — only matters if we add discriminated-union switches downstream, which we haven't.
- Misleading "constant-time" comment in cron route — `!==` is fine for our threat model on a 32-byte hex secret used only by Vercel infrastructure; comment removed.
- `weekStart` doc-comment off-by-one — code is correct, comment was misleading; deferred.
- Engagement-gap heuristic n=1 sample noise — wait until we have data showing it actually fires on noise, then tune.
- Token-in-URL — accepted by design (bookmark UX).

### Tests

833 → 838 MCP tests passing (+4 trim regression + 1 studies:{} pinning + 1 instrument case-insensitive). 154/154 web tests still passing (Slack stats fixes are network-dependent paths; covered by type-check + manual audit, no fetch-mocking integration test added in this patch).

### Non-breaking

All changes are silent failure-mode hardening + LLM ergonomics. No API surface changes; no migration needed.

## v1.9.2 (2026-05-09) — polish: Nelder-Mead early exit + 6 review nits

Six small quality improvements deferred from the v1.9.1 review. None are correctness fixes; these are polish on the v1.7-1.9 work. Two have a measurable performance impact:

### Performance — full test suite **215s → 19s** (11×)

Two of the changes turn out to dominate overall test runtime:

- **Nelder-Mead convergence-tolerance early exit** in `survivalFitting.ts`. Pre-fix, the optimizer ran the full `maxIter=800` iterations regardless of convergence — typical fits converge in ~50-200 iterations, so 600+ were wasted compute. Added `if spread < 1e-8 (or 1e-6 relative) break` after the simplex sort. Real survival-MLE fixtures now converge in 50-150 iterations.
- **Log floor `1e-300 → 1e-30`** in `logLikelihoodFromEvents`. The ultra-deep floor created near-flat likelihood surfaces in pathological starting regions; raising the floor lets the optimizer navigate cleanly. Combined with the early-exit, this halves runtime for the harder distributions (Log-normal, Gompertz). R's `flexsurv` and `survival` packages use a similar order-of-magnitude floor.

### Correctness / hygiene

- **Bootstrap RNG seeding for tests.** `computeEVPPI` and `bootstrapEVPPICI` now accept an optional `rng` parameter (defaults to `Math.random`). Tests pass a seeded `mulberry32` so the bootstrap CI is reproducible across runs. The "CI tightens at N" test no longer needs its `+1` slack — assertion tightened to strict `widthLarge < widthSmall`.
- **Tightened parameter-recovery tolerances** in `tests/models/survivalFitting.test.ts`:
  - Exponential N=500: 20% → 10% (~1.5 SD)
  - Exponential N=1000: 12% → 7%
  - Weibull N=500: 25% → 15% (joint 2-param MLE has higher variance)
  - Log-normal μ: abs<0.4 → abs<0.25; σ: 30% → 18%
  - Heavy 60% censoring: 30% → 20%

  Tighter tolerances catch a 10% systematic bias that the previous 3-4 SD width would have missed. All still pass on the seeded fixtures.
- **Documented the magic init values** in each survival fitter (Weibull `[1.0, scaleInit]`, log-logistic `[m, 1.5]`, log-normal `[muInit, 0.8]`, Gompertz `[0.01, rateInit]`). Each now has a comment explaining the empirical reasoning so a future maintainer doesn't over-tune them.
- **Removed `void splitSentences`/`tokenizeWords`/`countSyllables` workaround** in `icfReadabilityCheck.ts`. These imports were never directly called in the handler — they were "tree-shaking guards" that silently relied on indirect use through `computeStats` / `computeReadabilityScores`. The unit tests already exercise them directly, so the explicit imports + `void` no-ops were dead code. Cleaned up.

### Tests

909/909 still passing. No new tests added — all changes either tighten existing assertions or are pure refactors of correct code.

### Performance impact in production

Negligible. The Nelder-Mead early exit speeds up `survival_fitting` IPD calls by ~3-4× in the typical case (faster convergence) but wall-clock for a 500-patient fit was already <100ms before, so the user-visible difference is "fast" → "very fast". The log floor change is functionally invisible at production parameter values.

### Non-breaking

All changes are pure quality improvements. No API surface changes; no observable behavior change at production parameter ranges.

## v1.9.1 (2026-05-09) — code-review fixes for v1.7.0 / v1.8.0 / v1.9.0

Two parallel reviewers (math/statistics + ICF formula correctness) audited the v1.7-1.9 work within hours of ship. **0 CRITICAL, 4 HIGH, 8 MEDIUM, 7 LOW.** All 4 HIGHs were real correctness bugs in code that produces HTA / CMS / IRB-grade outputs. All addressed in this patch.

### Fixed (HIGH)

- **EVPPI bootstrap CI upper-bound was systematically downward-biased** (`src/models/evppi.ts:bootstrapEVPPICI`). Pre-fix the bootstrap loop capped each resample at the original sample's `totalEVPI`, truncating the upper tail of the bootstrap distribution whenever a resample's empirical totalEVPI exceeded the original. The fix removes the in-loop cap; only the FINAL reported percentile bounds are clamped. Decision-makers reading "EVPPI = $1,200 (95% CI $400–$2,800)" now see honest tails — narrower CIs no longer underestimate research value.

- **Survival IPD `mean_survival_restricted` was mislabeled across all 5 distributions** (`src/models/survivalFitting.ts:fitXFromEvents`). Pre-fix the IPD path returned unrestricted means (Exp: `1/λ`, Weibull: `scale·Γ(1+1/shape)`, Log-normal: `exp(μ+σ²/2)`), the median (Log-logistic: `α`), or — most egregiously — the EXPONENTIAL DISTRIBUTION's mean/median ratio applied to a Gompertz median (`median × 1/ln(2) = median × 1.4427`). All five fitters now call the existing `restrictedMean(kmTable, survFn)` helper for proper numerical integration of S(t) over [0, max_observed]. Wrong RMST → wrong QALY → wrong ICER → wrong reimbursement decision. The KM-table path was unaffected (already used `restrictedMean()` correctly).

- **`countComplexWord` `-es` suffix stripping under-counted complex words** (`src/icf/syllables.ts`). Pre-fix unconditionally stripped trailing "-es", so 3-syllable plurals like `processes` (pro-ces-ses) or `addresses` (ad-dress-es) became 2-syllable `process`/`address` and missed Gunning's complexity threshold. Result: Gunning Fog and SMOG scores under-reported ICF difficulty — investigators received better scores than reality and didn't rewrite sentences they should. Fix: only strip `-es`/`-ed`/`-ing` when the syllable count is unchanged after stripping (a non-syllabic morphological inflection).

- **`"effectiveness"` removed from medical-jargon dictionary** (`src/icf/jargon.ts`). The previous entry directly contradicted FDA's "Communicating Risks and Benefits" (2011) and NIH Plain Language guidance, both of which recommend `"effectiveness"` AS the plain-language replacement for `"efficacy"`. An investigator who had already done the right thing would see it flagged and revert to the harder term. The matching `"efficacy"` entry remains.

### Fixed (MEDIUM)

- **Verdict logic OR/AND mismatch documented as AND** (`src/icf/types.ts`). The runtime code uses AND semantics ("FKGL ≤ target+1.5 AND <40% exceed → borderline"); the type comment said OR. Aligned the comment to the code; AND is the patient-safety direction.

- **Jargon recommendation now fires for any hits, not only ≥3** (`src/tools/icfReadabilityCheck.ts`). Pre-fix a passing FKGL with 2 jargon terms would emit no jargon-rewrite recommendation. Threshold dropped to ≥1; output cap remains at 5 terms with a "+N more" suffix.

- **`worst_sentences` filtered to only target-exceeding sentences**. Pre-fix the field was top-5-by-FKGL regardless; programmatic consumers could see "worst" sentences within target. Now matches the markdown rendering (which already filtered).

- **Pass-with-jargon messaging implicitly fixed** by the jargon-threshold drop above. A passing FKGL with jargon hits now correctly emits the jargon recommendation rather than the misleading "✅ No rewrite recommendations" line.

### Skipped (cosmetic)

- Bootstrap RNG seeding for the "CI tightens at N" test (theoretically flaky but hasn't bit yet)
- `1e-300` log floor in survival MLE tightening to `1e-30` (hasn't caused convergence issues empirically)
- Nelder-Mead convergence-tolerance early exit (test suite is slow but acceptable)
- Initial-parameter documentation for log-logistic / log-normal / Gompertz fitters
- Tightening parameter-recovery test tolerances (current 3-4 SD width is loose but catches the 50% bugs we care about)
- Hidden-import `void` workaround in icfReadabilityCheck.ts handler (cosmetic)

### Tests

10 new regression tests:
- 1 EVPPI bootstrap CI bound check (no longer artificially capped)
- 5 ICF `countComplexWord` cases (`processes`, `addresses`, `cakes`, `walking`, `encyclopedia`)
- 2 ICF dictionary integrity (`effectiveness` removed, `efficacy` retained)
- 1 ICF `worst_sentences` only-exceeding invariant
- 1 ICF jargon recommendation fires for any hits

899 → 909 MCP tests passing. Web tests still 177/177.

### Non-breaking

All changes are bug fixes. No API surface changes. The `mean_survival_restricted` field semantics are now correct (RMST instead of unrestricted mean) — callers that already used it as RMST per its documented meaning get more accurate values; callers that were treating it as unrestricted mean were getting the wrong field anyway.

## v1.9.0 (2026-05-09) — `survival_fitting` patient-level MLE path (no longer ⚠️ EXPERIMENTAL on the IPD input)

The tool now accepts patient-level event-time data (`event_data: Array<{time, event: 0 | 1}>`) alongside the legacy `km_data` step-summary path. Caller picks one (Zod refine enforces). When event_data is supplied, the fit is true right-censored maximum likelihood per Collett (2015) and NICE DSU TSD 14 (Latimer 2013) — no approximation warning. The KM-table path remains supported for back-compat with literature-digitization workflows but emits an explicit "approximation, less reliable" warning and points the caller at event_data.

### Added

- **`event_data` input** with at least 5 patient-level rows. Each row is `{time, event}` where `event=1` for an observed event and `event=0` for right-censoring at `time`.
- **`fitSurvivalCurvesFromEventData()`** model entry point. Five distributions (Exponential, Weibull, Log-logistic, Log-normal, Gompertz) fit via Nelder-Mead simplex on the proper right-censored log-likelihood `Σᵢ [δᵢ·log(f(tᵢ)) + (1-δᵢ)·log(S(tᵢ))]`.
- **Kaplan-Meier curve from event data.** When event_data is supplied, the markdown report's "KM Observed" column is built from the standard KM estimator on those same rows — no separate input needed.
- **Mutually-exclusive Zod validation.** Caller passes exactly one of `km_data` or `event_data`; passing both or neither raises a clear error.

### Changed

- **Methodology line** branches: event_data path cites Collett 2015 + TSD 14; km_data path is honest that it's an interval-censored approximation.
- **Tool description** no longer leads with "⚠️ EXPERIMENTAL"; instead positions event_data as the preferred path with km_data as legacy.
- **CLAUDE.md ⚠️ EXPERIMENTAL list** trimmed from 2 → 1: only `population_adjusted_comparison` (MAIC/STC) remains.

### Tests

14 new IPD-path tests in `tests/models/survivalFitting.test.ts`:
- Schema invariants (rejects N<5, returns 5 fits, monotonic KM curve)
- **Parameter recovery** — simulate from known Exponential(λ=0.05) / Weibull(shape=1.5, scale=20) / Log-normal(μ=2.5, σ=0.6) and verify recovered params within 20-30% at N=500-1000 with seeded mulberry32 PRNG (deterministic). Strongest available evidence the MLE is correct.
- Model selection sanity (correct distribution wins by AIC on truly-from-that-distribution data)
- S(0)=1, monotonic decreasing, S(median)≈0.5 invariants
- Heavy 60% censoring still recovers parameters within 30%
- Zero-censoring corner case

5 additional tool-level tests for the new schema paths (event_data path methodology, KM-path "approximation" warning unchanged but no longer says "EXPERIMENTAL", mutual-exclusivity validation).

882 → 901 MCP tests passing.

### Non-breaking

- `km_data` API surface unchanged. Existing callers that pass `km_data` get the same fit they got before, with a slightly clarified warning ("approximation" instead of "EXPERIMENTAL").
- `event_data` is purely additive — no migration needed.

## v1.8.0 (2026-05-09) — `icf_readability_check` tool (paired with `irb_review`)

New tool. Closes the v2 deferral from design log #21: paired ICF
readability analyzer that was promised when irb_review v1 shipped.

### Added — `icf_readability_check` (`icf.readability_check`)

Takes ICF text, returns:
- **Readability scores** — Flesch-Kincaid Grade Level, Flesch Reading Ease, Gunning Fog Index, SMOG Grade.
- **Per-sentence breakdown** with worst-5 sentences (FKGL desc) flagged so investigators see exactly which sentences exceed the target grade level.
- **Medical-jargon detection** — curated dictionary of ~80 high-frequency clinical-trial-consent terms (placebo, randomized, adverse event, pharmacokinetics, comorbidity, etc.) with plain-language alternatives. Case-insensitive whole-word matching with optional plural matching (`adverse event` → also catches `adverse events`).
- **Pass / borderline / fail verdict** vs target grade level (default 8 per FDA/NIH guidance; configurable 4-12).
- **Concrete rewrite recommendations** when verdict is not pass — targeted at worst sentences + jargon hits + sentence-length / syllables-per-word patterns.

Pure logic, no external API. <300ms on a 50-sentence ICF.

### References baked into the methodology

- Kincaid JP et al. (1975) — FKGL formula
- Flesch R. (1948) — Reading Ease
- Gunning R. (1952) — Fog Index
- McLaughlin GH. (1969) — SMOG
- NIH Plain Language Guidelines (clinical-trial consent)
- FDA Communicating Risks and Benefits (2011)

### Tests

34 new tests across schema validation, syllable counting (heuristic ±1 of CMU dict), sentence splitting (handles abbreviations: Dr. / Mr. / e.g. / i.e.), word tokenization, FKGL/FRE formula correctness on known reference texts, per-sentence breakdown, jargon detection (case-insensitive, whole-word, capped at 5 occurrences), verdict logic, output structure, performance.

848 → 882 MCP tests passing. Web tool count assertions bumped 26 → 27 across 4 test files.

### Tool count

26 → 27. Full tool list: `literature.search`, `literature.screen`, `evidence.network`, `evidence.indirect`, `evidence.population_adjusted`, `evidence.survival`, `evidence.risk_of_bias`, `evidence.itc`, `evidence.clinical_scale`, `evidence.unmet_need`, `models.cost_effectiveness`, `models.budget_impact`, `hta.dossier`, `hta.utility`, `hta.workflow`, `utils.validate_links`, `project.create`, `knowledge.search`, `knowledge.read`, `knowledge.write`, `examples`, `workflow.maic`, `pv.classify`, `pv.signal_workflow`, `jca.pico_scope`, `irb.review`, **`icf.readability_check`** ← new.

## v1.7.0 (2026-05-09) — EVPPI promoted out of ⚠️ EXPERIMENTAL

Three quality fixes to the Strong-2014 binning estimator in `cost_effectiveness_model`'s EVPPI path. Removes the long-standing CLAUDE.md caveat ("non-parametric binning, noisy when total EVPI ~0").

### Fixed

- **Mathematical cap.** EVPPI ≤ totalEVPI by definition (per-parameter information value can't exceed full-uncertainty resolution). Pre-fix the binning estimator could overshoot due to sample noise, producing `evppi_proportion > 1.0` in rare cases. Now `Math.min(raw, totalEVPI)` per parameter.
- **Noise-floor guard.** When the decision is robust to uncertainty (totalEVPI ~ 0), per-parameter binning still produced fake positive signals from sample noise — leading to a misleading "top 5 parameters worth researching" table built from pure noise. We now compute a noise-floor threshold relative to NMB stddev (`0.5% × stddev(NMB)`); if totalEVPI falls below it, all per-parameter EVPPIs are suppressed to `0` with `below_noise_floor: true`. The markdown report surfaces a clear "Decision is robust to all uncertainty" message instead of the empty/noisy table.
- **Adaptive bin width** via Freedman-Diaconis (`h = 2·IQR·N^(-1/3)`) replacing Sturges' rule. F-D adapts to actual data spread and handles non-normal distributions better — important for cost / utility parameters which are typically right-skewed. Falls back to Sturges' for constant or tied parameters.
- **Constant-parameter short-circuit.** When a parameter has zero variance, EVPPI is now hard-coded to 0 (rather than picking up unrelated NMB variance from the sort being arbitrary on equal keys). Fixes a fake-positive that the binning estimator alone couldn't avoid.

### Added

- **Bootstrap 95% confidence interval** per parameter (200 resamples with replacement). Each EVPPIResult now carries `evppi_ci_lower`, `evppi_ci_upper`, and `evppi_se`. Skipped for parameters below the noise floor (no point in CI on noise) and for tiny samples (`N < 50`). Markdown report shows the CI alongside the point estimate: `| Parameter | EVPPI | 95% CI | % of EVPI |`.

### Tests

13 new EVPPI tests across 6 describe blocks:
- Basic invariants (small-N skip, missing-param skip, sort order, non-negativity)
- Mathematical cap (EVPPI ≤ totalEVPI; proportion ∈ [0,1])
- Noise-floor guard (suppression on robust-decision fixture; doesn't fire on high-uncertainty fixture)
- Bootstrap CI (CI brackets point; CI ≥ 0; CI tightens as N grows; CI omitted below noise floor)
- Constant-parameter handling

848/848 tests passing (was 835).

### Non-breaking

`EVPPIResult` adds 4 optional fields (`evppi_ci_lower`, `evppi_ci_upper`, `evppi_se`, `below_noise_floor`). The pre-existing `evppi`, `evppi_proportion`, `parameter` fields are unchanged. No migration needed.

### Open methodology gaps (deferred)

The binning estimator still doesn't match the gold-standard methods (GAM regression per Strong 2014, Gaussian-process regression per Heath-Manolopoulou-Baio 2018) for accuracy in challenging cases. Adding a real GAM smoother is ~2 weeks of work and is candidate for a future v1.x patch when there's appetite. v1.7.0 makes the binning estimator HONEST (no fake positives, proper uncertainty quantification, mathematical bounds) — appropriate for the current default use case where EVPPI is one of many sensitivity outputs, not the primary model output.

## v1.6.2 (2026-05-07) — schema hardening for LLM input shapes

Two LLM-input-shape fixes surfaced by a PostHog audit of `project.create` and `evidence.risk_of_bias` errors.

### Fixed

- **Class-wide case-insensitive enums** via shared `src/util/caseInsensitive.ts`. PostHog showed 5 production failures with `hta_targets: ["NICE", "ICER"]` — LLM callers naturally pass brand casing instead of canonical lowercase tokens. Vanilla `z.enum()` rejected; new helper preprocesses to canonical case before validation. Truly unknown values still fail with did-you-mean hints.

  Applied to:
  - `project_create` — `hta_targets`
  - `pv_classify` — `study_design`, `primary_objective`, `regulatory_context`, `jurisdictions`
  - `irb_review` — `study_design`, `data_handling`, `risk_level`, `funding_source`, `jurisdictions`, `exempt_category_hint`
  - `hta_dossier` — `hta_body`, `submission_type`, `output_format`
  - `jca_pico_scope` — `drug_class`, `line_of_therapy`, `jurisdictions`, `regulatory_context`

- **`risk_of_bias` singleton studies auto-wrap.** PostHog showed real-world calls with `studies: {...}` (singleton object) instead of `studies: [{...}]` (array). Pre-process auto-wraps before the array schema runs — preserves `min(1)` constraint and per-element parsing.

### Tests

+9 helper tests (`tests/util/caseInsensitive.test.ts`) + 7 regression tests across `project_create` and `risk_of_bias`. Total 822 → 829 passing.

### Non-breaking

Canonical lowercase still works exactly as before. New code only adds tolerance for upper/mixed case. No API surface changes; no migration needed.

## v1.6.1 (2026-05-07) — `hta_workflow` GVD routing + Phase 3.5 unmet-need integration

Wires the new `evidence.unmet_need` tool from v1.6.0 into the `hta_workflow` orchestrator as Phase 3.5, between risk-of-bias and cost-effectiveness. Also extends `hta_workflow` to route GVD-specific section generators when `hta_body: "gvd"`.

### Added
- **`hta_workflow` Phase 3.5** — automatically calls `evidence.unmet_need` and pipes the structured `unmet_need_summary` into the dossier draft. Default-on for any `hta_body` that surfaces unmet-need (NICE STA, EU JCA, GVD); skippable via `skip_unmet_need: true` when running an iteration.
- **`hta_workflow` GVD routing** — when `hta_body: "gvd"`, the orchestrator routes through the v1.6.0 GVD section generators (Sections 1-13) instead of the generic skeleton, producing per-market subsections (US/UK/EU5/JP) and the `gvd_evidence_pack` pipe interface.

### Fixed
- **Phase 3.5 unmet-need parsing.** Initial integration assumed the handler wrapped output in `{content: ...}`; in practice `evidence.unmet_need` returns the assessment object directly. Phase 3.5 now reads `result.unmet_need_summary` directly. Caught immediately post-1.6.0; shipped as 1.6.1 patch.

## v1.6.0 (2026-05-07) — `evidence.unmet_need` tool + Global Value Dossier section generators

Two design-log items shipped together. Tool count 25 → 26.

### Added — `evidence.unmet_need` (design log #23)

New tool: structured 4-dimension unmet-need framework. Inputs: indication + jurisdiction + optional `literature_evidence` (output from `literature_search`). Output: markdown report + structured `unmet_need_summary` JSON object that pipes into `hta_dossier({hta_body:"gvd"})` Section 4 and `hta_dossier({hta_body:"nice"})` for the NICE Severity & Inequalities section.

Four dimensions:
1. **Disease burden** — incidence/prevalence, mortality, morbidity, demographics
2. **Treatment landscape gap** — current SoC limitations, response rates, AE profiles, off-label patterns
3. **QoL impact** — EQ-5D / disease-specific instruments, work productivity, caregiver burden
4. **Economic burden** — direct medical, indirect costs, productivity loss, healthcare utilisation

Per-jurisdiction depth (light v1): adds country-specific epidemiology and SoC where the user supplies a jurisdiction code. Citations carry URL with pre-validation. 12+ tests.

### Added — Global Value Dossier section generators (design log #22)

Existing `hta_dossier({hta_body:"gvd"})` was a 13-section skeleton emitting generic boilerplate. v1.6.0 ships actual section generators that consume `literature_search` / `risk_of_bias` / `evidence_indirect` / `cost_effectiveness_model` / `budget_impact_model` / `evidence.unmet_need` outputs and produce GVD-specific prose:

- **Section 1** — Disease background (consumes `evidence.unmet_need` Dimension 1)
- **Section 2** — Treatment landscape (consumes `evidence.unmet_need` Dimension 2 + `literature_search` HTA precedent)
- **Section 3** — Product profile (drug + indication metadata)
- **Section 4** — Unmet need (full `evidence.unmet_need` output)
- **Section 5-7** — Clinical evidence (consumes screened literature + RoB + GRADE)
- **Section 8** — Economic evaluation (consumes `cost_effectiveness_model` results)
- **Section 9** — Budget impact (consumes `budget_impact_model` results)
- **Section 10** — Pricing & access (per-market subsections US/UK/EU5/JP)
- **Section 11** — Reimbursement landscape per market
- **Section 12** — Pharmacovigilance (consumes `pv_classification` if supplied)
- **Section 13** — Patient access programs

Plus a `gvd_evidence_pack` pipe interface so GVD output can pre-fill country-specific dossiers (NICE / JCA / AMCP). DOCX table styling. AMCP Format 4.1 deliberately deferred to v1.7. 15+ tests.

## v1.5.2 (2026-05-07) — live-formula XLSX + neurology clinical scales

Two more design-log items in a single release. Both surfaced gaps from the v1.4.x management benchmark vs Claude.ai (slide 6 "❌ today" → ✅).

### Added — `evidence.clinical_scale` (design log #19)

New umbrella tool covering 6 neurology and cognitive scales:
- **UMSARS** (MSA — orphan, Phase-2-2028 JCA scope)
- **UPDRS** + **MDS-UPDRS** (Parkinson's)
- **ADAS-Cog**, **MoCA**, **MMSE** (Alzheimer's / cognitive)

Per-scale total + subscale scoring, MCID-based responder analysis (Krismer 2017 / Horváth 2015 / Andrews 2019 thresholds), trajectory comparison vs natural-history reference cohorts (NNIPPS / EMSA-SG / PPMI / ADNI summary-level v1). Time-to-milestone integration via `survival_fitting`.

Three new JCA indication sub-classes added to `jca_pico_scope`:
- `neurology_msa` — orphan, Phase 2 (2028) JCA scope
- `neurology_pd` — Phase 3 (2030) general medicines
- `neurology_ad` — Phase 3 (2030)

Per-country comparator universes:
- **MSA**: BSC across all (no DMTs in standard care)
- **PD**: levodopa / rasagiline / DBS depending on stage
- **AD**: donepezil / memantine / lecanemab / donanemab depending on stage

17 tests. Tool count 24 → 25.

### Changed — live-formula XLSX upgrade (design log #20)

Refactored `formatters/xlsx.ts` so the XLSX output for `cost_effectiveness_model` and `budget_impact_model` emits **live Excel formulas** instead of pre-computed values:

- **New "Markov Trace" sheet** — `n_cycles` rows × 13 formula columns. Each row references the Inputs sheet so editing a transition probability or cost recomputes the trace in-place.
- **Transition Matrix** cells reference Inputs sheet directly.
- **CEAC** uses COUNTIFS formulas referencing the PSA sheet — drag the WTP threshold and the curve recalculates.
- **Summary** uses SUMPRODUCT referencing Markov Trace — ICER updates as inputs change.

PSA per-iteration values are kept as static numbers (audit reproducibility — re-running PSA stochasticity inside Excel would break determinism).

Same treatment for `budget_impact_model` XLSX (year-by-year SUM formulas referencing the inputs sheet).

15 tests. Closes the v1.4.x management benchmark "partial" rating on Slide 6. Customers can now genuinely edit any input → trace recomputes → ICER updates → CEAC curve shifts.

## v1.5.1 (2026-05-06) — `irb_review` code-review fixes

Three parallel reviewers (regulatory accuracy with WebFetch verification, decision-tree correctness, test-gap analysis) audited v1.5.0 within hours of ship. **3 HIGH regulatory citation errors + 4 HIGH correctness bugs + 6 untested branches** identified. All real findings verified against primary sources (eCFR via govinfo.gov / Cornell LII; EU CTR 536/2014 via legislation.gov.uk + European Commission) and patched. Total tests 683 → 708.

### Fixed (HIGH — regulatory accuracy)

- **Pregnant women consent trigger inverted (rulesets.ts).** v1.5.0 wording said "Both parents' consent required when research holds **no** direct benefit" — that's §46.204(d), which actually requires only the woman's consent. Both-parent consent is §46.204(**e**) and the trigger is "research holds out the prospect of direct benefit **solely to the fetus**." An investigator following the v1.5.0 obligation text would have obtained father consent unnecessarily on no-benefit studies, or skipped it on benefit-solely-to-fetus studies. Corrected per eCFR §46.204(d) and (e) verbatim.
- **§46.306 prisoner-research subcategories misattributed (rulesets.ts).** v1.5.0 said "practices that may improve health/well-being of prisoners as a class is the broadest." That description maps to (a)(2)(**iii**) (class-level), not the broadest. The most commonly invoked sub-paragraph for therapeutic prisoner research is (a)(2)(**iv**) which is about the **individual subject**'s health/well-being. Now enumerates all four sub-paragraphs (i-iv) with the correct attribution.
- **§46.406 missing "generalizable knowledge" eligibility gate (rulesets.ts).** v1.5.0 wording read "§46.406 (minor increase over minimal, no direct benefit)" — but §46.406(c) imposes an additional mandatory IRB finding: the research must be "likely to yield generalizable knowledge about the subjects' disorder or condition." Without this, healthy-child studies could be misclassified to §46.406 when they actually require the stricter §46.407 Secretary-determination pathway.

### Fixed (HIGH — decision-tree correctness)

- **NIH-funded research reported no COI obligation (decisionTree.ts:computeCoi).** Pre-fix: `funding_source !== "industry"` returned `{ required: false, framework: "none" }` for ALL non-industry funding. Real legal bug — PHS 42 CFR 50 Subpart F (FCOI regulation) applies to all PHS-funded research (NIH, AHRQ, CDC, HRSA, FDA, IHS, SAMHSA), not only industry. Now: `phsApplies = onUs && (industry || nih || other_government)` triggers PHS framework; EU CTR Annex I §M Point 66 unchanged (industry-only).
- **Interventional full-board rationale falsely asserted "greater-than-minimal risk" when input was actually `risk_level: "minimal"` without `marketed_drug` hint.** Now branches on the actual `risk_level` value — minimal-risk + no-hint reads "Interventional study at minimal risk but no marketed-drug/device hint supplied" with explicit guidance to set `marketed_drug=true` for cat 1 expedited.
- **`risk_level: "unknown"` warning was gated to `study_design === "interventional"` only.** Other designs (registry, retrospective_chart_review, non_interventional_prospective) silently fell through to full-board with no advisory. Now emits a tier-specific warning on each branch.
- **`benign_behavioural=true` with non-interventional study_design silently ignored.** Hint requires `study_design === "interventional"` per §46.104(d)(3); now warns when set on a non-interventional design instead of dropping silently.

### Fixed (MEDIUM)

- **CTR 536/2014 Article 14 → Annex I §M Point 66 for COI.** The `coi_framework: "eu_ctr_article_14"` enum value pointed at the wrong article. CTR Article 14 is "Addition of a Member State" (extending a trial to additional EU Member States), not COI. Verified via legislation.gov.uk: investigator economic-interest disclosure lives in **Annex I, Section M, Point 66** ("Suitability of the Investigator"). **Breaking change to the structured `coi_framework` field**: `eu_ctr_article_14` → `eu_ctr_annex_i_point_66`. The cover-letter text and dashboard label also updated. Acceptable break — irb_review shipped only hours before this patch; no external consumers expected.
- **HIPAA subsection citations promoted to user-visible output.** v1.5.0 user output cited only "§164.514" without the (b)(1)/(b)(2) sub-precision. Now: "HIPAA §164.514(b)(2) Safe Harbor (18-identifier removal) or §164.514(b)(1) Expert Determination required prior to data sharing outside the covered entity."
- **`marketed_drug=true` + `risk_level: "greater_than_minimal"` silently dropped.** Now warns that expedited cat 1 requires minimal risk; PSUR SAE framework still applies via `marketed_drug`.
- **`computeIcfTier` returned "standard" for benign-behavioural exempt-cat-3 studies.** Pre-fix: only non-interventional designs unlocked "basic" ICF. Post-fix: `isMinimal && (isNonInt || benign_behavioural)` → benign-behavioural exempt cat 3 now correctly produces a basic ICF.
- **Questionnaire-only cat-7 expedited path now emits §46.104(d)(2) second-prong advisory.** Surveys with identifiable responses default to cat 7 expedited, but §46.104(d)(2) has a no-disclosure-risk prong this tool doesn't mechanise. Now warns explicitly so the IRB can apply the second prong manually for non-sensitive surveys.

### Fixed (LOW)

- §46.407 wording: "HHS Secretary panel review" → "HHS Secretary determination after expert-panel consultation and public comment period" (the panel consults; the Secretary determines).

### Tests

+25 new regression tests across:
- 5 v1.5.1 regulatory citation regressions (pregnant §46.204(e), prisoner §46.306(a)(2)(i-iv), pediatric §46.406(c), Annex I in cover letter, HIPAA subsection cites)
- 11 v1.5.1 decision-tree regressions (NIH/other_government COI, academic-only no-COI, foundation-EU no-COI, NIH-EU-only no-COI, interventional rationale text, 3 unknown-risk warnings on non-interventional designs, benign_behavioural mismatch, marketed_drug+greater warning, ICF basic for benign minimal, questionnaire second-prong advisory)
- 7 untested-branch regressions (retrospective+greater+identifiable, registry+minimal+pseudonymized, registry+greater, non_int default cat 4, hint precedence marketed > noninvasive, secondary_data+identifiable, specimen+identifiable)

683 → 708 tests, 100% pass rate, no regressions.

### Process learning

The reviewer-hallucination memory (saved 2026-05-05 after 3 incidents in 48h) saved this patch from introducing fabricated regulatory citations. **All 4 regulatory findings were verified against official sources before applying any patch** — eCFR via govinfo.gov for §46.204, Cornell LII for §46.306 and §46.406, legislation.gov.uk for CTR 536/2014 Article 14 and Annex I. Each verification quote was checked verbatim against the reviewer's claim. The pattern of "spawn 3 reviewers in parallel, fan out by audit angle, verify regulatory claims via WebFetch before patching" is now the default for every release with regulatory output.

## v1.5.0 (2026-05-06) — `irb_review` tool

New IRB / Ethics Committee submission classifier (design log #21). Pure decision-tree logic, <300ms, no external I/O. Tool count 22 → 23.

### Added — `irb_review` (`irb.review`)

Classifies a planned study under 45 CFR 46 (US Common Rule) + EU CTR 536/2014 to produce an IRB submission scaffold. Inputs: study_design (7-enum), data_handling (5-enum), risk_level, funding_source, jurisdictions (us_irb / eu_cec), 4 vulnerable-population yes/no flags, optional pv_classification, optional expedited_category_claim, plus 9 hint flags that disambiguate exempt/expedited categories.

Outputs:
- **US tier:** Exempt §46.104 cat 1-8, expedited §46.110 cat 1-7, full-board §46.108. All 8 + all 7 categories reachable.
- **EU tier:** national-only / ctr_multi_state (with ~60d / ~45d timelines) / non_interventional_only.
- **Vulnerable populations:** Subpart B (pregnant) / C (prisoners) / D (children, with v2 age-tier-table commitment) / decisionally-impaired obligations.
- **Data Management Plan:** GDPR Art. 9 special-category trigger (EU + non-anonymous), HIPAA §164.514 PHI flag (US + identifiable), de-identification method (Safe Harbor / Expert Determination / Pseudonymization / must_implement / not_required), cross-border transfer obligations.
- **SAE reporting:** CTR 536/2014 Annex III (≤7d fatal, ≤15d other), FDA IND Safety (21 CFR 312.32), Post-marketing PSUR. `pv_classification.primary_category="PASS_imposed"` overrides to CTR Annex III regardless of jurisdiction.
- **ICF complexity tier:** `complex` for full-board OR vulnerable, `basic` for minimal-risk + non-interventional + no vulnerable, `standard` otherwise.
- **COI framework:** PHS 42 CFR 50 Subpart F (US) and/or EU CTR Article 14 (EU); fires when `funding_source="industry"`.
- **Cover-letter template:** ready-to-paste 200-300-word block with drug, indication, review tier, COI status, SAE framework, vulnerable-population caveats.
- **`irb_ruleset: "2026-05"`** stamped on every output for cache-bust correctness.

### Sign-off ambiguities resolved (v1)

- **A1 (multi-jurisdiction shape):** US-only → `review_tier_eu: null`; EU-only → `review_tier_us: null`, `expedited_categories_us: []`. Both populated when both jurisdictions present.
- **A2 (expedited_category_claim mismatch):** Surface BOTH the investigator's claim and the tool's analysis in `advisory_warnings` — never silently override.
- **A3 (`risk_level: "unknown"`):** Conservative default — interventional + unknown risk → full-board + warning. Preserves user safety over user convenience.
- **A4 (ICF complexity tier rule):** complex if full-board OR any vulnerable; basic if minimal + non-interventional + no vulnerable; standard otherwise.

### Tests

57 new tests (683 total). Each Common Rule exempt category 1-8 reachable; each expedited category 1-7 reachable; full-board path; Subpart B/C/D layered correctly; GDPR Art. 9 fires only on EU + non-anon; HIPAA §164.514 fires only on US + identifiable; CTR/FDA/PSUR SAE frameworks; PASS_imposed override; cover-letter content + word count; irb_ruleset stamp; <300ms perf; A1/A2/A3/A4 regression coverage.

### v2 deferrals (committed in design log #21)

- UK HRA/REC IRAS pathway, Japan PMDA + ECRIN, Canada TCPS-2.
- Full per-jurisdiction pediatric Subpart D age-tier table (US state-by-state assent ages, EU member-state variations).
- Paired `icf_readability_check` tool — Flesch-Kincaid grading + medical-jargon detection on actual ICF text.
- IRB cover-letter PDF export via existing DOCX formatter.

## v1.4.2 (2026-05-06) — code-review fixes for v1.3.2 / v1.4.0 / v1.4.1

Three releases (v1.3.2 NICE TA precedents + JCA scope eligibility, v1.4.0 hta_workflow orchestrator, v1.4.1 HFrEF per-country comparator depth) shipped to production without independent review. Three parallel code reviews surfaced 10 HIGH and 8 MEDIUM findings of regulatory consequence. The headline "CRITICAL" turned out to be a reviewer hallucination (TA773 → TA849 swap that would have introduced a real fabrication; verified via webfetch against nice.org.uk that TA773 is in fact correct for empagliflozin HFrEF). All real findings addressed.

### Fixed (HIGH)

- **JCA scope-eligibility date typo: "12 January 2025" → "13 January 2025"** in `src/jca/scopeEligibility.ts`. Reg 2021/2282 Article 34 specifies 13 January 2025 as Phase 1 start; the wrong date was printing into refusal markdown that customers paste into dossiers.
- **`is_orphan` + `force_proceed_out_of_scope` now in MCP inputSchema.** Zod schema had the fields but the JSON Schema advertised to MCP clients did not — making the safeguard's recovery path invisible to the LLM. Now discoverable.
- **`extractTaNumber` regex handles "TA 679" (space) format.** Previously matched only "TA679" without space; missed common NICE prose patterns. New `extractAllTaNumbers` companion picks up multiple TA citations in one prose block.
- **`findPrecedents` drug match is now token-set equality, not bidirectional substring.** Bare "valsartan" (ARB) no longer matches "sacubitril valsartan" (ARNI) precedent — eliminates a class of false-positive TA mismatches as the precedents table grows.
- **`hta_workflow` Phase 2 abstract preservation.** `screen_abstracts` JSON output drops the `abstract` field; if those records were piped straight to `risk_of_bias`, RoB inference would silently run on empty abstracts and corrupt GRADE downstream. Phase 2 now extracts the included IDs from the screening output and re-maps them onto the original literature records (which still carry abstracts).
- **`hta_workflow` JCA scope bypass warning.** `hta_body="jca"` runs the standard pipeline without calling `jca_pico_scope`, so the JCA scope eligibility check (Reg 2021/2282 phased rollout) was bypassed silently. Now emits an explicit audit warning so an out-of-scope indication can't produce a credible-looking JCA dossier draft.
- **`hta_workflow` summary-table honesty.** Phase 5 row used to hardcode `"NICE STA draft"` regardless of whether the dossier phase succeeded. Now correctly reads `"FAILED — see audit"` when `dossierRes.ok === false`, eliminating a contradiction between the summary table and the body.
- **HFrEF outcome priorities lead with the composite primary endpoint.** DAPA-HF and EMPEROR-Reduced both used "CV death OR HF hospitalization" as a single co-primary composite — the prior order split the components and ranked all-cause mortality after them, which inverted the logical relationship and implied a hierarchy regulators reject.
- **HFrEF instrument list now includes KCCQ-12.** The Kansas City Cardiomyopathy Questionnaire is the disease-specific HRQoL instrument used in DAPA-HF / EMPEROR-Reduced and required by EUnetHTA Annex II for HFrEF; the prior `instrumentsFor("cardiovascular_hfref")` fell through to EQ-5D-5L only.
- **HFrEF `population_subgroups` includes NYHA class, LVEF stratum, ARNI eligibility, eGFR tier, T2D status.** Was falling through to generic `["age strata", "comorbidity status"]` despite the country-specific comparator universes assuming these subgroups (especially the NL ARNI-eligible split).
- **Bare "heart failure" indication ambiguity warning.** When the user passes "heart failure" without an EF qualifier, `classifyIndication` routes to generic `cardiovascular`. The handler now emits an explicit advisory warning that HFpEF / HFmrEF / HFrEF have materially different comparator universes and prompts re-running with the specific phenotype.

### Fixed (MEDIUM)

- `hta_workflow` `idempotentHint: false` (was `true` — wrong because Phase 4 PSA is stochastic and Phases 1+6 hit live external APIs).
- `hta_workflow` `openWorldHint: true` (was `false` — wrong because `literature_search` calls PubMed/CT/Cochrane/ICER and `validate_links` makes HTTP requests).
- `hta_workflow` `phase_timings_ms.cost_effectiveness_model` no longer set when `skip_ce_model: true` — was a small non-zero value that misled programmatic consumers checking the timing as a "did CE run?" proxy and caused intermittent test flakes.
- Comment fix in `countryRegistry.ts` UK branch: was attributing TA679 to empagliflozin (TA679 is dapagliflozin); now correctly cites TA773 (empagliflozin) and TA679 (dapagliflozin) separately.

### Tests

- 626 MCP tests passing (was 609) — +17 behavioural regression tests covering each fix.

### Process learning

The HFrEF reviewer's "CRITICAL" — claiming TA773 is ivosidenib for AML and that empagliflozin HFrEF is TA849 — was a confident regulatory hallucination. WebFetch against nice.org.uk confirmed: TA773 IS empagliflozin HFrEF (9 March 2022); TA849 is cabozantinib for HCC. Without verifying we would have introduced a real fabrication while "fixing" a false alarm. Memory note saved: always verify subagent regulatory ID claims against the official public database before editing code.

---

## v1.3.1 (2026-05-05) — pv_classify + pv_signal_workflow code-review fixes

Independent code reviews of both PV tools surfaced 1 CRITICAL + 6 HIGH findings of regulatory consequence. All addressed before redeployment.

### `pv_signal_workflow` fixes

- **CRITICAL — Cross-field validation.** Zod `.refine()` rules now reject `case_counts` that produce negative 2×2 cells (`drug_event > event_total`, `drug_event > drug_total`, or `grand_total` too small for the cells). Previously such inputs produced negative PRR/ROR and could fire `refuted_signal` for what is actually garbage input.
- **HIGH — `previously_known_signal` ignored event identity.** New optional `reported_event` input; verdict requires case-insensitive substring match between `reported_event` and one of `prior_known_signals`. A drug with `prior_known_signals: ["lactic acidosis"]` reporting a fresh signal for "myocardial infarction" is now correctly classified as a new signal rather than silently suppressed.
- **HIGH — IC posterior variance was missing 2 of 4 marginal terms** (Norén 2006 simplified form). Truncated formula gave IC025 ≈ 0.06 vs correct ≈ 1.07 for Evans 2001 vector — a 1.0-unit error that flipped IC `threshold_met` for borderline signals and systematically downgraded `confirmed_signal` to `strengthening_signal`.
- **HIGH — Chi-squared was labelled "Yates" but not actually Yates-corrected.** Now applies `(|obs−exp| − 0.5)² / exp` per the label. Misrepresentation of the statistic to regulators eliminated.
- **MEDIUM — Tool description warns callers about MGPS single-stratum confounding** (where it can inflate EBGM/EB05 for sex/age-stratified populations).
- **LOW — Dead `triggers ≥ 3` branch removed** in decideVerdict.

### `pv_classify` fixes

- **HIGH — Fabricated ENCePP IDs replaced.** `ENCePP-PASS-001` style identifiers are not registered ENCePP templates. Field renamed from `encepp_protocol_template` to `encepp_study_category` with plain-language category labels (e.g., "PASS — post-authorisation safety study (imposed, GVP Module VIII). Use the ENCePP Code of Conduct checklist for protocol structure"). Markdown output explicitly notes the value is a category label, not a retrievable template reference.
- **HIGH — ICH E2E rationale honesty.** Pre-authorisation rationale now explicitly states ICH E2E is a standalone ICH guideline, not a GVP module. The Module V reference reflects the downstream RMP that the E2E plan informs at MAA submission, not a direct ICH E2E → GVP V mapping.
- **HIGH — Conditional/accelerated approval Specific Obligations warning.** When `regulatory_context` is `conditional_approval` or `accelerated_approval` AND `imposed_by_authority=false`, output emits an advisory warning prompting confirmation of CMA Article 14-a SOB status. Previously fell through silently to PASS_voluntary.
- **MEDIUM — `rmp_commitment + imposed_by_authority=true` precedence reversed.** Now classifies as `PASS_imposed` primary with `RMP_Annex_4_study` as alternative. Article 107n imposition outranks Annex 4 listing per EMA practice; the prior ordering routed the wrong GVP module + omitted the PRAC pre-review obligation.
- **MEDIUM — `spontaneous_reports + imposed_by_authority=true` warning.** Audit + markdown now flag this as a contradictory input (spontaneous reporting is an inherent obligation, not something an authority can impose as a study); the `imposed_by_authority` flag is no longer silently dropped.
- **MEDIUM — CMS IRA legal claim softened.** Removed the inaccurate claim that "IRA excludes pharmacovigilance cost data from Medicare drug-price negotiation calculations" (no statutory basis). New language: "PV study costs are typically tracked as regulatory obligations separate from HEOR cost-effectiveness modelling and are not standard inputs to the IRA Maximum Fair Price calculation under current CMS guidance."

### Tests
- 577 MCP tests passing (was 558) — +19 behavioural tests covering all the review findings (cross-field validation cases, reported_event matching, full Norén IC variance against Evans 2001 vector, Yates chi² value, CMA SOB warning, ENCePP fabricated-ID guard, IRA-claim wording, rmp_commitment + imposed precedence, spontaneous_reports + imposed warning).

### Why this is a patch release
Pure correctness + transparency fixes. No API breaking changes (the `encepp_protocol_template` field rename is a transparency improvement; the previous IDs were not real ENCePP references, so callers depending on them were depending on a fiction). No new tools.

---

## v1.3.0 (2026-05-05) — pv_signal_workflow tool (EMA GVP Module IX rev 2)

### Added
- **`pv_signal_workflow` tool** — given drug-AE case counts (from EudraVigilance / FAERS / national PV DB / internal spontaneous reports), computes four disproportionality statistics: **PRR** (Evans 2001), **ROR** (van Puijenbroek 2002), **IC** (Bate 1998 / Norén 2006 BCPNN posterior), and **MGPS** (DuMouchel 1999, EBGM with EB05/EB95 via gamma-Poisson shrinkage). Decides a signal verdict (no_signal / strengthening_signal / confirmed_signal / previously_known_signal / refuted_signal) and emits canonical RMP signal-section text. Pairs with `pv_classify` (planned-study classifier).
- **GVP Considerations P.III pregnancy follow-up.** When `pregnancy_exposure: true` AND `rmp_has_pregnancy_concern: true`, output includes structured follow-up timepoints (birth / 3 months / 12 months) per the actual P.III gating logic — not blanket-triggered for any pregnancy exposure.
- **`outcome_serious: true`** lowers PRR/ROR/MGPS thresholds (2.0 → 1.5) per accelerated-review convention for serious / fatal / life-threatening AEs.
- **Multi-method signal corroboration.** Per EMA + Maven 2026 guidance, signals confirmed by ≥2 of 4 methods (with N≥3 + χ²≥4) are classified as `confirmed_signal`. Single-method triggers are `strengthening_signal`. Matching `prior_known_signals` reclassifies as `previously_known_signal` so no spurious new RMP variations.
- **5th NEW landing-page card** "PV Signal Detection" added to the web UI showcase grid (16 examples total).

### Why this release
EMA GVP Module IX rev 2 (effective 2026) makes EVDAS integration mandatory for all EU MAHs from 12 February 2026, ending the EudraVigilance signal-detection pilot. EMA's accompanying message: "AI-powered pharmacovigilance is now expected, not optional." This tool absorbs the disproportionality-statistics + workflow-recommendation step into HEORAgent so PV teams stop maintaining ad-hoc Excel signal sheets.

### Roadmap committed (not in v1.3.0)
- **EVDAS programmatic access (eRMR / ICSR download per Reg. 2025/1466)** — v2; v1 takes user-supplied case counts.
- **Stratified MGPS** (by sex / age band) — v2; v1 uses single-stratum gamma-Poisson shrinkage.
- **`hta_dossier` integration** — pipe active signals into the PV plan section — v3+.

### Tests
- 558 MCP tests passing (was 535) — +23 pv_signal_workflow tests including math against Evans 2001 / Bate 1998 / DuMouchel 1999 published vectors, all 5 verdicts reachable, P.III gating correctness, threshold-tier behaviour, and <300ms performance.

### References
- EMA GVP Module IX rev 2 — Signal management (2026)
- EU Implementing Regulation 2025/1466 — mandatory EVDAS integration
- EMA GVP Considerations P.III — Pregnant and breastfeeding women (effective 2026-02-09)
- Evans SJW et al. 2001 (PRR) · van Puijenbroek 2002 (ROR) · Bate 1998 + Norén 2006 (BCPNN/IC) · DuMouchel 1999 (MGPS/EBGM)

---

## v1.2.2 (2026-05-05) — error telemetry + permissive input validation

### Fixed
- **Analytics instrumentation gap.** Tool-call errors now emit structured `error_class` (Error subclass name — `ZodError`, `TypeError`, etc.) and `error_message` (truncated to 500 chars) properties to PostHog. Before this fix, every error event had `error_class:"(none)"` and `error_message:"(no message)"` because `trackToolCall()` call sites only attached a generic `error` field that the dashboards weren't querying. Future production errors are now diagnosable from telemetry alone. New `classifyToolError()` helper handles Error / TypeError / ZodError / non-Error thrown values uniformly.
- **`evidence.risk_of_bias` 26% error rate fix.** PostHog showed LLM clients frequently sent studies without `title` or `abstract` (both previously required). The tool already returned "Unclear" for any missing reporting signal — strict validation was adding zero methodological rigour and causing 1 in 4 calls to fail. Both fields now default to safe values (`title: "(untitled study)"`, `abstract: ""`). Added an explicit wrapper-shape error: when caller passes a single study object instead of `{studies:[...]}`, the error message hints at the correct shape.
- **`models.cost_effectiveness` 40% error rate fix.** Switched from `.parse()` to `.safeParse()` with a structured field-path error format so LLM clients can self-correct on the next call. Added an explicit hint when caller flattens `efficacy_delta` to the top level instead of placing it inside `clinical_inputs`.

### Tests
- 535 MCP tests passing (was 521) — +14 behavioural tests covering the three fixes (error classifier shape, risk_of_bias permissive input, cost_effectiveness error helpfulness).

### Why this is a patch release
Pure telemetry + UX improvements. No API changes; no breaking changes; no new features.

---

## v1.2.1 (2026-05-04) — jca_pico_scope code-review fixes

### Fixed
- **HIGH — Indication classifier overmatch.** `classifyIndication()` matched any indication string containing the substring `"uc"` — silently routing mucositis, Duchenne muscular dystrophy, and glaucoma indications to IBD-UC biologic comparators (vedolizumab/infliximab/ustekinumab). Now uses a word-boundary regex `(^|\s)uc(\s|$)`. Patient-safety-adjacent in a production JCA tool. 4 new behavioural tests covering the false-positive cases.
- **HIGH — Dead `CountryProfile.outcome_priority` and `.outcome_instrument_preferences` fields.** Set on every profile, never read by `buildScope` (which calls `outcomePriorityForCategory` directly). Future contributors adding country-specific overrides would see no effect. Both fields removed from the type and from every profile literal.
- **MEDIUM — `isOncology` proxy check.** Was checking `outcome_priorities[0] === "OS"` (correct only by coincidence). Now `PicoMatrix` carries `indication_category` explicitly and the surrogate-endpoint warning checks the category directly. Future non-oncology categories with OS-first priorities won't trigger the PFS/ORR warning incorrectly.
- **MEDIUM — NSCLC line-of-therapy gap.** Detailed EGFR-mutant comparators only fire for `line_of_therapy="second_line"`; other lines silently fell through to a generic chemotherapy placeholder. Now emits an audit warning AND a markdown ⚠️ block telling the user to re-run with `second_line` for the well-modeled case.
- **MEDIUM — Heterogeneity threshold transparency.** The ≥3-distinct-comparators rule is a tool-level assumption, not a published EUnetHTA threshold. Now stated explicitly in the tool description so LLMs and reviewers know it's a decision rule, not a diagnosis.
- **MEDIUM — Round-trip integration test strengthened.** Now asserts at least one comparator molecule from `pico_matrix.picos` appears in the `hta_dossier` output, not just the PICO IDs (which the dossier could mention for unrelated reasons).
- **LOW — `flattenComparators` dead export removed.**

### Tests
- 521 MCP tests passing (was 514) — +7 behavioural tests covering all the review fixes.

### Why this is a patch release
All v1.2.0 functionality is unchanged for correct inputs. Fixes only affect (a) edge-case indication strings that were silently misclassified, (b) dead-field traps for future contributors, (c) error/warning surfaces for previously silent failure modes. No API changes; no breaking changes.

---

## v1.2.0 (2026-05-04) — EU JCA PICO matrix analyzer

### Added
- **`jca_pico_scope` tool** — produces the canonical EU Joint Clinical Assessment (JCA) PICO matrix for a drug-indication pair across selected EU jurisdictions. v1 covers DE (G-BA / IQWiG), FR (HAS), IT (AIFA), ES (AEMPS / RedETS), NL (Zorginstituut), and UK (NICE, post-Brexit context). Other 22 EU member states return a "consult national HTA" placeholder. Returns a consolidated PICO list (per Reg. 2021/2282) plus per-country comparator universes, outcome instrument preferences, population subgroup focus, and a heterogeneity warning when ≥3 distinct comparators emerge across jurisdictions. Pipe `pico_matrix.picos` directly into `hta_dossier({hta_body:"jca", picos: ...})`. Pure decision logic, hardcoded country profiles, <300ms response.
- **JCA_REVISION stamp** — output includes `jca_revision: "2026-05"` for auditability. Bumped when EUnetHTA publishes new methodological guidance.
- **Surrogate-endpoint flag** — for oncology indications, output explicitly notes that PFS / ORR / biomarker response are accepted as secondary outcomes only and may face JCA scrutiny per Annex II of Implementing Reg. 2024/1381.
- **Pre-authorisation anticipatory scope** — when called with `regulatory_context: "pre_authorisation"`, output is produced with explicit "anticipatory only, not for actual JCA submission" warning. Useful for protocol-design and pre-MA market access strategy.

### Why now
EU JCA has been in force since 12 January 2025 for oncology / ATMPs. 2026 brings high-risk medical devices into scope; orphan drugs join in 2028; all medicines by 2030. Manufacturers have **100 days** from the consolidated PICO list to dossier submission — and no tool to scope it. This tool absorbs the 3-week consultancy step into a 200ms call.

### Tests
- 514 MCP tests passing (was 491) — +23 jca_pico_scope tests, including a round-trip integration test verifying `pico_matrix.picos` validates against `hta_dossier({hta_body:"jca"})` without errors.

### References
- Regulation (EU) 2021/2282 — HTA Regulation
- EU Implementing Regulation 2024/1381 — JCA procedural rules
- EUnetHTA Coordination Group — Methodological Guidance Series
- National HTA bodies: G-BA / IQWiG, HAS, AIFA, AEMPS / RedETS, Zorginstituut Nederland, NICE

---

## v1.1.1 (2026-05-04) — NICE PMG36 update: severity modifier + health inequalities

### Added
- **NICE severity modifier (PMG36 §4.4)** — `hta_dossier` now accepts `severity_modifier: { absolute_qaly_shortfall, proportional_qaly_shortfall }` and computes the QALY weight (1.0× / 1.2× / 1.7×) per NICE bands. Replaced the end-of-life modifier in April 2022 in opportunity-cost-neutral form. Output names the severity band (No modifier / Moderate / Severe) and renders an effective £/QALY threshold table (£20-30K → £24-36K → £34-51K).
- **NICE health inequalities section (PMG36 May 2025 modular update)** — `hta_dossier` now accepts `health_inequalities: { affected_groups, baseline_disparity_evidence, intervention_impact, mitigation_plan }`. Output explicitly flags interventions that *widen* disparity (⚠️) vs *narrow* (✅) vs *neutral* (⚪). When omitted on a NICE dossier, a one-line gap-flag note tells the reviewer what's missing.

### Why now
NICE published a refreshed PMG36 manual on 31 March 2026 (covering devices/diagnostics/digital alongside medicines per the NHS 10-Year Plan). The May 2025 modular inequalities update is now part of every NICE submission. Both changes were under-reflected in our NICE STA template.

### Tests
- 491 MCP tests passing (was 483) — +4 severity modifier tests + 4 health inequalities tests.

### References
- NICE Health Technology Evaluations: the manual (PMG36, updated 2026-03-31)
- NICE methods modular update — Health Inequalities (May 2025)

---

## v1.1.0 (2026-05-04) — Pharmacovigilance study classification + HTA dossier PV section

### Added
- **`pv_classify` tool** — classifies a planned study into its EMA regulatory category (PASS imposed/voluntary, PAES, RMP Annex 4, DUS, active surveillance registry, pregnancy registry, spontaneous reporting, ICH E2E plan). Returns the matching GVP module (V/VI/VIII/VIII Addendum I), ENCePP protocol template ID, RMP implications, FDA analogue, and submission obligations. Pure decision-tree logic per EMA GVP rev 4, EU Regulation 1235/2010 Article 107a, and ICH E2E. Pregnancy populations override the primary verdict; pre-authorisation contexts never yield PASS. Returns in <200ms.
- **`hta_dossier` PV Plan section** — when `pv_classification` (the structured output of `pv_classify`) is passed to `hta_dossier`, the dossier output includes a Pharmacovigilance Plan section between RoB and CEA listing the GVP module, ENCePP template, submission obligations, and RMP implications. When omitted, a one-line "PV plan not provided" note flags the gap so reviewers see it.
- **CMS IRA flag** — when `pv_classify` is called with `jurisdictions: ["us"]`, the output explicitly notes that CMS IRA price-negotiation calculations exclude PV cost data — track PV obligations in the regulatory budget, not the HEOR cost-effectiveness model.
- **FDA mapping (v1 stub)** — `pv_classify` includes an indicative FDA analogue per category (PMR, PMC, REMS, FAERS, Sentinel) with explicit "v1 stub, full FDA in v2" labelling. EMA remains the primary jurisdictional coverage.

### Tests
- 483 MCP tests passing (was 453) — +26 pv_classify tests covering all 12 PvCategory leaves, hard rules (pre-auth never PASS, pregnancy override), GVP module mapping (every category resolves to exactly one module), output content (CMS IRA flag, FDA stub note), performance (<200ms) — and 4 hta_dossier tests covering the PV section integration.

### References
- EMA Good Pharmacovigilance Practices (GVP) Module VIII — Post-Authorisation Safety Studies (rev 4)
- EMA GVP Module V — Risk Management Systems
- EMA GVP Module VIII Addendum I — Drug Utilisation Studies
- EU Regulation 1235/2010, Article 107a (imposed PASS)
- ICH E2E — Pharmacovigilance Planning
- ENCePP Code of Conduct + study protocol templates
- FDA REMS Guidance for Industry (2019); FDA Sentinel Initiative; 21 CFR 314.81

---

## v1.0.6 (2026-05-04) — MAIC workflow orchestration tool

### Added
- **`workflow.maic` orchestration tool** — runs the canonical MAIC discovery+screening pipeline in one MCP call: ITC feasibility + parallel `literature_search` (broad + per-trial) + PICO `screen_abstracts` + `risk_of_bias` + `evidence_network`. Returns a structured 9-section report with explicit Next Steps. Built because ChatGPT-5.3 cannot reliably chain 5+ tool calls in parallel; this absorbs the orchestration burden so the LLM only formulates the question. Stops short of running MAIC/Bucher itself — those still require IPD or trial-level effect estimates the search cannot supply. Phase failures degrade gracefully (one skipped phase doesn't abort the pipeline).

### Tests
- 453 MCP tests passing (was 442) — +11 maic_workflow tests.

---

## v1.0.5 (2026-05-04) — ChatGPT MAIC workflow recipe

### Added
- **`maic_workflow_recipe` example** — `examples({tool:"maic_workflow_recipe"})` returns a multi-step prompt template ChatGPT users can paste in sequence, plus a recommendation to use the web UI for one-shot depth. Includes trial-name suggestions by indication (UC: QUASAR/INSPIRE/U-ACHIEVE/TRUE NORTH; CD: ADVANCE/MOTIVATE; T2D: SUSTAIN/SURPASS; obesity: STEP/SURMOUNT; HF: PARADIGM/EMPEROR; oncology: KEYNOTE/CHECKMATE; etc.).

### Tests
- 442 MCP tests passing — +4 examples tests for the new recipe.

---

## v1.0.4 (2026-05-02) — Bucher consistency, GRADE upgrading, EQ-5D baseline-utility, ChatGPT support

### Added
- **Bucher consistency check** — `evidence_indirect` now empirically tests Bucher's consistency assumption when direct head-to-head evidence is also in the network. Severity bands per Cochrane Ch. 11.4.3 / NICE DSU TSD 18: |z|<1.5 no conflict, 1.5–1.96 moderate (⚠️), ≥1.96 substantial (🚨), opposite-direction with both significant → substantial. Conflicts are surfaced in the markdown report and the `consistency_check` field on each `IndirectEstimate`.
- **GRADE upgrading (Guyatt 2011)** — observational evidence with strong indicators can be upgraded from Low. Three criteria via the new `upgrading_per_outcome` param on `hta_dossier`: large effect (RR <0.5/>2.0 → +1; <0.2/>5.0 → +2), dose-response gradient (+1), plausible confounding biasing toward null (+1). Capped at +2 steps. Skipped when starting certainty is High (RCTs).
- **EQ-5D 5L baseline-utility-aware impact estimator.** `utility_value_set` now accepts `baseline_utility` (0–1). Biz 2026 reports category-level medians but the magnitude depends strongly on cohort baseline utility — 5L compresses utilities most in the 0.6–0.9 range, so a drug for mild plaque psoriasis (~0.85) sees a much bigger ICER increase than one for severe HS (~0.45). Output explicitly labels the result as an extrapolation beyond Biz 2026.
- **ChatGPT Custom GPT support.** New OpenAPI 3.1 adapter at `/api/openapi` (web tier) lets you build a Custom GPT in ~5 minutes. One POST endpoint per tool at `/api/v1/{tool_name}` — same code path as the Anthropic surface, with ChatGPT-friendly caps (`psa_iterations≤1000`, `runs≤1`, `max_results≤30`) so calls fit the 45s Action timeout. Optional `CHATGPT_ADAPTER_TOKEN` for auth; built-in 60 req/min/IP rate limiter.
- **Surface-tagged analytics.** Every `tool_call` PostHog event now carries a `surface` property derived from `clientInfo.name`: `claude_anthropic_web`, `chatgpt_adapter`, `claude_desktop`, `smithery`, `glama`, `pulsemcp`, or `direct_mcp`. `session_start` events also include `surface` + `client_name` for acquisition reports.

### Fixed (code review)
- `assessInconsistency`: when I² is unknown, return `not_assessable` (was `Moderate` with `downgrade_steps=0`, which silently inflated GRADE certainty).
- `bucher.ts toWorkingScale`: stripped dead `se` parameter that was a correctness trap for log-scale measures.
- `eq5dImpact.ts`: zero-median early return — future indication categories without published medians no longer produce degenerate `{0,0,0}` ranges.
- `mcpSession.ts` drift guard: changed module-load `throw` to a warn + lazy `UnmappedToolError` at call time. A single drift bug no longer crashes the entire web UI cold-start; only the affected tool fails.
- `htaDossierPrep` schema: replaced `z.any()` for `rob_results` / `model_results` / `evidence_summary` with proper Zod schemas.
- Adapter route: rate limit added (60 req/min/IP); `available_tools` 404 list now uses canonical 17-tool list (was 6); `MCP_API_VERSION` constant replaces hardcoded `"1.0.3"`.

### Tests
- 401 MCP tests / 96 web tests = 497 total passing (was 357 at v1.0.2).

### References
Bucher HC et al. J Clin Epidemiol. 1997;50(6):683-691; Cochrane Handbook Ch. 11.4.3; NICE DSU TSD 18; Guyatt GH et al. J Clin Epidemiol. 2011;64(12):1311-1316; Biz, Hernández Alava, Wailoo (2026) Value in Health forthcoming.

---

## v1.0.3 (2026-04-29) — Senior HEOR methodology fixes

### Fixed
- **GRADE inconsistency now uses I² instead of study count.** Single-study comparisons no longer auto-downgraded as "Serious" — they return `not_assessable` (single study cannot be inconsistent with itself, per Cochrane Handbook 10.10). When I² is supplied via the new `heterogeneity_per_outcome` param on `hta_dossier`, GRADE applies Cochrane bands: <50% Low, 50–74% Moderate (1-step downgrade), 75–89% Serious, ≥90% Very Serious (2-step). Rationale cites the actual I² value.
- **GRADE upgrading (Guyatt 2011)** — observational evidence with strong indicators can now be upgraded from Low. Three criteria via the new `upgrading_per_outcome` param: large effect (RR <0.5/>2.0 → +1; <0.2/>5.0 → +2), dose-response gradient (+1), plausible confounding biasing toward null (+1). Capped at +2 steps. Skipped when starting certainty is High (RCTs).
- **EQ-5D 3L→5L impact estimator now baseline-utility-aware.** Biz 2026 reports category-level medians but the magnitude depends on cohort baseline utility — 5L compresses utilities most in the 0.6–0.9 range, so mild plaque psoriasis (baseline ~0.85) sees +77% ICER vs severe HS (baseline ~0.45) at +41%, even though both are `non_cancer_qol_only`. New `baseline_utility` param on `utility_value_set` tool.
- **Bucher consistency check** — when direct head-to-head A-vs-C evidence exists alongside the indirect A-vs-C estimate, the tool now empirically tests Bucher's consistency assumption: z = (direct − indirect) / SE_diff. Severity bands per Cochrane Ch. 11.4.3 / NICE DSU TSD 18: |z|<1.5 no conflict, 1.5–1.96 moderate (⚠️), ≥1.96 substantial (🚨), opposite-direction with both significant → substantial. Conflicts surfaced in markdown output and warnings.

### Added
- New modules: `src/grade/inconsistency.ts`, `src/grade/upgrading.ts`, `src/grade/eq5dImpact.ts`, `src/network/consistency.ts`
- 41 new tests (4 new test files); total 385/385 passing.

### References
Cochrane Handbook for Systematic Reviews of Interventions Ch. 10.10, 11.4.3; GRADE Handbook 5.1; Guyatt GH et al. J Clin Epidemiol. 2011;64(12):1311-1316; Higgins & Thompson Stat Med 2002; Bucher HC et al. J Clin Epidemiol. 1997;50(6):683-691; NICE DSU TSD 18; Biz, Hernández Alava, Wailoo (2026) Value in Health forthcoming.

## v1.0.1 (2026-04-28) — Risk of Bias assessment tool

### Added
- **`risk_of_bias` tool** (17th tool) — Cochrane RoB 2 (RCTs), ROBINS-I (observational), AMSTAR-2 (SRs). Auto-detects instrument from study type, infers domain judgments from abstract text, marks "Unclear" when evidence absent. Output includes per-study RoB table and rob_results object for evidence-based GRADE assessment in `hta_dossier_prep`.
- **htaDossierPrep integration** — `rob_results` parameter now replaces heuristic RoB judgments with structured domain assessments for GRADE tables.

### Source
Implements design log 07 — based on Cochrane RoB 2 (Sterne et al. 2019), ROBINS-I (Sterne et al. 2016), AMSTAR-2 (Shea et al. 2017).

## v0.9.8 (2026-04-22) — ITC methods, evLYG, CMS IRA context

### Added
- **Heterogeneity statistics** in `indirect_comparison` NMA output — I² statistic, Cochran Q, degrees of freedom, p-value, τ², and interpretation band (Cochrane Handbook: 0–40% might not be important / 30–60% moderate / 50–90% substantial / 75–100% considerable).
- **`itc_feasibility` tool** (17th tool) — walks through the 3 ITC assumptions (exchangeability, homogeneity, consistency) and recommends a method (Bucher / NMA / anchored MAIC / unanchored MAIC / ML-NMR required / infeasible). Cites Cope 2014 (BMC Med), NICE DSU TSD 18 (Phillippo), Signorovitch 2023 (J Dermatol Treatment), Cochrane Handbook Ch 11.
- **evLYG (Equal Value Life-Years Gained)** as optional summary metric in `cost_effectiveness_model` — CMS IRA-compatible alternative to QALYs. Controlled via `summary_metric` parameter: `"qaly"` (default), `"evlyg"`, or `"both"`.
- **System prompt** updated with CMS IRA QALY prohibition (§1194(e)(2)) and AHA/ACC 2025 $120K/QALY threshold for cardiovascular interventions.

### Security
- **`.gitignore` hardening** — added defense-in-depth block patterns for common confidential client filename markers.
- **Provider comments sanitised** — removed specific client references from enterprise fetcher comments (pharmapendium, citeline, cochrane, cortellis) and generalised to "institutional/enterprise proxy".
- **Pre-commit hook** installed (`.git/hooks/pre-commit`) that blocks commits containing confidential client name keywords.

## v0.9.7 (2026-04-22) — UK EQ-5D-5L transition

### Added
- **`utility_value_set` tool** (16th tool) — reference data and impact estimator for the new UK EQ-5D-5L value set (NICE consultation 2026-04-15 to 2026-05-13). Three actions:
  - `lookup` — full characteristics of UK 3L, England 5L, UK 5L (new 2026), or DSU mapping
  - `compare` — side-by-side comparison of all four value sets
  - `estimate_impact` — projects ICER/QALY change per Biz, Hernández Alava, Wailoo (2026) *Value in Health* (forthcoming).
- **OHE and EuroQol data sources** (43rd and 44th) — curated pointers to Office of Health Economics publications (ohe.org) and EuroQol Group resources (euroqol.org). Category: `other`. No API key required.
- **`htaDossierPrep` UK 5L transition warning** — when `hta_body="nice"`, dossier draft now appends a "UK EQ-5D-5L Value Set Transition" section flagging consultation dates and Biz et al. 2026 impact estimates by indication type.
- **`cost_effectiveness_model` description** updated with value-set-dependency note pointing to `utility_value_set`.
- **15 new tests** covering the `utility_value_set` tool; 6 for OHE + EuroQol fetchers.

### Source
Implements design log 09 — based on public OHE / EuroQol materials + Biz, Hernández Alava, Wailoo (2026). *Switching from EQ-5D-3L to EQ-5D-5L in England: the impact in NICE technology appraisals.* Value in Health (forthcoming).

## v0.9.6 (2026-04-19)

### Added
- **Wiley Online Library source** (42nd data source) — CrossRef-based free access to Wiley HEOR journals: Pharmacoeconomics, Health Economics, Journal of Medical Economics, Value in Health. ~77% abstract coverage for recent articles (Wiley joined I4OA 2022). No API key required. Source aliases: `pharmacoeconomics`, `health economics`. Included in default source set.

## v0.9.5 (2026-04-16)

### Added
- **`risk_of_bias` tool** (15th tool) — structured risk of bias assessment using auto-detected Cochrane instruments: RoB 2 for RCTs (5 domains), ROBINS-I for observational studies (7 domains), AMSTAR-2 for systematic reviews (16 items). Instrument selected automatically from `study_type`; override with `instrument` param. Returns per-study domain judgments (Low / High / Unclear / Some concerns) plus a GRADE Risk of Bias summary object (`rob_judgment`, `downgrade`, `rationale`, `overall_certainty_start`).
- **`hta_dossier_prep` GRADE integration** — new `rob_results` parameter accepts output from `risk_of_bias`. When provided, the GRADE table uses the structured RoB judgment instead of the previous heuristic estimate. GRADE table note now indicates which source was used. Backward-compatible: falls back to heuristic when `rob_results` is omitted.
- **System prompt pipeline rule** — Claude now calls `risk_of_bias` after `screen_abstracts` and passes `rob_results` to `hta_dossier_prep` automatically in the standard HEOR workflow.
- **29 new tests** covering risk_of_bias (23) and hta_dossier_prep rob_results integration (6). 289 tests total, 72 suites, all passing.

## v0.9.4 (2026-04-16)

### Added
- **Parameter descriptions** audited and filled for all tool schemas — `perspective`, `clinical_inputs`, `cost_inputs`, `utility_inputs` on cost_effectiveness_model; `perspective` on budget_impact_model; `drug_name`, `indication`, `output_format`, nested PICO fields on hta_dossier_prep; `target.intervention`/`target.comparator` on indirect_comparison. Improves Smithery parameter-descriptions score.

## v0.9.3 (2026-04-16)

### Fixed (from code review)
- **BIM market share forward-fill** — missing years now inherit from the most recent DEFINED year before them, not the last-defined-globally (which was inflating early-year budget impacts)
- **BIM xlsx perspective crash** — fixed TypeError when `perspective` was undefined in Excel export
- **XLSX transition matrix** — now derived from actual model params (efficacy_delta, mortality_reduction), no longer hardcoded placeholders
- **XLSX "Mean ICER" label** — renamed to "ICER of means (E[ΔC] / E[ΔQ])" to reflect the formula accurately; added separate "Mean of per-iteration ICERs" for the alternative interpretation
- **HTTP JSON parser** — now returns 400 with clear error instead of crashing on malformed request body
- **HTA template hardcoded outcomes** — "Outcomes (PICO)" section no longer defaults to HbA1c/diabetes regardless of indication
- **Link validator 429/503** — now categorized as "rate_limited" (transient) instead of "broken"

### Changed
- **MAIC/STC descriptions** — marked as EXPERIMENTAL with clear warnings that summary-level data produces approximate results only; true MAIC/STC per NICE DSU TSD 18 requires individual patient data
- **Survival fitting description** — marked as EXPERIMENTAL with warnings that KM-summary fits are approximate; true MLE requires IPD
- **Excel export language** — changed "editable, re-runnable" to honest "structured report — editing cells does not re-run the model"
- **FEATURES.md** — restructured into focused tables (was one mega-table that rendered badly on Glama); added "Production vs Experimental" section

### Added
- **28 new smoke tests** covering budget_impact_model, population_adjusted_comparison, survival_fitting, screen_abstracts, validate_links (72 suites, 272 tests total)

## v0.9.1 (2026-04-16)

### Added
- **MCP tool annotations** on all 14 tools (readOnlyHint, destructiveHint, idempotentHint, openWorldHint, title). Improves Smithery quality score and gives MCP clients clearer intent signals for tool use.

## v0.9.0 (2026-04-16)

### Added
- **Excel (XLSX) export for budget_impact_model** — multi-tab editable workbook (Summary, Inputs, Year-by-Year, Audit) so local market-access teams can localize pricing
- **GVD (Global Value Dossier) template** in hta_dossier_prep — new `hta_body: "gvd"` option with 13 sections (Disease Background, Unmet Need, Clinical Evidence, Comparative Effectiveness, Health Economic Summary, Policy Environment, etc.). Driven by Reddit feedback — GVDs are the upstream cross-market evidence document before country-specific dossiers.
- **MCP prompts capability** — 5 pre-built HEOR workflow prompts (literature-review, cost-effectiveness-analysis, hta-dossier, budget-impact, indirect-comparison) that appear as slash commands in Claude Desktop
- **MCP resources capability** — declares resources capability (empty list for now) to satisfy MCP clients

### Fixed
- Smithery quality score issues: added resources/list and prompts/list handlers (previously returned "Method not found")

## v0.8.0 (2026-04-16)

### Added
- **Excel (XLSX) export for cost_effectiveness_model** — editable multi-tab workbook (Summary, Inputs, Transition Matrix, PSA, CEAC, Audit). Yellow cells mark editable inputs so local market-access teams can localize pricing/prevalence and re-run. Driven by Reddit feedback from an HEOR practitioner.
- Updated server-card.json to reflect all 14 current tools and v0.7.1+ metadata (was stale at v0.1.3)

## v0.7.0 (2026-04-16)

### Added
- **validate_links tool** — HTTP HEAD check for URLs before presenting them to users. Categorizes as working/browser_only/broken/timeout. Web UI system prompt now mandates validation of all citation URLs before they appear in responses.

## v0.6.0 (2026-04-15)

### Added
- **screen_abstracts tool** — PICO-based abstract screening with relevance scoring, study design classification (Cochrane Handbook Ch. 4), and ranked inclusion/exclusion decisions. Turns raw literature_search results into a screened shortlist with PRISMA flow summary.

## v0.5.0 (2026-04-15)

### Added
- **survival_fitting tool** — fit 5 parametric distributions (Exponential, Weibull, Log-logistic, Log-normal, Gompertz) to Kaplan-Meier data. AIC/BIC model selection, extrapolation table, clinical plausibility guidance per NICE DSU TSD 14 (Latimer 2013)
- **EVPPI** (Expected Value of Partial Perfect Information) — per-parameter VOI analysis in PSA output. Shows which specific parameters are worth further research, using non-parametric binning method (Strong et al. 2014)

## v0.4.0 (2026-04-15)

### Added
- **budget_impact_model tool** — ISPOR-compliant budget impact analysis with year-by-year net cost, market share uptake curves, treatment displacement, and population growth (Mauskopf 2007, Sullivan 2014)
- **population_adjusted_comparison tool** — MAIC (Matching-Adjusted Indirect Comparison) and STC (Simulated Treatment Comparison) for population-adjusted indirect comparisons. Follows NICE DSU TSD 18 (Phillippo 2016). Accepts summary-level statistics — no IPD required
- **Scenario analysis** on cost_effectiveness_model — new `scenarios` parameter runs multiple what-if variants in a single call with comparison table output
- **GRADE evidence quality assessment** on hta_dossier_prep — auto-generated GRADE table (Risk of Bias, Inconsistency, Indirectness, Imprecision, Publication Bias) when literature results are provided
- **docs/FEATURES.md** — comprehensive feature reference with Feature Name, What, Why, How for all 11 tools

### Fixed
- **Markov model Dead state** — 3-state model (On-Treatment/Off-Treatment/Dead) replaces 2-state model. Absorbing Dead state prevents infinite QALY/LY accumulation
- **ICER sign handling** — `wtpVerdict` now correctly distinguishes dominant (lower cost + higher QALY) from dominated (higher cost + lower QALY) using delta signs
- **Parallel source fetching** — literature_search uses `Promise.all` instead of sequential loop (major performance improvement with multiple sources)
- **DOMPurify security** — web UI switches from incomplete FORBID_ATTR blocklist to ALLOWED_ATTR allowlist for SVG sanitization
- **MCP server security** — bearer token auth (MCP_AUTH_TOKEN), CORS origin restrictions (MCP_CORS_ORIGINS), session limits (max 100, 30min TTL)
- **EVPI calculation** — uses perspective-appropriate WTP threshold instead of hardcoded $50,000
- **knowledge_write validation** — Zod schema enforces wiki/ prefix and .md suffix at validation layer
- **JSON-RPC ID collisions** — web UI uses incrementing counter instead of Date.now()
- Duplicate `getTimeHorizonYears` function consolidated into modelUtils.ts
- Stale "7 tools" comments updated throughout

## v0.3.0 (2026-04-14)

### Added
- **indirect_comparison tool** — Bucher method (single common comparator) and frequentist NMA (full network) for indirect treatment comparisons. Supports MD, OR, RR, HR. Auto-selects method based on network structure
- **Stability search** — literature_search `runs` parameter (1-5) performs multiple search runs, deduplicates, and ranks by consistency

## v0.2.0 (2026-04-14)

### Added
- **evidence_network tool** — analyzes literature search results to build an evidence network map and assess NMA (network meta-analysis) feasibility. Extracts intervention-comparator pairs, builds treatment comparison graph, identifies evidence gaps
- **PostHog analytics** — anonymous tool call tracking (tool name, duration, status). No user data collected. Opt-in via POSTHOG_API_KEY env var
- **Privacy policy and Terms of Service** — required for ChatGPT app directory submission

### Fixed
- **NICE WTP thresholds** updated from £20-30K to £25-35K/QALY (effective April 2026)
- **CADTH renamed to CDA-AMC** — all references, descriptions, and URLs updated from cadth.ca to cda-amc.ca (renamed May 2024)
- **IQWiG General Methods** updated from v7.0 to v8.0 (2025)
- **ICER VAF** label corrected to "2023-2026"
- **TLV (Sweden)** threshold description updated to severity-tiered system (SEK 250K-1M)
- **PBAC (Australia)** threshold corrected to ~AUD 50K (no formal threshold)
- Version now read from package.json at runtime instead of hardcoded

## v0.1.4 (2026-04-12)

### Added
- **HTTP transport** — server supports both stdio (default) and Streamable HTTP (for hosted deployment and Smithery registry)
- Endpoints: POST/GET/DELETE /mcp, GET /health, GET /.well-known/mcp/server-card.json
- **Smithery listing** — smithery.yaml for MCP marketplace, server-card.json for discovery
- **Railway deployment** — hosted at heor-agent-mcp-production.up.railway.app

## v0.1.2 (2026-04-10)

### Added
- **DOCX save-to-disk** — output_format="docx" now writes Word documents to ~/.heor-agent/reports/ (or project reports/ dir) and returns the file path instead of inlining base64
- **ScienceDirect** as 41st data source (uses ELSEVIER_API_KEY, same as Embase)
- **Source selection table** — every literature_search output includes a transparency table showing all 41 sources with used/not-used and reason

### Changed
- README fully rewritten to reflect current capabilities (41 sources, 7 tools, all HTA bodies)

## v0.1.0 (2026-04-06)

### Added
- **literature_search** — parallel search across 39 data sources with PRISMA-style audit trail
  - Biomedical: PubMed, ClinicalTrials.gov, bioRxiv/medRxiv, ChEMBL
  - Epidemiology: WHO GHO, World Bank, OECD Health, IHME GBD, All of Us
  - FDA: Orange Book, Purple Book
  - HTA appraisals: NICE TAs, CADTH, ICER, PBAC, G-BA, HAS, IQWiG, AIFA, TLV, INESSS
  - HTA cost references: CMS NADAC, PSSRU, NHS Costs, BNF, PBS Schedule
  - Enterprise: Embase, Cochrane, Citeline, Pharmapendium, Cortellis, Google Scholar
  - LATAM: DATASUS, CONITEC, ANVISA, PAHO, IETS, FONASA
  - APAC: HITAP
  - Other: ISPOR
- **cost_effectiveness_model** — Markov / PartSA / decision tree models
  - PSA (Monte Carlo, 1K-10K iterations), OWSA (tornado), CEAC, EVPI
  - NICE reference case (3.5% discount), US payer, societal perspectives
  - WTP assessment against NHS (£25-35K), US ($100-150K), societal thresholds
- **hta_dossier_prep** — draft submissions for NICE STA, EMA, FDA, IQWiG, HAS, EU JCA
  - PICO framework, evidence summary, gap analysis
  - EU JCA support with per-PICO sections (Reg. 2021/2282)
- **project_create** — persistent project workspaces at ~/.heor-agent/projects/
- **knowledge_search / knowledge_read / knowledge_write** — project knowledge base with wiki support
- **Metabolic profile analysis** — auto-extracted from literature search results
- Text, JSON, and DOCX output formats
- Full audit trail (sources queried, inclusions, exclusions, assumptions, warnings)
- Localhost proxy support for enterprise APIs behind corporate VPN
