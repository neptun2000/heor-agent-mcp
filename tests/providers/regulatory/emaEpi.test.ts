/**
 * Tests for EMA EPI FHIR client.
 *
 * EMA EPI API returns FHIR Bundles. This tests the FHIR adapter logic.
 * All network calls mocked.
 */

import {
  parseFhirBundle,
  fetchEmaEpiLabel,
} from "../../../src/providers/regulatory/emaEpi.js";

// ── FHIR Bundle fixtures ───────────────────────────────────────────────────

// A minimal FHIR Bundle with a Composition resource for fremanezumab
const FHIR_BUNDLE_FIXTURE = {
  resourceType: "Bundle",
  id: "test-bundle-001",
  type: "searchset",
  total: 1,
  entry: [
    {
      resource: {
        resourceType: "Composition",
        id: "comp-001",
        status: "final",
        title: "AJOVY SmPC",
        section: [
          {
            title: "4.1 Therapeutic indications",
            text: {
              status: "generated",
              div: "<div>AJOVY is indicated for the preventive treatment of migraine in adults who have at least 4 migraine days per month.</div>",
            },
          },
          {
            title: "4.3 Contraindications",
            text: {
              status: "generated",
              div: "<div>Hypersensitivity to the active substance or to any of the excipients.</div>",
            },
          },
        ],
      },
    },
  ],
};

const FHIR_EMPTY_BUNDLE = {
  resourceType: "Bundle",
  type: "searchset",
  total: 0,
  entry: [],
};

const FHIR_MALFORMED_BUNDLE = {
  not_a_bundle: true,
  missing_entry: "yes",
};

// ── parseFhirBundle tests ──────────────────────────────────────────────────

describe("parseFhirBundle — Composition resource extraction", () => {
  it("extracts Composition resources from Bundle.entry", () => {
    const result = parseFhirBundle(FHIR_BUNDLE_FIXTURE);
    expect(result.compositions.length).toBe(1);
  });

  it("returns empty compositions for empty Bundle", () => {
    const result = parseFhirBundle(FHIR_EMPTY_BUNDLE);
    expect(result.compositions).toEqual([]);
  });

  it("returns empty compositions for malformed input", () => {
    const result = parseFhirBundle(FHIR_MALFORMED_BUNDLE);
    expect(result.compositions).toEqual([]);
  });

  it("extracts therapeutic indication section text", () => {
    const result = parseFhirBundle(FHIR_BUNDLE_FIXTURE);
    expect(result.indication_text).toBeTruthy();
    expect(result.indication_text.toLowerCase()).toContain("migraine");
  });

  it("handles Bundle with no Therapeutic indications section", () => {
    const bundleWithoutIndications = {
      ...FHIR_BUNDLE_FIXTURE,
      entry: [
        {
          resource: {
            resourceType: "Composition",
            section: [
              {
                title: "4.3 Contraindications",
                text: { div: "<div>Some contraindication</div>" },
              },
            ],
          },
        },
      ],
    };
    const result = parseFhirBundle(bundleWithoutIndications);
    expect(result.indication_text).toBe("");
  });

  it("handles null/undefined input gracefully", () => {
    expect(() => parseFhirBundle(null as unknown as object)).not.toThrow();
    expect(() => parseFhirBundle(undefined as unknown as object)).not.toThrow();
    const result = parseFhirBundle(null as unknown as object);
    expect(result.compositions).toEqual([]);
    expect(result.indication_text).toBe("");
  });
});

// ── fetchEmaEpiLabel — mocked network ────────────────────────────────────

describe("fetchEmaEpiLabel — mocked network", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns null for empty Bundle (no EMA match)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FHIR_EMPTY_BUNDLE,
      headers: { get: () => null },
    }) as unknown as typeof fetch;

    const result = await fetchEmaEpiLabel("totally-unknown-drug");
    expect(result).toBeNull();
  });

  it("returns structured result with indication_text on 200 OK", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FHIR_BUNDLE_FIXTURE,
      headers: { get: () => null },
    }) as unknown as typeof fetch;

    const result = await fetchEmaEpiLabel("fremanezumab");
    expect(result).not.toBeNull();
    expect(result!.indication_text).toBeTruthy();
    expect(result!.source).toBe("EMA EPI");
  });

  it("returns null (not throw) on network error", async () => {
    global.fetch = jest.fn().mockRejectedValue(
      new Error("Network unavailable"),
    ) as unknown as typeof fetch;

    const result = await fetchEmaEpiLabel("fremanezumab");
    expect(result).toBeNull();
  });

  it("returns null on 404 (no EU approval found)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
    }) as unknown as typeof fetch;

    const result = await fetchEmaEpiLabel("totally-unknown-drug");
    expect(result).toBeNull();
  });
});
