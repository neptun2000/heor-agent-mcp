# HEORAgent MCP Server

[![npm version](https://img.shields.io/npm/v/heor-agent-mcp.svg)](https://www.npmjs.com/package/heor-agent-mcp)
[![license](https://img.shields.io/npm/l/heor-agent-mcp.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/heor-agent-mcp.svg)](https://nodejs.org)

**AI-powered Health Economics and Outcomes Research (HEOR) agent as a Model Context Protocol server.**

Automates literature review across 41 data sources, state-of-the-art cost-effectiveness modelling, HTA dossier preparation for NICE / EMA / FDA / IQWiG / HAS / EU JCA, and a persistent project knowledge base — all callable as MCP tools from Claude.ai, Claude Code, and any MCP-compatible host.

Built for pharmaceutical, biotech, CRO, and medical affairs teams who need rigorous, auditable HEOR workflows without building infrastructure from scratch.

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

## Tools

| Tool | Purpose |
|------|---------|
| `literature_search` | Search 41 data sources with a full PRISMA-style audit trail |
| `cost_effectiveness_model` | Markov / PartSA / decision-tree CEA with PSA, OWSA, CEAC, EVPI |
| `hta_dossier_prep` | Draft submissions for NICE, EMA, FDA, IQWiG, HAS, and EU JCA |
| `project_create` | Initialize a persistent project workspace |
| `knowledge_search` | Full-text search across a project's raw/ and wiki/ trees |
| `knowledge_read` | Read any file from a project's knowledge base |
| `knowledge_write` | Write compiled evidence to the project wiki (Obsidian-compatible) |

### `literature_search`

Searches across 41 sources in parallel. Every call returns a **source selection table** showing which of the 41 sources were used and why — essential for HTA audit trails.

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
- **WTP assessment** — verdict against NHS (£20–30K), US payer ($100–150K), societal thresholds

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

### Knowledge base tools

Projects live at `~/.heor-agent/projects/{project-id}/` with:
- `raw/literature/` — auto-populated literature search results
- `raw/models/` — auto-populated model runs
- `raw/dossiers/` — auto-populated dossier drafts
- `reports/` — generated DOCX files
- `wiki/` — manually curated, Obsidian-compatible markdown with `[[wikilinks]]`

Pass `project: "project-id"` to any tool and results are saved automatically.

---

## Data Sources

**41 sources across 9 categories.** Every `literature_search` call includes a source selection table showing used/not-used status and reason for each.

<details>
<summary><b>Biomedical & Clinical Trials (4)</b></summary>

- **PubMed** — 35M+ biomedical citations (NCBI E-utilities)
- **ClinicalTrials.gov** — NIH/NLM trial registry (CT.gov v2 API)
- **bioRxiv / medRxiv** — Life sciences and medical preprints
- **ChEMBL** — Drug bioactivity, mechanisms, ADMET (EMBL-EBI)
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
<summary><b>Other (1)</b></summary>

- **ISPOR** — HEOR methodology and conference abstracts
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

- **Source selection table** — all 41 sources with used/not-used and reason
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

- Chat with Claude Opus 4.6 + all 7 HEOR tools
- **BYOK (Bring Your Own Key)** — paste your Anthropic API key in the settings; it stays in your browser's localStorage and is never stored on our servers
- Markdown rendering with styled tables, tool call cards with live progress timers
- Example prompts for common HEOR workflows

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
npm test          # 244 tests across 66 suites
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
│  │ 7 MCP tools (Zod-validated)          │ │
│  ├──────────────────────────────────────┤ │
│  │ DirectProvider (default)             │ │
│  │   ├─ 41 source fetchers              │ │
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
