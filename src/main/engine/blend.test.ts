import { describe, it, expect } from 'vitest'
import { blendProbabilities } from './blend'

describe('blendProbabilities', () => {
  it('blends with 30% semantic weight when inside the bound', () => {
    // 0.7 × 0.60 + 0.3 × 0.80 = 0.66; shift 0.06 ≤ 0.10 → 0.66
    expect(blendProbabilities(0.6, 0.8)).toBeCloseTo(0.66, 10)
  })

  it('agreeing signals change nothing', () => {
    expect(blendProbabilities(0.55, 0.55)).toBeCloseTo(0.55, 10)
  })

  it('clamps an extreme upward semantic pull to +10 points', () => {
    // raw = 0.7 × 0.50 + 0.3 × 0.95 = 0.635; shift 0.135 → clamped to 0.10 → 0.60
    expect(blendProbabilities(0.5, 0.95)).toBeCloseTo(0.6, 10)
  })

  it('clamps an extreme downward semantic pull to -10 points', () => {
    // raw = 0.7 × 0.50 + 0.3 × 0.05 = 0.365; shift -0.135 → clamped to -0.10 → 0.40
    expect(blendProbabilities(0.5, 0.05)).toBeCloseTo(0.4, 10)
  })

  it('honors a custom semantic weight', () => {
    // w=1: result is pSemantic when the shift fits the bound
    expect(blendProbabilities(0.5, 0.55, { semanticWeight: 1 })).toBeCloseTo(0.55, 10)
  })

  it('honors a custom max shift', () => {
    // w=1, maxShift=0.02: 0.5 → 0.95 raw, clamped to 0.52
    expect(blendProbabilities(0.5, 0.95, { semanticWeight: 1, maxShift: 0.02 })).toBeCloseTo(
      0.52,
      10
    )
  })

  it('never leaves [0.01, 0.99] even at the extremes', () => {
    expect(blendProbabilities(0.95, 1.0, { semanticWeight: 1 })).toBeCloseTo(0.99, 10)
    expect(blendProbabilities(0.05, 0.0, { semanticWeight: 1 })).toBeCloseTo(0.01, 10)
  })

  it('rejects probabilities outside [0, 1]', () => {
    expect(() => blendProbabilities(1.2, 0.5)).toThrow('Probability must be between 0 and 1')
    expect(() => blendProbabilities(0.5, -0.1)).toThrow('Probability must be between 0 and 1')
  })
})
