import { describe, it, expect } from 'vitest'
import { statsProbability } from './probability'

describe('statsProbability', () => {
  it('no factors means no information: 50%', () => {
    expect(statsProbability([])).toBe(0.5)
  })

  it('a single moderately positive factor', () => {
    // score = 0.4 → p = 0.5 + 0.5 × 0.4 = 0.7
    expect(statsProbability([{ name: 'form', weight: 1, value: 0.4 }])).toBeCloseTo(0.7, 10)
  })

  it('weights matter: heavier factors pull harder', () => {
    // score = (2×0.5 + 1×(-0.2)) / 3 = 0.8/3 = 0.266667 → p = 0.633333
    const p = statsProbability([
      { name: 'head-to-head', weight: 2, value: 0.5 },
      { name: 'venue', weight: 1, value: -0.2 }
    ])
    expect(p).toBeCloseTo(0.633333, 5)
  })

  it('perfectly balanced factors cancel out to 50%', () => {
    const p = statsProbability([
      { name: 'a', weight: 1, value: 0.6 },
      { name: 'b', weight: 1, value: -0.6 }
    ])
    expect(p).toBeCloseTo(0.5, 10)
  })

  it('maximally favorable evidence clamps at 95%, never certainty', () => {
    expect(statsProbability([{ name: 'all', weight: 1, value: 1 }])).toBe(0.95)
  })

  it('maximally unfavorable evidence clamps at 5%', () => {
    expect(statsProbability([{ name: 'all', weight: 1, value: -1 }])).toBe(0.05)
  })

  it('rejects non-positive weights', () => {
    expect(() => statsProbability([{ name: 'x', weight: 0, value: 0.5 }])).toThrow(
      'Factor weights must be positive numbers'
    )
    expect(() => statsProbability([{ name: 'x', weight: -1, value: 0.5 }])).toThrow()
  })

  it('rejects values outside [-1, 1]', () => {
    expect(() => statsProbability([{ name: 'x', weight: 1, value: 1.5 }])).toThrow(
      'Factor values must be between -1 and 1'
    )
    expect(() => statsProbability([{ name: 'x', weight: 1, value: NaN }])).toThrow()
  })
})
