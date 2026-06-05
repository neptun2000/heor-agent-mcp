import { survivalFittingToolSchema } from "../../src/tools/survivalFitting.js";
import { htaWorkflowToolSchema } from "../../src/tools/htaWorkflow.js";
import { htaDossierPrepToolSchema } from "../../src/tools/htaDossierPrep.js";
import { costEffectivenessModelToolSchema } from "../../src/tools/costEffectivenessModel.js";
import { governanceSelfCheckToolSchema } from "../../src/tools/governanceSelfCheck.js";

/**
 * GUARD: `ai_disclosure_level` must live INSIDE `inputSchema.properties`, not as a
 * sibling of `properties`/`required`. When misplaced, external MCP clients
 * (Claude.ai, Smithery, ChatGPT adapter) can't discover the parameter. 4 tools had
 * it outside `properties` (fixed 2026-06-05).
 */
describe("ai_disclosure_level is a discoverable property (not misplaced)", () => {
  const tools = [
    ["survival_fitting", survivalFittingToolSchema],
    ["hta_workflow", htaWorkflowToolSchema],
    ["hta_dossier", htaDossierPrepToolSchema],
    ["cost_effectiveness_model", costEffectivenessModelToolSchema],
    ["governance_self_check", governanceSelfCheckToolSchema],
  ] as const;

  it.each(tools)("%s exposes ai_disclosure_level inside properties", (_name, schema) => {
    const inputSchema = (schema as { inputSchema: Record<string, unknown> })
      .inputSchema;
    const properties = inputSchema.properties as Record<string, unknown>;
    expect(properties).toBeDefined();
    expect(properties.ai_disclosure_level).toBeDefined();
    // must NOT be a stray sibling of `properties`
    expect(
      (inputSchema as Record<string, unknown>).ai_disclosure_level,
    ).toBeUndefined();
  });
});
