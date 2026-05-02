# HEORAgent MCP Server

[![npm version](https://img.shields.io/npm/v/heor-agent-mcp.svg)](https://www.npmjs.com/package/heor-agent-mcp)
[![license](https://img.shields.io/npm/l/heor-agent-mcp.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/heor-agent-mcp.svg)](https://nodejs.org)

**AI-powered Health Economics and Outcomes Research (HEOR) agent as a Model Context Protocol server.**

Automates literature review across 44 data sources, risk of bias assessment (RoB 2 / ROBINS-I / AMSTAR-2), EQ-5D value set impact estimation, state-of-the-art cost-effectiveness modelling, HTA dossier preparation for NICE / EMA / FDA / IQWiG / HAS / EU JCA, and a persistent project knowledge base — all callable as MCP tools from Claude.ai, Claude Code, and any MCP-compatible host.

Built for pharmaceutical, biotech, CRO, and medical affairs teams who need rigorous, auditable HEOR workflows without building infrastructure from scratch.

---

## What's new in v1.0.4

Senior HEOR methodology + ChatGPT support:

- **GRADE inconsistency now uses I²** instead of study count. Single-study comparisons return `not_assessable` (per Cochrane 10.10) instead of being silently auto-downgraded as "Serious". Pass `heterogeneity_per_outcome` to `hta_dossier` and the Cochrane bands (50–74% Moderate, 75–89% Serious, ≥90% Very Serious) are applied directly.
- **GRADE upgrading (Guyatt 2011)** — observational evidence with strong effects can now be upgraded from Low. Three criteria via `upgrading_per_outcome`: large effect (RR <0.5/>2.0 → +1; <0.2/>5.0 → +2), dose-response (+1), plausible confounding biasing toward null (+1). Capped at +2.
- **Bucher consistency check** — when direct head-to-head A-vs-C evidence exists alongside the indirect A-vs-C estimate, `evidence_indirect` automatically tests Bucher's consistency assumption and flags violations (NICE DSU TSD 18). |z|≥1.96 = "substantial — consistency assumption appears violated."
- **EQ-5D 5L impact is baseline-utility-aware.** Biz 2026 reports category-level medians, but the new 5L value set compresses utilities in the 0.6–0.9 range — a drug for mild plaque psoriasis (baseline ~0.85) sees a much bigger ICER increase than one for severe HS (baseline ~0.45), even though both are `non_cancer_qol_only`. Pass `baseline_utility` to `utility_value_set` for a calibrated estimate.
- **ChatGPT Custom GPT support** — new OpenAPI 3.1 adapter at `/api/openapi` lets you build a Custom GPT in 5 minutes. See [ChatGPT Custom GPT](#chatgpt-custom-gpt) below.
- **Surface-tagged analytics** — every `tool_call` PostHog event now carries a `surface` property (`claude_anthropic_web` / `chatgpt_adapter` / `claude_desktop` / `direct_mcp`) so you can break down usage by client.

See [CHANGELOG.md](./CHANGELOG.md) for the full diff.

---

## Quick Start

### Claude Code

```bash
claude mcp add heor-agent -- npx heor-agent-mcp
```

Then restart Claude Code.

### Claude Desktop / claude.ai

Add to your MCP configuration:

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

### Verify

```
> Run a literature search for semaglutide cost-effectiveness in T2D using PubMed and NICE TAs
```

---

## Tools (17)

| Tool | Purpose |
|------|---------|
| `literature_search` | Search 44 data sources with a full PRISMA-style audit trail |
| `screen_abstracts` | PICO-based relevance scoring and study design classification |
| `risk_of_bias` | Cochrane RoB 2 / ROBINS-I / AMSTAR-2 with GRADE RoB domain summary |
| `evidence_network` | Build treatment comparison network and assess NMA feasibility |
| `evidence_indirect` | Bucher and frequentist NMA with **automatic consistency check** vs direct h2h evidence (NICE DSU TSD 18) |
| `population_adjusted_comparison` | MAIC and STC for population-adjusted indirect comparisons |
| `survival_fitting` | Fit 5 parametric distributions to KM data (NICE DSU TSD 14) |
| `itc_feasibility` | Assess the 3-assumption ITC framework and recommend Bucher / NMA / MAIC / STC / ML-NMR |
| `cost_effectiveness_model` | Markov / PartSA / decision-tree CEA with PSA, OWSA, CEAC, EVPI, EVPPI; QALY + evLYG support |
| `budget_impact_model` | ISPOR-compliant BIA with year-by-year output and treatment-displacement modelling |
| `hta_dossier` | Draft submissions for NICE, EMA, FDA, IQWiG, HAS, and EU JCA — GRADE table uses structured RoB when `rob_results` passed; **inconsistency uses I² when `heterogeneity_per_outcome` passed**; **GRADE upgrading (Guyatt 2011) supported via `upgrading_per_outcome`** |
| `utility_value_set` | EQ-5D-3L / 5L value-set reference + **baseline-utility-aware** Biz 2026 ICER impact estimator (UK 5L transition) |
| `validate_links` | HTTP validation of citation URLs before presentation |
| `project_create` | Initialize a persistent project workspace |
| `knowledge_search` | Full-text search across a project's raw/ and wiki/ trees |
| `knowledge_read` | Read any file from a project's knowledge base |
| `knowledge_write` | Write compiled evidence to the project wiki (Obsidian-compatible) |

### `literature_search`

Searches across 44 sources in parallel. Every call returns a **source selection table** showing which of the 44 sources were used and why — essential for HTA audit trails.

**Example call:**
```json
{
  "query": "semaglutide cardiovascular outcomes type 2 diabetes",
  "sources": ["pubmed", "clinicaltrials", "nice_ta", "cadth_reviews", "icer_reports"],
  "max_results": 20,
  "output_format": "text"
}
```

### `cost_effectiveness_model`

Multi-state Markov model (default) or Partitioned Survival Analysis (oncology), following ISPOR good practice and NICE reference case (3.5% discount rate, half-cycle correction). Includes:

- **PSA** — 1,000–10,000 Monte Carlo iterations, probability cost-effective at WTP thresholds
- **OWSA** — one-way sensitivity analysis with tornado summary
- **CEAC** — cost-effectiveness acceptability curve
- **EVPI** — expected value of perfect information
- **WTP assessment** — verdict against NHS (£25–35K/QALY, updated April 2026), US payer ($100–150K), societal thresholds

**Example call:**
```json
{
  "intervention": "Semaglutide 1mg SC weekly",
  "comparator": "Sitagliptin 100mg daily",
  "indication": "Type 2 Diabetes Mellitus",
  "time_horizon": "lifetime",
  "perspective": "nhs",
  "model_type": "markov",
  "clinical_inputs": { "efficacy_delta": 0.5, "mortality_reduction": 0.15 },
  "cost_inputs": { "drug_cost_annual": 3200, "comparator_cost_annual": 480 },
  "utility_inputs": { "qaly_on_treatment": 0.82, "qaly_comparator": 0.76 },
  "run_psa": true,
  "output_format": "docx"
}
```

### `hta_dossier_prep`

Drafts submission-ready sections for six HTA frameworks with gap analysis:

| Body | Country | Submission types |
|------|---------|------------------|
| NICE | UK | STA, MTA, early_access |
| EMA | EU | STA, MTA |
| FDA | US | STA, MTA |
| IQWiG | Germany | STA, MTA |
| HAS | France | STA, MTA |
| JCA | EU (Reg. 2021/2282) | initial, renewal, variation (with PICOs) |

Accepts piped output from `literature_search` and `cost_effectiveness_model`.

### `risk_of_bias`

Assesses risk of bias using the appropriate Cochrane instrument, auto-detected from `study_type`:

| Study type | Instrument |
|-----------|-----------|
| RCT | RoB 2 (5 domains: randomization, deviations, missing data, measurement, reporting) |
| Observational | ROBINS-I (7 domains: confounding, selection, classification, deviations, missing data, measurement, reporting) |
| Systematic review | AMSTAR-2 (16 items, critical vs non-critical) |

Returns a `rob_results` object you can pass directly to `hta_dossier_prep` — this replaces the heuristic RoB estimate in the GRADE table with structured domain judgments.

**Example call:**
```json
{
  "studies": [{ "id": "pmid_1", "study_type": "RCT", "title": "...", "abstract": "..." }],
  "output_format": "json"
}
```

**Pipeline:**
> `literature_search` → `screen_abstracts` → `risk_of_bias` → `hta_dossier_prep`

### Knowledge base tools

Projects live at `~/.heor-agent/projects/{project-id}/` with:
- `raw/literature/` — auto-populated literature search results
- `raw/models/` — auto-populated model runs
- `raw/dossiers/` — auto-populated dossier drafts
- `reports/` — generated DOCX files
- `wiki/` — manually curated, Obsidian-compatible markdown with `[[wikilinks]]`

Pass `project: "project-id"` to any tool and results are saved automatically.

---

## Examples

Copy-paste prompts to try in Claude Code, Claude Desktop, or the [web UI](https://web-michael-ns-projects.vercel.app).

### Single-tool examples

**Literature search**
> Search the literature for tirzepatide cardiovascular outcomes in type 2 diabetes. Use PubMed, ClinicalTrials.gov, and NICE TAs.

**Survival curve fitting**
> Fit survival curves to this OS data from KEYNOTE-189: time 0 survival 1.0, time 6 survival 0.88, time 12 survival 0.72, time 18 survival 0.60, time 24 survival 0.51, time 36 survival 0.38. Use months.

**Budget impact**
> Estimate the 5-year NHS budget impact of semaglutide for obesity. 200,000 eligible patients, drug cost £1,200/year, comparator (orlistat) £250/year, uptake 15% year 1 to 40% year 5.

**Cost-effectiveness model**
> Build a CE model for semaglutide vs sitagliptin in T2D, NHS perspective, lifetime horizon, with PSA.

**Indirect comparison (Bucher)**
> I have two trials: SUSTAIN-1 showed semaglutide vs placebo HR 0.74 (0.58-0.95) for HbA1c, and AWARD-5 showed dulaglutide vs placebo HR 0.78 (0.65-0.93). Run a Bucher indirect comparison between semaglutide and dulaglutide.

**MAIC (population-adjusted comparison)**
> Run a MAIC between SUSTAIN-7 (N=300, semaglutide vs placebo, HR 0.74, CI 0.58-0.95, age 56±10, BMI 33±5) and AWARD-11 (N=600, dulaglutide vs placebo, HR 0.78, CI 0.65-0.93, age 58±9, BMI 35±6). Adjust for age and BMI.

### Multi-tool workflows

**Abstract screening workflow**
> Search PubMed for pembrolizumab in NSCLC, then screen the results with population adults with NSCLC, intervention pembrolizumab, comparator chemotherapy, outcomes overall survival and PFS.

**Evidence network + NMA feasibility**
> Search for GLP-1 receptor agonists in T2D using PubMed, build an evidence network from the results, and assess NMA feasibility.

**CE model with scenarios**
> Build a CE model for dapagliflozin vs placebo in heart failure, NHS perspective, lifetime horizon, with PSA. Add scenarios: "20% price reduction" with drug cost 400, "10-year horizon" with time_horizon 10yr.

### End-to-end HTA workflow

**Full dossier preparation**
> Create a project for semaglutide in obesity targeting NICE and ICER. Search literature for evidence, screen the results for adults with obesity comparing semaglutide to placebo for weight loss outcomes, assess risk of bias on the screened studies, then draft a NICE STA dossier using the screened results and rob_results.

This single prompt exercises: `project_create` → `literature_search` → `screen_abstracts` → `risk_of_bias` → `hta_dossier_prep` (GRADE RoB from structured assessment).

---

## Data Sources

**44 sources across 10 categories.** Every `literature_search` call includes a source selection table showing used/not-used status and reason for each.

<details>
<summary><b>Biomedical & Clinical Trials (5)</b></summary>

- **PubMed** — 35M+ biomedical citations (NCBI E-utilities)
- **ClinicalTrials.gov** — NIH/NLM trial registry (CT.gov v2 API)
- **bioRxiv / medRxiv** — Life sciences and medical preprints
- **ChEMBL** — Drug bioactivity, mechanisms, ADMET (EMBL-EBI)
- **Wiley Online Library** — Pharmacoeconomics, Health Economics, Journal of Medical Economics, Value in Health (CrossRef, ~77% abstract coverage, no key required)
</details>

<details>
<summary><b>Epidemiology & Demographics (5)</b></summary>

- **WHO GHO** — WHO Global Health Observatory
- **World Bank** — Demographics, macroeconomics, health expenditure
- **OECD Health** — OECD health statistics (expenditure, workforce, outcomes)
- **IHME GBD** — Global Burden of Disease (DALYs, prevalence across 204 countries)
- **All of Us** — NIH precision medicine cohort
</details>

<details>
<summary><b>FDA (2)</b></summary>

- **FDA Orange Book** — Drug approvals and therapeutic equivalence
- **FDA Purple Book** — Licensed biologics and biosimilars
</details>

<details>
<summary><b>HTA Appraisals (10) — HTA precedent decisions</b></summary>

- **NICE TAs** (UK) · **CADTH** (Canada) · **ICER** (US) · **PBAC** (Australia)
- **G-BA AMNOG** (Germany) · **IQWiG** (Germany) · **HAS** (France)
- **AIFA** (Italy) · **TLV** (Sweden) · **INESSS** (Quebec, Canada)
</details>

<details>
<summary><b>HTA Cost References (5)</b></summary>

- **CMS NADAC** (US drug acquisition costs)
- **PSSRU** (UK unit costs) · **NHS National Cost Collection** · **BNF** (UK drug pricing)
- **PBS Schedule** (Australia)
</details>

<details>
<summary><b>LATAM (6)</b></summary>

- **DATASUS** · **CONITEC** · **ANVISA** (Brazil)
- **PAHO** (Pan American regional) · **IETS** (Colombia) · **FONASA** (Chile)
</details>

<details>
<summary><b>APAC (1)</b></summary>

- **HITAP** (Thailand)
</details>

<details>
<summary><b>Enterprise (6) — require API key</b></summary>

| Source | Env variable |
|--------|--------------|
| Embase | `ELSEVIER_API_KEY` |
| ScienceDirect | `ELSEVIER_API_KEY` |
| Cochrane Library | `COCHRANE_API_KEY` |
| Citeline | `CITELINE_API_KEY` |
| Pharmapendium | `PHARMAPENDIUM_API_KEY` |
| Cortellis | `CORTELLIS_API_KEY` |
| Google Scholar | `SERPAPI_KEY` |
</details>

<details>
<summary><b>HEOR Methodology & Utility Reference (3)</b></summary>

- **ISPOR** — HEOR methodology and conference abstracts
- **OHE (Office of Health Economics)** — EQ-5D value set research and HEOR methodology
- **EuroQol Group** — EQ-5D instruments, value sets, and registry
</details>

---

## Output Formats

All tools support `output_format`:

- **`text`** (default) — Markdown with formatted tables and headings
- **`json`** — Structured objects for downstream tools
- **`docx`** — Microsoft Word document, saved to disk, path returned in response

DOCX files are saved to `~/.heor-agent/projects/{project}/reports/` (when a project is set) or `~/.heor-agent/reports/` (global). The tool response contains the absolute path — ready to attach to submissions or share with stakeholders.

---

## Audit Trail

Every tool call returns a full audit record:

- **Source selection table** — all 44 sources with used/not-used and reason
- **Sources queried** — queries sent, response counts, status, latency
- **Inclusions / exclusions** — counts with reasons
- **Methodology** — PRISMA-style for literature, ISPOR/NICE for economics
- **Assumptions** — every assumption logged with justification
- **Warnings** — data quality flags, missing API keys, failed sources

Suitable for inclusion in HTA submission appendices.

---

## Configuration

```bash
# Optional — enterprise data sources
ELSEVIER_API_KEY=...        # Embase + ScienceDirect
COCHRANE_API_KEY=...        # Cochrane Library
CITELINE_API_KEY=...        # Citeline
PHARMAPENDIUM_API_KEY=...   # Pharmapendium
CORTELLIS_API_KEY=...       # Cortellis
SERPAPI_KEY=...             # Google Scholar

# Optional — knowledge base location
HEOR_KB_ROOT=~/.heor-agent  # Default

# Optional — localhost proxy for enterprise APIs behind corporate VPN
HEOR_PROXY_URL=http://localhost:8787

# Optional — hosted tier (future)
HEOR_API_KEY=...
```

---

## Web UI

A companion chat interface is available at:

**https://web-michael-ns-projects.vercel.app**

- Chat with Claude Sonnet 4.6 + all 17 HEOR tools
- **BYOK (Bring Your Own Key)** — paste your Anthropic API key in the settings; it stays in your browser's localStorage and is never stored on our servers
- Markdown rendering with styled tables, tool call cards with live progress timers, and theme-aware mermaid network diagrams
- 12 example prompts covering literature search, CEA, BIA, NMA, ITC feasibility, RoB, EQ-5D 5L, EU JCA dossiers
- Per-request MCP sessions (no cross-user session bleed)

The web UI calls the hosted MCP server on Railway for tool execution. No setup required — just add your API key and start querying.

### Self-hosting the web UI

```bash
cd web
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local  # optional server-side fallback
npm run dev -- -p 3456
```

Set `MCP_SERVER_URL` to point to your own MCP server instance (default: the public Railway deployment).

---

## ChatGPT Custom GPT

HEORAgent can also be used as a ChatGPT Custom GPT Action — useful when you (or your team) prefer the ChatGPT interface or have a ChatGPT Plus/Team account but no Anthropic API access.

The web tier exposes an OpenAPI 3.1 adapter at `/api/openapi`, with one POST endpoint per tool at `/api/v1/{tool_name}`. ChatGPT speaks this contract natively.

### What's different from the Anthropic surface

| | Web UI / MCP / Claude Desktop | ChatGPT Custom GPT |
|---|---|---|
| Streaming | yes (SSE) | no (45s single response) |
| `psa_iterations` | up to 10,000 | capped to 1,000 (CEA) / 500 (BIA) |
| `literature_search.runs` | 1–5 | capped to 1 |
| `literature_search.max_results` | up to 100 | capped to 30 |
| Auth model | BYOK Anthropic | optional `X-API-Key` header (server-side `CHATGPT_ADAPTER_TOKEN`) |
| Surface label in PostHog | `claude_anthropic_web` / `claude_desktop` | `chatgpt_adapter` |

The caps exist because ChatGPT Actions hard-fail at the 45-second response timeout. PSA, multi-run literature search, and full max_results would routinely exceed it. The web UI and MCP clients are unaffected.

### Build a Custom GPT (ChatGPT Plus / Team required)

1. Visit [chatgpt.com/gpts/editor](https://chatgpt.com/gpts/editor) and click **Create**.
2. **Configure** tab — fill in name (e.g., "HEORAgent"), description, and conversation starters. Paste the system prompt from `web/lib/claude.ts` (or write your own — the tool descriptions are self-documenting).
3. **Actions** → **Create new action** → **Import from URL** → paste:
   ```
   https://web-michael-ns-projects.vercel.app/api/openapi
   ```
   ChatGPT auto-imports all 17 endpoints with their schemas.
4. **Authentication** — choose **None** for the open public endpoint, or **API Key** with the `CHATGPT_ADAPTER_TOKEN` value if you've configured one (recommended for prod).
5. **Privacy policy URL** — required by GPT Store. Use the web UI's privacy URL or your own.
6. **Test** in the playground (right pane), then **Publish** → "Anyone with the link" or "GPT Store".

### Securing the adapter for production

By default the `/api/v1/*` endpoint is open. Two layers of protection are recommended for any public-facing GPT:

```bash
# 1. Token-gate the endpoint
cd web
vercel env add CHATGPT_ADAPTER_TOKEN production   # generate a long random token
# Configure the same token in your Custom GPT under Authentication → API Key

# 2. Built-in rate limit
# 60 req/min per IP is enforced automatically (lib/rateLimit.ts).
# For multi-region/high-traffic prod, swap in @upstash/ratelimit + Vercel KV.
```

### Sample call (manual, no GPT needed)

```bash
curl -X POST https://web-michael-ns-projects.vercel.app/api/v1/utility_value_set \
  -H "Content-Type: application/json" \
  -d '{
        "action": "estimate_impact",
        "indication_type": "non_cancer_qol_only",
        "baseline_utility": 0.85,
        "base_icer": 30000
      }'
```

Returns the Biz 2026 baseline-utility-adjusted ICER projection (the new EQ-5D 5L impact estimator).

---

## HTTP Transport

The server supports both **stdio** (default, for local MCP clients) and **Streamable HTTP** (for hosted deployment).

```bash
# Stdio mode (default — for Claude Code, Claude Desktop)
npx heor-agent-mcp

# HTTP mode — for hosted deployment, Smithery, web UI backend
npx heor-agent-mcp --http                    # port 8787
MCP_HTTP_PORT=3000 npx heor-agent-mcp        # custom port
```

HTTP endpoints:
- `POST/GET/DELETE /mcp` — MCP Streamable HTTP protocol
- `GET /health` — health check
- `GET /.well-known/mcp/server-card.json` — Smithery discovery

---

## Development

```bash
git clone https://github.com/neptun2000/heor-agent-mcp
cd heor-agent-mcp
npm install
npm test          # 401 tests across 84 suites
npm run build     # Compile TypeScript to dist/
npm run dev       # Run with tsx (no build step)
```

**Requires:** Node.js ≥ 20.

---

## Architecture

```
┌────────────────────────────────────────────┐
│  MCP Host (Claude.ai / Claude Code / etc.) │
└────────────────┬───────────────────────────┘
                 │ stdio
┌────────────────▼──────────────────────────┐
│  heor-agent-mcp server                    │
│  ┌──────────────────────────────────────┐ │
│  │ 17 MCP tools (Zod-validated)         │ │
│  ├──────────────────────────────────────┤ │
│  │ DirectProvider (default)             │ │
│  │   ├─ 44 source fetchers              │ │
│  │   ├─ Audit builder + PRISMA trail    │ │
│  │   ├─ Markov / PartSA economic models │ │
│  │   ├─ Markdown + DOCX formatters      │ │
│  │   └─ Knowledge base (YAML + MD)      │ │
│  └──────────────────────────────────────┘ │
└───────────────────────────────────────────┘
                 │
    ┌────────────┴─────────────┐
    ▼                          ▼
┌────────────┐         ┌──────────────────┐
│ ~/.heor-   │         │ External APIs    │
│ agent/     │         │ (PubMed, NICE,   │
│ projects/  │         │  ICER, CADTH, …) │
└────────────┘         └──────────────────┘
```

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Disclaimer

**All outputs are preliminary and for research orientation only.** Results require validation by a qualified health economist before use in any HTA submission, payer negotiation, regulatory filing, or clinical decision. This tool does not replace professional HEOR expertise.

---

## Distribution

| Channel | How to use | Who pays |
|---------|-----------|----------|
| **npm** | `npx heor-agent-mcp` | User's Claude subscription |
| **Smithery** | [smithery.ai/servers/neptun2000-70zu/heor-agent-mcp](https://smithery.ai/servers/neptun2000-70zu/heor-agent-mcp) | User's Claude subscription |
| **Web UI** | [web-michael-ns-projects.vercel.app](https://web-michael-ns-projects.vercel.app) | User's own Anthropic API key (BYOK) |
| **Hosted MCP** | `https://heor-agent-mcp-production.up.railway.app` | Free (tool execution only) |

---

## Links

- **npm:** https://www.npmjs.com/package/heor-agent-mcp
- **GitHub:** https://github.com/neptun2000/heor-agent-mcp
- **Smithery:** https://smithery.ai/servers/neptun2000-70zu/heor-agent-mcp
- **Web UI:** https://web-michael-ns-projects.vercel.app
- **Issues:** https://github.com/neptun2000/heor-agent-mcp/issues
