export { extractComparatorPairs, normalizeDrugName } from "./extractor.js";
export { buildEvidenceNetwork } from "./builder.js";
export { computeIndirectComparison, poolFixedEffect } from "./bucher.js";
export { frequentistNMA } from "./frequentistNma.js";
export { findIndirectPaths } from "./pathfinder.js";
export type {
  EvidenceNode,
  EvidenceEdge,
  EvidenceNetwork,
  NMAFeasibility,
  NetworkGap,
  ComparatorPair,
  DirectComparison,
  IndirectEstimate,
  IndirectComparisonResult,
  IndirectPath,
  EffectMeasure,
  PooledEstimate,
} from "./types.js";
