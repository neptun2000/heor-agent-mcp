/**
 * Drift guard: the MCP-published JSON inputSchemas must expose every
 * field that the handlers accept and that callers need to discover.
 *
 * These tests catch the class of bug where a Zod schema grows a new
 * optional field but the adjacent hand-written JSON inputSchema is not
 * updated — external MCP clients then can't discover the feature.
 */

import { costEffectivenessModelToolSchema } from "../../src/tools/costEffectivenessModel.js";
import { htaDossierPrepToolSchema as htaDossierToolSchema } from "../../src/tools/htaDossierPrep.js";

type Props = Record<string, unknown>;

function props(schema: { inputSchema: { properties: Props } }): Props {
  return schema.inputSchema.properties;
}

describe("costEffectivenessModelToolSchema — MFN fields", () => {
  it("exposes mfn_sensitivity", () => {
    expect(props(costEffectivenessModelToolSchema)).toHaveProperty(
      "mfn_sensitivity",
    );
  });

  it("mfn_sensitivity has min_basket and current_us_price in required", () => {
    const mfn = props(costEffectivenessModelToolSchema).mfn_sensitivity as {
      required: string[];
    };
    expect(mfn.required).toContain("min_basket");
    expect(mfn.required).toContain("current_us_price");
  });
});

describe("htaDossierToolSchema — MFN fields", () => {
  it("exposes mfn_context", () => {
    expect(props(htaDossierToolSchema)).toHaveProperty("mfn_context");
  });

  it("mfn_context describes basket_prices as an object", () => {
    const mfn = props(htaDossierToolSchema).mfn_context as {
      properties: { basket_prices: { type: string } };
    };
    expect(mfn.properties?.basket_prices?.type).toBe("object");
  });

  it("hta_body enum includes gvd", () => {
    const body = props(htaDossierToolSchema).hta_body as { enum: string[] };
    expect(body.enum).toContain("gvd");
  });
});

describe("htaDossierToolSchema — pipe-in fields from other tools", () => {
  it("exposes pv_classification (pipe from pv_classify)", () => {
    expect(props(htaDossierToolSchema)).toHaveProperty("pv_classification");
  });

  it("exposes regulatory_landscape (pipe from regulatory_status_check)", () => {
    expect(props(htaDossierToolSchema)).toHaveProperty("regulatory_landscape");
  });

  it("exposes severity_modifier (NICE PMG36)", () => {
    expect(props(htaDossierToolSchema)).toHaveProperty("severity_modifier");
  });

  it("exposes health_inequalities (NICE PMG36 May 2025)", () => {
    expect(props(htaDossierToolSchema)).toHaveProperty("health_inequalities");
  });

  it("exposes heterogeneity_per_outcome (GRADE inconsistency)", () => {
    expect(props(htaDossierToolSchema)).toHaveProperty(
      "heterogeneity_per_outcome",
    );
  });

  it("exposes upgrading_per_outcome (GRADE upgrading for observational)", () => {
    expect(props(htaDossierToolSchema)).toHaveProperty("upgrading_per_outcome");
  });
});
