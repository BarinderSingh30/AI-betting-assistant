import { describe, it, expect } from 'vitest'
import { impliedProbability, removeVig, expectedValue } from './odds'

// Hand-computed cases. This math handles real money — every expected
// value below was worked out on paper first.

describe('impliedProbability', () => {
  it('odds 2.0 imply 50%', () => {
    expect(impliedProbability(2.0)).toBeCloseTo(0.5, 10)
  })

  it('odds 4.0 imply 25%', () => {
    expect(impliedProbability(4.0)).toBeCloseTo(0.25, 10)
  })

  it('odds 1.25 imply 80%', () => {
    expect(impliedProbability(1.25)).toBeCloseTo(0.8, 10)
  })

  it('rejects odds of exactly 1 (no possible profit)', () => {
    expect(() => impliedProbability(1)).toThrow(
      'Decimal odds must be a number greater than 1 (e.g. 1.85)'
    )
  })

  it('rejects odds below 1, zero, negative, NaN and Infinity', () => {
    for (const bad of [0.9, 0, -2, NaN, Infinity]) {
      expect(() => impliedProbability(bad)).toThrow()
    }
  })
})

describe('removeVig', () => {
  it('symmetric 1.90/1.90 book normalizes to 50/50 with ~5.26% vig', () => {
    // 1/1.9 = 0.526316 each side; total = 1.052632; vig = total - 1
    const r = removeVig(1.9, 1.9)
    expect(r.probA).toBeCloseTo(0.5, 10)
    expect(r.probB).toBeCloseTo(0.5, 10)
    expect(r.vig).toBeCloseTo(0.0526316, 6)
  })

  it('a fair book (1.50/3.00) has zero vig and keeps raw probabilities', () => {
    // 1/1.5 + 1/3 = 0.666667 + 0.333333 = 1.0 exactly
    const r = removeVig(1.5, 3.0)
    expect(r.probA).toBeCloseTo(2 / 3, 10)
    expect(r.probB).toBeCloseTo(1 / 3, 10)
    expect(r.vig).toBeCloseTo(0, 10)
  })

  it('asymmetric real-world book 1.57/2.45', () => {
    // rawA = 0.636943, rawB = 0.408163, total = 1.045106
    // probA = 0.636943 / 1.045106 = 0.609453
    const r = removeVig(1.57, 2.45)
    expect(r.probA).toBeCloseTo(0.60945, 4)
    expect(r.probB).toBeCloseTo(0.39055, 4)
    expect(r.vig).toBeCloseTo(0.045106, 5)
  })

  it('probA and probB always sum to 1', () => {
    const r = removeVig(1.33, 3.75)
    expect(r.probA + r.probB).toBeCloseTo(1, 10)
  })

  it('rejects invalid odds on either side', () => {
    expect(() => removeVig(1, 2)).toThrow()
    expect(() => removeVig(2, 0.5)).toThrow()
  })
})

describe('expectedValue', () => {
  it('p=0.55 at odds 2.0 gives +10% EV', () => {
    expect(expectedValue(0.55, 2.0)).toBeCloseTo(0.1, 10)
  })

  it('p=0.50 at odds 1.90 gives -5% EV (the vig eats you)', () => {
    expect(expectedValue(0.5, 1.9)).toBeCloseTo(-0.05, 10)
  })

  it('p equal to implied probability gives exactly 0 EV', () => {
    expect(expectedValue(0.25, 4.0)).toBeCloseTo(0, 10)
  })

  it('rejects probabilities outside [0, 1]', () => {
    expect(() => expectedValue(-0.1, 2)).toThrow('Probability must be between 0 and 1')
    expect(() => expectedValue(1.1, 2)).toThrow('Probability must be between 0 and 1')
    expect(() => expectedValue(NaN, 2)).toThrow()
  })

  it('rejects invalid odds', () => {
    expect(() => expectedValue(0.5, 1)).toThrow()
  })
})
