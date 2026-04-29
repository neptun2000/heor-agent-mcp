# Changelog

All notable changes to HEORAgent MCP Server.

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
