import { handleSurvivalFitting } from "../../src/tools/survivalFitting.js";

describe("handleSurvivalFitting", () => {
  const kmData = [
    { time: 0, survival: 1.0, n_at_risk: 100 },
    { time: 6, survival: 0.8, n_at_risk: 80 },
    { time: 12, survival: 0.65, n_at_risk: 65 },
    { time: 18, survival: 0.52, n_at_risk: 52 },
    { time: 24, survival: 0.42, n_at_risk: 42 },
    { time: 30, survival: 0.35, n_at_risk: 35 },
    { time: 36, survival: 0.3, n_at_risk: 30 },
  ];

  it("runs happy path and returns text content", async () => {
    const result = await handleSurvivalFitting({
      km_data: kmData,
      time_unit: "months",
      endpoint: "OS",
    });
    expect(typeof result.content).toBe("string");
    expect(result.content).toContain("Survival Curve Fitting");
    expect(result.content).toContain("Model Comparison");
  });

  it("rejects fewer than 3 data points", async () => {
    await expect(
      handleSurvivalFitting({
        km_data: [
          { time: 0, survival: 1.0 },
          { time: 6, survival: 0.8 },
        ],
      }),
    ).rejects.toThrow();
  });

  it("rejects survival values outside 0-1", async () => {
    await expect(
      handleSurvivalFitting({
        km_data: [
          { time: 0, survival: 1.0 },
          { time: 6, survival: 1.5 },
          { time: 12, survival: 0.5 },
        ],
      }),
    ).rejects.toThrow();
  });

  it("returns JSON with 5 fitted distributions", async () => {
    const result = await handleSurvivalFitting({
      km_data: kmData,
      output_format: "json",
    });
    const content = result.content as {
      fits: Array<{ name: string; aic: number; bic: number }>;
      best_aic: string;
      best_bic: string;
    };
    expect(content.fits).toHaveLength(5);
    expect([
      "exponential",
      "weibull",
      "log_logistic",
      "log_normal",
      "gompertz",
    ]).toContain(content.best_aic);
  });

  it("warns when n_at_risk missing", async () => {
    const result = await handleSurvivalFitting({
      km_data: kmData.map(({ n_at_risk: _na, ...rest }) => rest),
    });
    const warnings = result.audit.warnings?.join(" ") ?? "";
    expect(warnings.toLowerCase()).toContain("n_at_risk");
  });

  it("KM-table path warns that fits are an approximation (v1.9.0: no longer 'EXPERIMENTAL', but still flagged)", async () => {
    const result = await handleSurvivalFitting({ km_data: kmData });
    const warnings = result.audit.warnings?.join(" ") ?? "";
    expect(warnings.toLowerCase()).toMatch(
      /approximation|less reliable|use event_data/i,
    );
  });

  it("event_data path emits NO approximation warning (true MLE)", async () => {
    // 12 alternating event/censored rows with reasonable spread
    const eventData = [
      { time: 1.5, event: 1 as const },
      { time: 3.0, event: 1 as const },
      { time: 4.2, event: 0 as const },
      { time: 5.8, event: 1 as const },
      { time: 7.1, event: 1 as const },
      { time: 8.5, event: 0 as const },
      { time: 10.2, event: 1 as const },
      { time: 12.4, event: 1 as const },
      { time: 14.8, event: 0 as const },
      { time: 17.0, event: 1 as const },
      { time: 19.5, event: 0 as const },
      { time: 22.0, event: 1 as const },
    ];
    const result = await handleSurvivalFitting({ event_data: eventData });
    const warnings = result.audit.warnings?.join(" ") ?? "";
    expect(warnings.toLowerCase()).not.toMatch(/approximation/i);
    // Methodology line should reference patient-level / TSD 14
    expect(result.audit.methodology?.toLowerCase()).toMatch(
      /patient-level|tsd 14|mle/i,
    );
  });

  it("rejects passing both km_data and event_data simultaneously", async () => {
    await expect(
      handleSurvivalFitting({
        km_data: kmData,
        event_data: [
          { time: 1, event: 1 as const },
          { time: 2, event: 1 as const },
          { time: 3, event: 0 as const },
          { time: 4, event: 1 as const },
          { time: 5, event: 0 as const },
        ],
      }),
    ).rejects.toThrow();
  });

  it("rejects passing neither km_data nor event_data", async () => {
    await expect(handleSurvivalFitting({})).rejects.toThrow();
  });
});
