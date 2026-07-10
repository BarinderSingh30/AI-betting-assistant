import { describe, it, expect } from 'vitest'
import { decide } from './decision'

describe('decide', () => {
  it('recommends BET with a capped stake on a clear edge', () => {
    // p=0.55 at 2.0/2.0: implied 0.5, vig 0, EV +0.10 ≥ 0.04 → BET
    // quarter-Kelly wants 25 of 1000, cap 2% → stake 20
    const r = decide({ pFinal: 0.55, decimalOdds: 2.0, oppositeOdds: 2.0, bankroll: 1000 })
    expect(r.verdict).toBe('BET')
    expect(r.ev).toBeCloseTo(0.1, 10)
    expect(r.stake).toBeCloseTo(20, 10)
    expect(r.impliedProbability).toBeCloseTo(0.5, 10)
    expect(r.vigFreeProbability).toBeCloseTo(0.5, 10)
    expect(r.vig).toBeCloseTo(0, 10)
  })

  it('recommends NO_BET with zero stake when EV is negative', () => {
    // p=0.50 at 1.90: EV = -0.05
    const r = decide({ pFinal: 0.5, decimalOdds: 1.9, bankroll: 1000 })
    expect(r.verdict).toBe('NO_BET')
    expect(r.ev).toBeCloseTo(-0.05, 10)
    expect(r.stake).toBe(0)
  })

  it('recommends NO_BET on a positive EV below the 4% threshold', () => {
    // p=0.51 at 2.0: EV = +0.02 < 0.04
    const r = decide({ pFinal: 0.51, decimalOdds: 2.0, bankroll: 1000 })
    expect(r.verdict).toBe('NO_BET')
    expect(r.stake).toBe(0)
  })

  it('EV exactly at the threshold is a BET (spec: NO BET only when EV < threshold)', () => {
    // p=0.52 at 2.0: EV = 0.04 exactly → BET, quarter-Kelly stake 10
    const r = decide({ pFinal: 0.52, decimalOdds: 2.0, bankroll: 1000 })
    expect(r.verdict).toBe('BET')
    expect(r.stake).toBeCloseTo(10, 10)
  })

  it('omitting oppositeOdds leaves the vig fields null', () => {
    const r = decide({ pFinal: 0.5, decimalOdds: 1.9, bankroll: 1000 })
    expect(r.vigFreeProbability).toBeNull()
    expect(r.vig).toBeNull()
    expect(r.impliedProbability).toBeCloseTo(0.526316, 5)
  })

  it('honors a custom EV threshold', () => {
    // EV 0.10 but threshold 0.15 → NO_BET
    const r = decide({ pFinal: 0.55, decimalOdds: 2.0, bankroll: 1000, evThreshold: 0.15 })
    expect(r.verdict).toBe('NO_BET')
  })

  it('passes custom Kelly options through', () => {
    const r = decide({
      pFinal: 0.55,
      decimalOdds: 2.0,
      bankroll: 1000,
      kellyFraction: 0.5,
      capFraction: 0.05
    })
    expect(r.stake).toBeCloseTo(50, 10)
  })

  it('rejects an invalid bankroll even when the verdict would be NO_BET', () => {
    expect(() => decide({ pFinal: 0.5, decimalOdds: 1.9, bankroll: -5 })).toThrow(
      'Bankroll must be 0 or more'
    )
  })

  it('rejects invalid probability and odds with plain-language errors', () => {
    expect(() => decide({ pFinal: 1.5, decimalOdds: 2.0, bankroll: 100 })).toThrow(
      'Probability must be between 0 and 1'
    )
    expect(() => decide({ pFinal: 0.5, decimalOdds: 0.9, bankroll: 100 })).toThrow(
      'Decimal odds must be a number greater than 1 (e.g. 1.85)'
    )
  })
})
