import type { IProvider, LiteratureSearchParams, CEModelParams, DossierParams, ToolResult } from "../types.js";

export class DirectProvider implements IProvider {
  async searchLiterature(_params: LiteratureSearchParams): Promise<ToolResult> {
    throw new Error("DirectProvider not yet implemented");
  }

  async buildCEModel(_params: CEModelParams): Promise<ToolResult> {
    throw new Error("DirectProvider not yet implemented");
  }

  async prepDossier(_params: DossierParams): Promise<ToolResult> {
    throw new Error("DirectProvider not yet implemented");
  }
}
