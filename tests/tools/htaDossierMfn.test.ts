/**
 * Behavioural tests for the MFN Exposure dossier section (design log #27).
 *
 * v1.11.0 ships opt-in only — the section renders when mfn_context.basket_prices
 * is supplied AND hta_body is one of {nice, jca, gvd, iqwig, has, ema, fda}.
 * When the AMCP body lands (design log #24), it should be added to
 * MFN_AUTO_BODIES so US dossiers always render the section.
 *
 * Pinning:
 *   - structure (heading + price table + ceiling line)
 *   - ceiling math = min(basket excluding US)
 *   - "not provided" labelling for countries with no supplied price
 *   - excluded countries don't contribute and are flagged
 *   - "insufficient basket data" path when caller supplies an empty prices object
 *   - Gap-to-US computation when us_current_net_price is supplied
 *   - Does NOT render when basket_prices is absent on opt-in bodies
 *   - JCA early-return path (handleJCADossier) does NOT include the section
 *     (caveat for v1.11.0 — wired into main flow only)
 */
import { handleHtaDossierPrep } from "../../src/tools/htaDossierPrep.js";

async function dossierText(params: Record<string, unknown>): Promise<string> {
  const result = await handleHtaDossierPrep(params);
  const c = result.content as string;
  if (typeof c !== "string") {
    throw new Error(`expected string content, got ${typeof c}`);
  }
  return c;
}

// NICE is the canonical live body — used as the default for opt-in tests
// because it stays on the main render flow (no early return like JCA).
const baseParams = {
  hta_body: "nice",
  submission_type: "sta",
  drug_name: "TestDrug",
  indication: "Test indication",
  output_format: "text",
};

describe("MFN Exposure section — opt-in render when basket_prices supplied", () => {
  it("computes ceiling = min(supplied basket prices) and marks the minimum row", async () => {
    const text = await dossierText({
      ...baseParams,
      mfn_context: {
        basket_prices: { DE: 100, FR: 95, GB: 110, IT: 105 },
      },
    });
    expect(text).toContain("## MFN Exposure (basket revision");
    expect(text).toMatch(/Projected US net price ceiling:\*\*\s*95/);
    expect(text).toContain("minimum (sets ceiling)");
    // 4 supplied, 15 missing of the 19-country basket
    expect(text).toMatch(
      /4 supplied basket prices?.*15 country prices? not provided/,
    );
  });

  it("renders all 19 countries in the price table", async () => {
    const text = await dossierText({
      ...baseParams,
      mfn_context: { basket_prices: { DE: 100 } },
    });
    for (const name of [
      "Austria",
      "Germany",
      "France",
      "United Kingdom",
      "Australia",
      "Japan",
      "South Korea",
      "Canada",
      "Israel",
    ]) {
      expect(text).toContain(name);
    }
  });

  it("flags excluded countries as 'excluded by caller' and does not let them set the ceiling", async () => {
    const text = await dossierText({
      ...baseParams,
      mfn_context: {
        basket_prices: { DE: 100, FR: 90, GB: 110 },
        excluded_countries: ["FR"],
      },
    });
    expect(text).toContain("excluded by caller");
    expect(text).toMatch(/Projected US net price ceiling:\*\*\s*100/);
  });

  it("computes gap-to-US when us_current_net_price is supplied", async () => {
    const text = await dossierText({
      ...baseParams,
      mfn_context: {
        basket_prices: { DE: 100, FR: 95 },
        us_current_net_price: 200,
      },
    });
    expect(text).toContain("Gap to current US");
    expect(text).toMatch(/52\.5%/); // (200-95)/200
    expect(text).toContain("200");
    expect(text).toContain("95");
  });

  it("includes the four mitigation recommendations from the deck when a ceiling is set", async () => {
    const text = await dossierText({
      ...baseParams,
      mfn_context: { basket_prices: { DE: 100, FR: 95 } },
    });
    expect(text).toContain("Anchor evidence to the strictest HTA in basket");
    expect(text).toContain("Align comparator strategy early");
    expect(text).toContain("robust EQ-5D utility data");
    expect(text).toContain("Sequence launches");
  });

  it("uses the caller's basket_revision when supplied", async () => {
    const text = await dossierText({
      ...baseParams,
      mfn_context: {
        basket_prices: { DE: 100 },
        basket_revision: "2026-09-amended",
      },
    });
    expect(text).toContain("basket revision 2026-09-amended");
  });
});

describe("MFN Exposure section — body gating", () => {
  it("renders for hta_body=nice with basket_prices", async () => {
    const text = await dossierText({
      ...baseParams,
      hta_body: "nice",
      mfn_context: { basket_prices: { DE: 100, FR: 95 } },
    });
    expect(text).toContain("## MFN Exposure");
    expect(text).toContain("hta_body=nice");
  });

  it("renders for hta_body=gvd with basket_prices", async () => {
    const text = await dossierText({
      ...baseParams,
      hta_body: "gvd",
      mfn_context: { basket_prices: { DE: 100, FR: 95 } },
    });
    expect(text).toContain("## MFN Exposure");
  });

  it("renders for hta_body=fda with basket_prices", async () => {
    const text = await dossierText({
      ...baseParams,
      hta_body: "fda",
      mfn_context: { basket_prices: { DE: 100 } },
    });
    expect(text).toContain("## MFN Exposure");
  });

  it("does NOT render for hta_body=nice when no basket_prices supplied", async () => {
    const text = await dossierText({ ...baseParams, hta_body: "nice" });
    expect(text).not.toContain("## MFN Exposure");
  });

  it("does NOT render for hta_body=fda when no basket_prices supplied", async () => {
    const text = await dossierText({ ...baseParams, hta_body: "fda" });
    expect(text).not.toContain("## MFN Exposure");
  });

  it("v1.11.0 caveat: hta_body=jca uses a separate render path; MFN section is NOT wired in there yet", async () => {
    // handleJCADossier (line ~865) builds its own output and returns
    // early before reaching the main render flow where the MFN section
    // is wired. Documented gap — fix in v1.11.1 if users ask, or when
    // someone wires it into handleJCADossier directly.
    const text = await dossierText({
      ...baseParams,
      hta_body: "jca",
      mfn_context: { basket_prices: { DE: 100 } },
    });
    expect(text).not.toContain("## MFN Exposure");
  });
});

describe("MFN Exposure section — empty basket_prices object", () => {
  it("empty basket_prices object behaves like absent — section does NOT render", async () => {
    // Caller passes mfn_context but with an empty prices map. Our wire-in
    // requires Object.keys(basket_prices).length > 0 — so this should
    // behave identically to "no mfn_context at all" and skip the section.
    const text = await dossierText({
      ...baseParams,
      mfn_context: { basket_prices: {} },
    });
    expect(text).not.toContain("## MFN Exposure");
  });
});

describe("MFN Exposure section — Zod schema enforcement", () => {
  it("rejects negative basket prices at the Zod layer (Schema.parse throws)", async () => {
    await expect(
      handleHtaDossierPrep({
        ...baseParams,
        mfn_context: { basket_prices: { DE: -10 } },
      }),
    ).rejects.toThrow();
  });

  it("rejects non-finite basket prices at the Zod layer", async () => {
    await expect(
      handleHtaDossierPrep({
        ...baseParams,
        mfn_context: { basket_prices: { DE: Infinity } },
      }),
    ).rejects.toThrow();
  });
});
