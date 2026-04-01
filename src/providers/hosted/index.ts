import type { IProvider, LiteratureSearchParams, CEModelParams, DossierParams, ToolResult } from "../types.js";

export class HostedProvider implements IProvider {
  constructor(private apiKey: string) {}

  async searchLiterature(_params: LiteratureSearchParams): Promise<ToolResult> {
    throw new Error("HostedProvider not yet implemented — coming in Phase 2");
  }

  async buildCEModel(_params: CEModelParams): Promise<ToolResult> {
    throw new Error("HostedProvider not yet implemented — coming in Phase 2");
  }

  async prepDossier(_params: DossierParams): Promise<ToolResult> {
    throw new Error("HostedProvider not yet implemented — coming in Phase 2");
  }
}
