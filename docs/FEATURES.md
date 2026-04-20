# HEORAgent MCP Server — Features

15 tools, 42 data sources, complete HEOR workflow automation.

## Core Workflow Tools

| Tool | What it does | Why it matters |
|------|-------------|----------------|
| `literature_search` | Search 42 sources with PRISMA audit trail | Weeks of manual literature review compressed to minutes |
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
| Bucher indirect comparison | Bucher 1997 |
| Frequentist NMA | Rücker 2012 (weighted least squares) |
| MAIC/STC | Phillippo 2016, NICE DSU TSD 18 |
| Survival fitting | Latimer 2013, NICE DSU TSD 14 |
| Budget impact | Mauskopf 2007, Sullivan 2014, ISPOR |
| GRADE | Guyatt et al. 2008, GRADE Handbook |
| RoB 2 | Sterne et al. 2019 (BMJ) |
| ROBINS-I | Sterne et al. 2016 (BMJ) |
| AMSTAR-2 | Shea et al. 2017 (BMJ) |

## Data Sources (42)

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

## Output Formats

| Format | Use case |
|--------|----------|
| `text` | Markdown report (default) — for chat UIs and quick review |
| `json` | Structured output — for piping between tools and programmatic use |
| `docx` | Word document — for HTA submissions and reports |
| `xlsx` | Excel workbook — for local market-access teams to review CE models and BIAs (report-style, not interactive) |

## Status: What's Production-Ready vs Experimental

**Production-ready:**
- Literature search (42 sources)
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
