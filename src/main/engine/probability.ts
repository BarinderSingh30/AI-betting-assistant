export interface Factor {
  name: string
  weight: number // importance of this factor, must be > 0
  value: number // -1 (strongly favors side B) .. +1 (strongly favors side A)
}

// Weighted average of the factor values, mapped linearly onto a probability.
// Clamped to [0.05, 0.95]: statistics alone never justify near-certainty.
export function statsProbability(factors: Factor[]): number {
  for (const f of factors) {
    if (!Number.isFinite(f.weight) || f.weight <= 0) {
      throw new Error('Factor weights must be positive numbers')
    }
    if (!Number.isFinite(f.value) || f.value < -1 || f.value > 1) {
      throw new Error('Factor values must be between -1 and 1')
    }
  }
  if (factors.length === 0) return 0.5
  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0)
  const score = factors.reduce((sum, f) => sum + f.weight * f.value, 0) / totalWeight
  return Math.min(0.95, Math.max(0.05, 0.5 + 0.5 * score))
}
