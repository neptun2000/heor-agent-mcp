# Distribution Checklist

Track where HEORAgent MCP server is published and what status each channel is in. Update this file when publishing a new version or adding a new channel.

**Current version:** 0.7.1 (2026-04-16)

## MCP Directories

| Directory | URL | Status | Last Updated | Notes |
|-----------|-----|--------|--------------|-------|
| **npm** | https://www.npmjs.com/package/heor-agent-mcp | Live v0.7.1 | 2026-04-16 | `npx heor-agent-mcp` |
| **Official MCP Registry** | https://registry.modelcontextprotocol.io | Live v0.7.1 | 2026-04-16 | `io.github.neptun2000/heor-agent` |
| **GitHub** | https://github.com/neptun2000/heor-agent-mcp | Live v0.7.1 | 2026-04-16 | Source repo |
| **Smithery** | https://smithery.ai | Listed | Auto-syncs from npm | smithery.yaml in repo |
| **Glama.ai** | https://glama.ai/mcp/servers | Listed | Auto-syncs from npm | |
| **awesome-mcp-servers** | https://github.com/punkpeye/awesome-mcp-servers | Listed | One-time PR | Under Biology/Medicine/Bioinformatics |
| **PulseMCP** | https://www.pulsemcp.com | Auto-syncing | Within 1 week of registry submission | |
| **MCP.so** | https://mcp.so/submit | Pending | — | Manual form, large Chinese audience |
| **Cline Marketplace** | https://github.com/cline/mcp-marketplace | Pending | — | GitHub PR; VS Code AI users |
| **Continue.dev MCP Hub** | https://github.com/continuedev/continue | Pending | — | GitHub PR; JetBrains/VSCode |
| **Cursor MCP Directory** | Built into Cursor IDE | Pending | — | Submit via Cursor team |
| **Awesome MCP Clients** | https://github.com/punkpeye/awesome-mcp-clients | Pending | — | Has Servers section too |
| **Anthropic Claude Desktop Directory** | https://www.anthropic.com | Pending | — | Official Anthropic listing |

## Hosted Deployments

| Channel | URL | Status | Notes |
|---------|-----|--------|-------|
| **Railway (MCP HTTP)** | https://heor-agent-mcp-production.up.railway.app | Live v0.7.0 | Backend for web UI |
| **Vercel (Web UI)** | https://web-michael-ns-projects.vercel.app | Live | BYOK frontend |

## Marketing / Community Channels

| Channel | URL | Status | Notes |
|---------|-----|--------|-------|
| **Product Hunt** | https://www.producthunt.com | Pending | 30 min setup + thumbnail |
| **Hacker News (Show HN)** | https://news.ycombinator.com | Pending | 5 min post |
| **Reddit r/ClaudeAI** | https://reddit.com/r/ClaudeAI | Pending | Free, targeted |
| **Reddit r/LocalLLaMA** | https://reddit.com/r/LocalLLaMA | Pending | AI dev community |
| **Reddit r/HealthIT** | https://reddit.com/r/HealthIT | Pending | Healthcare IT crowd |
| **LinkedIn** | https://www.linkedin.com | Pending | Best HEOR audience reach |
| **ISPOR Connect** | https://www.ispor.org | Pending | HEOR community forum |
| **Docker Hub** | https://hub.docker.com | Pending | Needs Dockerfile first |

## Submission Workflow When Releasing a New Version

1. **Code changes** — commit, push to GitHub master
2. **Bump version** — `package.json`, `server.json`
3. **npm** — `npm publish` (auto-cascades to Smithery, Glama, PulseMCP)
4. **Official MCP Registry** — `mcp-publisher publish`
5. **Railway** — `railway up --detach -s heor-agent-mcp`
6. **Vercel** (if web UI changed) — `cd web && vercel --yes --prod`
7. **Verify**:
   - `curl https://heor-agent-mcp-production.up.railway.app/health`
   - `npm view heor-agent-mcp version`
   - `curl https://registry.modelcontextprotocol.io/v0.1/servers?search=heor-agent`
8. **Update this file** — bump versions and dates

## Server Config Snippet (for directory submissions)

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

## Standard Description (short, ~100 chars)

```
HEOR MCP server: literature search, CEA, BIA, NMA/MAIC, HTA dossiers (NICE/FDA/EMA/JCA).
```

## Standard Description (long)

```
AI-powered Health Economics and Outcomes Research (HEOR) MCP server.

Features:
- Literature search across 41 data sources (PubMed, ClinicalTrials.gov, NICE, CADTH, ICER, PBAC, G-BA, HAS, IQWiG, +32 more) with PRISMA audit trail
- Abstract screening with PICO-based relevance scoring
- Cost-effectiveness modeling (Markov, PartSA) with PSA, OWSA, CEAC, EVPI, EVPPI, scenario analysis
- Budget impact model (ISPOR-compliant)
- Indirect comparisons: Bucher, Frequentist NMA, MAIC/STC (NICE DSU TSD 18)
- Survival curve fitting (5 distributions, NICE DSU TSD 14)
- HTA dossier preparation for NICE, EMA, FDA, IQWiG, HAS, EU JCA — with auto-GRADE
- Evidence network mapping and NMA feasibility assessment
- Persistent project knowledge base
- Link validation to prevent broken reference URLs
```

## Standard Tags

```
healthcare, heor, health-economics, hta, pharmaceutical, market-access, nice, cadth, icer, clinical-trials, pubmed, mcp, anthropic, claude
```
