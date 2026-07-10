import { assertProbability } from './odds'

export interface BlendOptions {
  semanticWeight?: number // how much the expert-opinion signal counts (default 0.3)
  maxShift?: number // max distance from pStats, in probability points (default 0.10)
}

// The semantic (expert-opinion) signal may nudge the stats estimate but
// never override it: the shift away from pStats is hard-bounded.
export function blendProbabilities(
  pStats: number,
  pSemantic: number,
  options: BlendOptions = {}
): number {
  assertProbability(pStats)
  assertProbability(pSemantic)
  const w = options.semanticWeight ?? 0.3
  const maxShift = options.maxShift ?? 0.1
  const raw = (1 - w) * pStats + w * pSemantic
  const shift = Math.min(maxShift, Math.max(-maxShift, raw - pStats))
  return Math.min(0.99, Math.max(0.01, pStats + shift))
}
