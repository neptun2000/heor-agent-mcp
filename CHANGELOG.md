# Changelog

All notable changes to HEORAgent MCP Server.

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
