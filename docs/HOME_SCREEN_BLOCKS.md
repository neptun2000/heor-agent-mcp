# Home-Screen Blocks — Living Evidence Intelligence

Implementation spec for the web UI (`medvera`) home screen. One codebase,
**env-gated** for the external (public, Vercel/BYOK) and internal (Azure, Teva)
releases. Drop-in once `medvera` is in scope.

> This doc lives in `heor-agent-mcp` only as the source of the work. The
> components themselves belong in the `medvera` web tier.

## Guardrails (read first)

1. **No proprietary data.** All blocks describe *generic capabilities* of the
   server (44 tools). No Teva product names (Ajovy/fremanezumab), no Teva trial
   figures, no client/CRO names (incl. NousStarX), no verbatim third-party
   slides. The "Living Evidence Intelligence" diagram is rebuilt as a generic
   concept, not a reproduction of any client slide.
2. **External vs internal is one env flag.** Reuse the existing pattern:
   `NEXT_PUBLIC_HEOR_ENABLE_INTERNAL_CLAIMS === "true"` → internal (Azure)
   build. Internal-only content (claims / RWD analytics, `data.claims_query`,
   `data.query_agent`) renders **only** when the flag is on; everything else is
   identical on both. Mirrors the server gate (`HEOR_ENABLE_INTERNAL_CLAIMS`).
3. **Tool count:** bump any "N tools" copy to **44**.

```ts
// lib/release.ts
export const IS_INTERNAL =
  process.env.NEXT_PUBLIC_HEOR_ENABLE_INTERNAL_CLAIMS === "true";
export const RELEASE_LABEL = IS_INTERNAL ? "Internal (Azure)" : "Public";
```

## Block 1 — Hero: "Living Evidence Intelligence — From Review to Reimbursement"

Full-width hero with the generic three-stage architecture diagram.

- **Headline:** "Living Evidence Intelligence — from review to reimbursement"
- **Sub:** "AI-augmented evidence generation: cheaper · faster · higher quality · automatically refreshed."
- **Diagram (3 columns → center → right):**
  - **AI-Augmented SLR:** Epidemiology · Disease burden · Clinical outcomes · Economic · Adherence
  - **Living Knowledge Base (center):** PICO simulation · AI-assisted economic modeling · ITC/NMA — *one living source of truth that feeds every downstream deliverable*
  - **JCA & HTA deliverables:** Living GVD · JCA submission · HTA submissions · iEGP

```tsx
// components/home/HeroLivingEvidence.tsx
export function HeroLivingEvidence() {
  return (
    <section className="hero">
      <h1>Living Evidence Intelligence — from review to reimbursement</h1>
      <p>AI-augmented evidence generation: cheaper · faster · higher quality · automatically refreshed.</p>
      <PipelineDiagram
        left={["Epidemiology", "Disease burden", "Clinical outcomes", "Economic", "Adherence"]}
        center={["PICO simulation", "AI-assisted economic modeling", "ITC / NMA"]}
        centerCaption="One living source of truth — feeds every downstream deliverable"
        right={["Living GVD", "JCA submission", "HTA submissions", "iEGP"]}
      />
    </section>
  );
}
```

## Block 2 — "One source of truth" (cross-deliverable traceability)

Explains the claim layer + iEGP. Value props as a strip.

- **Title:** "One living source of truth"
- **Body:** "Author each figure once — an ICER, an effect estimate, a prevalence — and reference it across every dossier, publication, and payer document. Drift is detected automatically before release."
- **Chips:** `evidence.claim_registry` · `evidence.consistency_check` · `evidence.gap_analysis (iEGP)`
- **Value strip:** Cheaper · Faster · Higher quality · Automatic refresh

## Block 3 — New capability cards (grid)

Six cards. All external-safe (generic).

| Card | One-liner | Tool(s) |
|------|-----------|---------|
| RWE method selection | Pick the right real-world-evidence design for the question | `rwe.method_select` |
| Comparative class safety | Rank adverse events across a drug class from FAERS-style data | `pv.comparative_safety` |
| RCT ↔ RWE triangulation | Per-outcome concordance of trials vs real-world evidence | `evidence.triangulation` |
| Governed social listening | Protocol + GVP Module VI AE triage (no scraping) | `rwe.social_listening_protocol`, `pv.social_listening_triage` |
| Evidence generation plan | Gap analysis → prioritised iEGP | `evidence.gap_analysis` |
| Living-evidence pipeline | SLR → living KB → JCA/HTA, with auto-refresh | `workflow.living_evidence` |

```tsx
// components/home/CapabilityGrid.tsx — map over the table above into <Card/>s
```

## Block 4 — Tool catalog (updated to 44)

Update the existing catalog/count component. Add the 10 new tools to the list;
the **internal-only** entries are gated:

```tsx
const TOOLS = [
  ...PUBLIC_TOOLS, // includes the 10 new generic tools
  ...(IS_INTERNAL ? INTERNAL_TOOLS : []), // data.claims_query, data.query_agent
];
// header: `${TOOLS.length} tools` → 44 public / 46 internal
```

## Block 5 — Internal-only: RWD / claims analytics (Azure release)

Renders **only when `IS_INTERNAL`**. Describes the internal claims/RWD
capability — still no specific proprietary datasets named, just the capability.

```tsx
{IS_INTERNAL && (
  <InternalRwdBlock
    title="Real-world data & claims analytics"
    body="Query governed claims and hospital-discharge datasets for treatment patterns, effectiveness, and cost — fully audit-trailed."
    tools={["data.claims_query", "data.query_agent"]}
  />
)}
```

## Block 6 — Trust & governance strip

Likely partly present already; ensure it lists: audit trail on every output ·
GRADE · ISPOR ELEVATE-GenAI AI-disclosure · EU AI Pact signatory. Generic, both
releases.

## Build / verify checklist

- [ ] External build (`NEXT_PUBLIC_HEOR_ENABLE_INTERNAL_CLAIMS` unset): Blocks 1–4, 6 render; Block 5 and internal tools absent; count = 44.
- [ ] Internal build (flag = `true`): Block 5 + internal tools render; count reflects internal set.
- [ ] No Teva/client branding, product names, or trial data anywhere in the rendered output.
- [ ] Lighthouse/responsive pass on the new hero diagram.
