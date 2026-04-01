import type { IProvider } from "./types.js";
import { DirectProvider } from "./direct/index.js";
import { HostedProvider } from "./hosted/index.js";

export function createProvider(): IProvider {
  return process.env.HEOR_API_KEY
    ? new HostedProvider(process.env.HEOR_API_KEY)
    : new DirectProvider();
}
