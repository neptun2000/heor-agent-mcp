# Changelog

All notable changes to HEORAgent MCP Server.

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
