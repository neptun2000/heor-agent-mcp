# HEORAgent MCP Server

An AI-powered Health Economics and Outcomes Research (HEOR) agent for Claude.ai — automates literature review, cost-effectiveness modelling, and HTA dossier preparation.

## Quick Start

Add to your Claude.ai MCP configuration:

```json
{
  "mcpServers": {
    "heor-agent": {
      "command": "npx",
      "args": ["heor-agent-mcp"]
    }
  }
}
```

Or run locally:

```bash
npm install heor-agent-mcp
npx heor-agent-mcp
```

## Tools

### literature_search

Search PubMed, ClinicalTrials.gov, bioRxiv/medRxiv, and ChEMBL simultaneously.
Returns structured results with a full PRISMA-style audit trail.

**Required**: `query` (string)  
**Optional**: `sources` (array), `max_results` (1–100), `date_from` (YYYY-MM-DD), `output_format` (text|json|docx)

**Example prompt**: "Find RCT evidence on semaglutide for type 2 diabetes from the last 3 years"

### cost_effectiveness_model

State-of-the-art cost-utility analysis: multi-state Markov model, probabilistic sensitivity
analysis (PSA, Monte Carlo), one-way sensitivity analysis (tornado diagram), cost-effectiveness
acceptability curve (CEAC), and Expected Value of Perfect Information (EVPI).

Follows ISPOR good practice guidelines and NICE reference case (3.5% discount rate).

**Required**: `intervention`, `comparator`, `indication`, `time_horizon`, `perspective`, `clinical_inputs`, `cost_inputs`  
**Optional**: `model_type` (markov|partsa|decision_tree), `utility_inputs`, `run_psa`, `psa_iterations`, `run_owsa`

**Supported HTA perspectives**:
- `nhs` — NICE threshold £20–30K/QALY
- `us_payer` — ICER threshold $100–150K/QALY
- `societal` — Societal perspective $50–100K/QALY

For oncology: set `model_type="partsa"` to use Partitioned Survival Analysis (NICE TSD 14).

**Example prompt**: "Model cost-effectiveness of semaglutide vs sitagliptin for T2D, NHS perspective, lifetime horizon"

### hta_dossier_prep

Structure evidence into submission-ready HTA dossier sections with gap analysis.
Accepts output from `literature_search` and `cost_effectiveness_model` directly.

**Required**: `hta_body` (nice|ema|fda|iqwig|has), `submission_type` (sta|mta|early_access), `drug_name`, `indication`  
**Optional**: `evidence_summary` (text or JSON from literature_search), `model_results` (from cost_effectiveness_model)

**Supported bodies**: NICE (UK), EMA (EU), FDA (US), IQWiG (Germany), HAS (France)

**Example prompt**: "Prepare a NICE STA outline for semaglutide in type 2 diabetes using [literature search output]"

## Audit Trail

Every tool call returns a full audit record:
- Sources queried, queries sent, response counts
- Inclusion/exclusion counts with reasons
- Methodology notes and assumptions
- Warnings and data quality flags

Suitable for inclusion in HTA submission appendices.

## Data Sources (Phase 1 — DirectProvider)

Currently integrated (free, direct API access):
- **PubMed** — 35M+ biomedical citations (NCBI E-utilities)
- **ClinicalTrials.gov** — FDA-regulated clinical studies (CT.gov v2 API)
- **bioRxiv / medRxiv** — Life sciences and medical preprints
- **ChEMBL** — Drug bioactivity, mechanisms, ADMET (EMBL-EBI)

## Data Sources (Roadmap)

### Phase 2 — Open/Free APIs
- WHO Global Health Observatory — Global epidemiology and health indicators
- World Bank Data — Demographics, macroeconomics
- OECD Health Data — Costs, utilization, health statistics (OECD)
- IHME / Global Burden of Disease — Global disease burden estimates
- ISPOR Presentations Database — HEOR studies and conference posters

### Phase 2 — HTA Guidance & Pricing (Open)
- NICE (UK): Methods Guide, Technology Appraisals, PSSRU Unit Costs, NHS Reference Costs, BNF
- ICER (US): Value Assessment Framework, CMS Data
- CADTH (Canada): Guidelines and Reviews, INESSS
- PBAC (Australia): Guidelines, PSD, PBS/MBS Schedule
- HAS (France): Guidelines, Transparency Committee, CEPS
- IQWiG/G-BA (Germany): Methods Guide, Appraisal Decisions
- AIFA (Italy), AEMPS/IPT (Spain), TLV (Sweden), MHLW (Japan)
- CONITEC/ANVISA (Brazil), IETS (Colombia), FONASA (Chile), HITAP (Thailand)
- HIRA/NHIS (South Korea), WHO GHO, OECD Health, World Bank

### Phase 2 — Restricted (with credentials)
- CPRD (UK primary care), NHS HES (UK hospital episodes), SNDS (France national claims)
- German SHI/AOK/WIdO, Nordic Registries, Japan NDB, NHIRD (Taiwan)
- NHSO (Thailand), PhilHealth (Philippines)

### Phase 3 — Commercial (enterprise tier)
- IQVIA MIDAS/RWD, Optum Clinformatics, Flatiron Health (oncology EHR)
- Premier Healthcare Database, Komodo Health, Oracle Health RWD
- IBM Micromedex Red Book (drug pricing), SSR Health (net pricing/rebates)

## Local RWE Datasets (Phase 2)

Point to local files in `/Users/mnaumov/Projects/Health_Statistics`:
- NAMCS — National Ambulatory Medical Care Survey (US)
- NHAMCS — National Hospital Ambulatory Medical Care Survey (US)
- MEPS — Medical Expenditure Panel Survey (US)
- DATASUS — Brazilian health system data (hospital + epidemiology)

## Tiers

- **DirectProvider** (default) — Free. Uses your Anthropic API key. All tools, text + JSON output.
- **HostedProvider** — Set `HEOR_API_KEY` env var. Phase 2: DOCX/PDF reports, Redis caching.

## Configuration

```bash
HEOR_API_KEY   # Set to enable HostedProvider (Phase 2). Omit for DirectProvider (Phase 1).
```

## Development

```bash
npm install
npm test          # 74 tests
npm run build     # Compiles to dist/
npm run dev       # Run with tsx (no build step)
```

Node.js >= 20 required.

## Disclaimer

All outputs are preliminary and for research orientation only. Results require validation by a
qualified health economist before use in any HTA submission, payer negotiation, or clinical decision.
