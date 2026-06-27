import type { IProvider } from "./types.js";
import { DirectProvider } from "./direct/index.js";

let hostedKeyWarned = false;

export function createProvider(): IProvider {
  // Phase 2 HostedProvider is not implemented yet. Keep literature search working
  // even when HEOR_API_KEY is set (legacy docs / copy-paste env configs).
  if (process.env.HEOR_API_KEY && !hostedKeyWarned) {
    hostedKeyWarned = true;
    console.error(
      "[heor-agent] HEOR_API_KEY is set but HostedProvider is not implemented; using DirectProvider.",
    );
  }
  return new DirectProvider();
}
