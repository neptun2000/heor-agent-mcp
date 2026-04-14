# Privacy Policy — HEORAgent MCP Server

**Last updated:** April 14, 2026

## What data we collect

HEORAgent does **not** collect, store, or transmit any personal data. All tool queries are processed in real-time and not logged.

## Analytics

The hosted MCP server collects anonymous, aggregate usage analytics via PostHog:
- Tool name invoked (e.g., "literature_search")
- Response duration (milliseconds)
- Success/error status

**No query content, user data, search terms, clinical data, or API keys are collected.**

## Third-party services

When you use HEORAgent tools, they may query public APIs on your behalf (PubMed, ClinicalTrials.gov, WHO, NICE, CDA-AMC, ICER, etc.). Your identity is not shared with these services.

## Data storage

- **MCP server (stdio mode):** No data leaves your machine.
- **MCP server (HTTP mode):** Queries are processed in memory and not persisted.
- **Web UI:** Your Anthropic API key is stored in your browser's localStorage only.
- **Project knowledge base:** Files are stored locally at ~/.heor-agent/projects/.

## Contact

For privacy questions: https://github.com/neptun2000/heor-agent-mcp/issues
