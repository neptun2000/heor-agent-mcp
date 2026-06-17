# HEORAgent MCP Server — Features

44 tools, 44 data sources, complete HEOR workflow automation.

## Core Workflow Tools

| Tool | What it does | Why it matters |
|------|-------------|----------------|
| `literature_search` | Search 44 sources with PRISMA audit trail | Weeks of manual literature review compressed to minutes |
| `screen_abstracts` | PICO-based relevance scoring + study design classification | Filters noise from search results per Cochrane Handbook Ch. 4 |
| `risk_of_bias` | Cochrane RoB 2 (RCTs), ROBINS-I (observational), AMSTAR-2 (SRs) with GRADE summary | Replaces heuristic RoB estimates in dossier GRADE tables with structured domain judgments |
| `evidence_network` | Build treatment comparison network, assess NMA feasibility | Essential prerequisite for indirect comparisons |
| `indirect_comparison` | Bucher method + Frequentist NMA | Compare treatments when no head-to-head trials exist |
| `population_adjusted_comparison` | MAIC/STC (experimental, summary-level) | Adjusts for population differences per NICE DSU TSD 18 |
| `survival_fitting` | Fit 5 parametric distributions to KM data | Select best distribution for oncology PartSA models |
| `cost_effectiveness_model` | Markov/PartSA with PSA, OWSA, CEAC, EVPI, EVPPI | ICER per QALY — the universal HTA metric |
| `budget_impact_model` | ISPOR-compliant BIA with year-by-year output | Every HTA submission requires BIA alongside CEA |
| `hta_dossier_prep` | NICE, EMA, FDA, IQWiG, HAS, EU JCA, GVD with auto-GRADE | Body-specific templates save weeks of manual formatting |
| `validate_links` | HTTP validation of citation URLs | Prevents broken references in reports |

## Study Design & Real-World Evidence

| Tool | What it does | Why it matters |
|------|-------------|----------------|
| `rwe.method_select` | Recommends an RWE study design (retrospective database analysis, survey, literature review, chart review, social-media listening) for a research objective, scored on data availability, decision context, and required rigour | Picks the right real-world-evidence method *and* routes you to the tool that runs it; flags when no feasible design meets submission-grade rigour and suggests triangulation |
| `pv.classify` | Classifies a planned study into its EMA pharmacovigilance regulatory category (PASS/PAES/DUS/registry…) | Maps a design to its GVP module + submission obligations before protocol work |
| `pv.signal_workflow` | Disproportionality stats (PRR, ROR, IC/BCPNN, MGPS-EBGM) + signal verdict per EMA GVP Module IX | Turns FAERS/EudraVigilance case counts into a defensible signal assessment |
| `pv.comparative_safety` | Class-level comparative safety profile — ranks top-N AEs per product by reporting rate per 1,000 exposed, side-by-side, with optional disproportionality | The multi-drug × multi-AE FAERS class view (e.g. anti-CGRP class); calls out events of interest like "cardiovascular not in any product's top 10" |
| `evidence.triangulation` | Per-outcome RCT-vs-RWE concordance — agree/disagree + larger/smaller real-world effect (efficacy–effectiveness gap) | Builds the "literature review of RCTs and RWE, key message per outcome" section and pressure-tests whether RWE corroborates trial efficacy |
| `rwe.social_listening_protocol` | Generates a social-listening study protocol + compliance checklist (search strategy, GDPR/HIPAA gating, mandatory GVP Module VI AE handling, limitations) | The planning half of the lowest-validity RWE method; no scraping/ToS risk — design + governance only |
| `pv.social_listening_triage` | GVP Module VI four-element ICSR reportability triage of already-collected social posts + sentiment/theme/AE tallies | The execution half; turns raw social posts into a PV-compliant, validity-flagged input without scraping or NLP in-tool |

## Cross-Deliverable Traceability

| Tool | What it does | Why it matters |
|------|-------------|----------------|
| `evidence.claim_registry` | Author an evidence claim once (ICER, effect estimate, prevalence) and reference it by ID; persisted in the project knowledge base | Single source of truth shared across dossiers, publications, and payer materials |
| `evidence.consistency_check` | Scans deliverables for registered claims and flags drift (a different value next to the claim keyword) or absence | Catches the stale-ICER-in-the-slide class of error before release; claim × deliverable matrix |
| `publication.draft` | Drafts an abstract/manuscript/poster/plain-language summary that reuses registry claims; auto-selects CONSORT/STROBE/PRISMA/CHEERS + GPP2022/ICMJE checklist | Fills the publications gap and keeps published figures identical to the dossier |

## Living-Evidence Orchestration

| Tool | What it does | Why it matters |
|------|-------------|----------------|
| `evidence.gap_analysis` | Integrated Evidence Generation Plan (iEGP): assess domain coverage → prioritised, severity-ranked plan mapping each gap to a generation activity, tool, and unblocked deliverable | Decides what evidence to generate next; readiness score per decision context |
| `workflow.living_evidence` | Orchestrates the SLR → living knowledge base → JCA/HTA deliverables pipeline; emits the ordered runbook for a baseline build or a signal-gated living refresh | The "from review to reimbursement" flow as one runbook; unchanged refreshes become near no-ops |

## Project Knowledge Base

| Tool | What it does |
|------|-------------|
| `project_create` | Initialize persistent workspace at `~/.heor-agent/projects/` |
| `knowledge_search` | Full-text search across project `raw/` and `wiki/` |
| `knowledge_read` | Read any file from project knowledge base |
| `knowledge_write` | Write to `wiki/` (Obsidian-compatible, supports wikilinks) |

## Methods & Standards

| Method | Reference |
|--------|-----------|
| Multi-state Markov | NICE reference case, half-cycle correction, 3.5% discounting |
| Partitioned Survival | Woods 2017 |
| PSA | Monte Carlo, 1K–10K iterations |
| EVPPI | Strong et al. 2014 (non-parametric binning) |
| Bucher indirect comparison + **consistency check** | Bucher 1997; NICE DSU TSD 18; Cochrane Ch. 11.4.3 |
| Frequentist NMA | Rücker 2012 (weighted least squares) |
| Heterogeneity (I², Cochran Q, τ²) | Higgins & Thompson 2002, Cochrane 10.10 |
| MAIC/STC | Phillippo 2016, NICE DSU TSD 18 |
| Survival fitting | Latimer 2013, NICE DSU TSD 14 |
| Budget impact | Mauskopf 2007, Sullivan 2014, ISPOR |
| **GRADE inconsistency from I²** | Cochrane bands: <50% Low, 50–74% Moderate, 75–89% Serious, ≥90% Very Serious |
| **GRADE upgrading** (large effect / dose-response / confounding-toward-null) | Guyatt 2011 (J Clin Epidemiol) |
| GRADE | Guyatt et al. 2008, GRADE Handbook |
| RoB 2 | Sterne et al. 2019 (BMJ) |
| ROBINS-I | Sterne et al. 2016 (BMJ) |
| AMSTAR-2 | Shea et al. 2017 (BMJ) |
| **EQ-5D 5L baseline-utility-adjusted ICER impact** | Biz, Hernández Alava, Wailoo 2026 (Value in Health forthcoming) |
| ITC feasibility (3-assumption framework) | Cope 2014, NICE DSU TSD 18, Signorovitch 2023 |

## Data Sources (44)

| Category | Sources |
|----------|---------|
| Biomedical | PubMed, ClinicalTrials.gov, bioRxiv/medRxiv, ChEMBL, Wiley Online Library (Pharmacoeconomics, Health Economics, JME, Value in Health) |
| Epidemiology | WHO GHO, World Bank, OECD Health, IHME GBD, All of Us |
| FDA Regulatory | Orange Book, Purple Book |
| Enterprise (API key) | Embase, ScienceDirect, Cochrane, Citeline, Pharmapendium, Cortellis, Google Scholar |
| Cost References | CMS NADAC, PSSRU, NHS National Cost Collection, BNF, PBS Schedule |
| HTA Appraisals | NICE TAs, CADTH/CDA-AMC, ICER, PBAC, G-BA AMNOG, HAS, IQWiG, AIFA, TLV, INESSS, ISPOR |
| LATAM | DATASUS, CONITEC, ANVISA, PAHO, IETS, FONASA |
| APAC | HITAP |
| HEOR Methodology & Utilities | ISPOR, OHE (Office of Health Economics), EuroQol Group |

## Output Formats

| Format | Use case |
|--------|----------|
| `text` | Markdown report (default) — for chat UIs and quick review |
| `json` | Structured output — for piping between tools and programmatic use |
| `docx` | Word document — for HTA submissions and reports |
| `xlsx` | Excel workbook — for local market-access teams to review CE models and BIAs (report-style, not interactive) |

## Status: What's Production-Ready vs Experimental

**Production-ready:**
- Literature search (44 sources)
- Project knowledge base
- HTA dossier prep (templates + auto-GRADE from literature)
- Budget impact model
- Cost-effectiveness model (Markov + PartSA with PSA, OWSA, CEAC, EVPI)
- Evidence network mapping
- Bucher indirect comparison
- Abstract screening (PICO-based)
- Risk of bias assessment (RoB 2 / ROBINS-I / AMSTAR-2 with GRADE integration)
- Link validation

**Experimental / orientation-only:**
- `population_adjusted_comparison` (MAIC/STC) — summary-level approximation, not IPD-based. Not submission-ready.
- `survival_fitting` — fits to KM step-summary data, not individual patient time-to-event data. Validate against IPD fits.
- `EVPPI` — uses non-parametric binning; results can be noisy when total EVPI is near zero.

See [CHANGELOG.md](../CHANGELOG.md) for version history.
