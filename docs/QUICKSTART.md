# Quickstart for Colleagues

Get up and running with HEOR Agent in under 10 minutes.

## Step 1 — Get an Anthropic API key (5 min)

HEOR Agent calls the Claude API on your behalf. You need your own API key (we never see or store it).

1. Go to **https://console.anthropic.com**
2. Sign up with your work email (or Google login)
3. Add a payment method at [Settings → Billing](https://console.anthropic.com/settings/billing)
4. Click **API Keys** in the left sidebar → **Create Key**
5. Name it something like "HEOR Agent" and click **Create**
6. **Copy the key immediately** — it's shown only once (looks like `sk-ant-...`)

> **Cost:** Pay-as-you-go. Typical HEOR session (literature search + dossier draft) costs **$0.20–$1.00** depending on length. Anthropic gives **$5 free credit** when you sign up — first few sessions are free.

## Step 2 — Pick how to use HEOR Agent

### Easiest: Web UI (no install)

1. Go to **https://web-michael-ns-projects.vercel.app**
2. Click **Add Key** in the top banner
3. Paste your `sk-ant-...` key → Save
4. Start asking questions

Your key stays in your browser's local storage — never sent to our server.

### For developers: Claude Code (one command)

If you have Claude Code installed:

```bash
claude mcp add heor-agent -- npx heor-agent-mcp
```

Then restart Claude Code. The 17 HEOR tools become available in any conversation.

### For Claude Desktop users (manual config)

Edit your config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add this:

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

Restart Claude Desktop. The HEOR tools appear in your tools list.

### For ChatGPT Plus / Team users (Custom GPT, no Anthropic key needed)

If you prefer ChatGPT (or have ChatGPT Plus but no Anthropic API access):

1. Go to **[chatgpt.com/gpts/editor](https://chatgpt.com/gpts/editor)** → click **Create**
2. **Configure** tab — give it a name (e.g., "HEORAgent") and a short description
3. **Actions** → **Create new action** → **Import from URL** → paste:
   ```
   https://web-michael-ns-projects.vercel.app/api/openapi
   ```
   ChatGPT auto-imports all 17 HEOR tools.
4. **Authentication** → **None** (public test) or **API Key** if a token is configured
5. Test in the playground, then **Publish**

Note: ChatGPT mode caps `psa_iterations` at 1,000 and `literature_search.runs` at 1 to fit the 45s ChatGPT Action timeout. Use the web UI or Claude clients for full PSA / multi-run searches.

## Step 3 — Try a few prompts

Copy-paste any of these into the chat:

**Quick literature search**
> Search the literature for tirzepatide cardiovascular outcomes in type 2 diabetes. Use PubMed, ClinicalTrials.gov, and NICE TAs.

**Build a cost-effectiveness model**
> Build a CE model for semaglutide vs sitagliptin in T2D, NHS perspective, lifetime horizon, with PSA.

**Estimate budget impact**
> Estimate the 5-year NHS budget impact of semaglutide for obesity. 200,000 eligible patients, drug cost £1,200/year, comparator (orlistat) £250/year, uptake 15% year 1 to 40% year 5.

**End-to-end HTA workflow**
> Create a project for semaglutide in obesity targeting NICE and ICER. Search literature for evidence, screen results for adults with obesity comparing semaglutide to placebo for weight loss outcomes, then draft a NICE STA dossier.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Invalid API key" | Double-check the key starts with `sk-ant-` and has no extra spaces |
| "Insufficient credits" | Add credit at https://console.anthropic.com/settings/billing |
| Tools not showing in Claude Desktop | Restart the app after editing the config file |
| Web UI shows "Connection error" | Try again — the server may be processing a long request |

## Get help

- **Issues:** https://github.com/neptun2000/heor-agent-mcp/issues
- **Full features list:** https://github.com/neptun2000/heor-agent-mcp/blob/master/docs/FEATURES.md
- **Source code:** https://github.com/neptun2000/heor-agent-mcp
