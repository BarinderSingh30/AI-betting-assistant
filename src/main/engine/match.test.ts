import { describe, expect, it } from 'vitest'
import { decideMatch } from './match'

// Hand-computed: pA=0.60, oddsA=2.00, oddsB=1.90, bankroll=1000
//   evA = 0.60*2.00-1 = 0.20 ; evB = 0.40*1.90-1 = -0.24
//   full Kelly A = 0.20/(2.00-1) = 0.20 ; quarter = 0.05 -> 50, capped at 2% = 20
describe('decideMatch', () => {
  it('bets side A when only A clears the threshold', () => {
    const v = decideMatch({ pA: 0.6, oddsA: 2.0, oddsB: 1.9, bankroll: 1000 })
    expect(v.side).toBe('A')
    expect(v.evA).toBeCloseTo(0.2, 10)
    expect(v.evB).toBeCloseTo(-0.24, 10)
    expect(v.stake).toBeCloseTo(20, 10) // capped at 2% of 1000
  })

  // pA=0.40 -> pB=0.60, oddsB=2.10: evB = 0.60*2.10-1 = 0.26 ; evA = 0.40*1.80-1 = -0.28
  //   full Kelly B = 0.26/1.10 = 0.23636..; quarter*1000 = 59.09 -> capped 20
  it('bets side B when only B clears the threshold', () => {
    const v = decideMatch({ pA: 0.4, oddsA: 1.8, oddsB: 2.1, bankroll: 1000 })
    expect(v.side).toBe('B')
    expect(v.evB).toBeCloseTo(0.26, 10)
    expect(v.stake).toBeCloseTo(20, 10)
  })

  // pA=0.50, oddsA=1.90, oddsB=1.90: both EVs = -0.05 -> NO BET, stake 0
  it('returns NO BET when neither side clears the threshold', () => {
    const v = decideMatch({ pA: 0.5, oddsA: 1.9, oddsB: 1.9, bankroll: 1000 })
    expect(v.side).toBeNull()
    expect(v.stake).toBe(0)
  })

  // EV exactly at threshold counts as a bet (>=), consistent with decide() in decision.ts:
  // pA=0.52, oddsA=2.00 -> evA = 0.04
  it('treats EV exactly at the threshold as a bet', () => {
    const v = decideMatch({ pA: 0.52, oddsA: 2.0, oddsB: 1.9, bankroll: 1000 })
    expect(v.side).toBe('A')
  })

  // Both sides positive (a bad bookmaker line): picks the HIGHER EV side.
  // pA=0.60, oddsA=1.80 (evA=0.08), oddsB=2.80 (evB=0.12) -> B
  it('picks the higher-EV side when both are positive', () => {
    const v = decideMatch({ pA: 0.6, oddsA: 1.8, oddsB: 2.8, bankroll: 1000 })
    expect(v.side).toBe('B')
  })

  it('exposes the vig-removed probability and vig for the evidence trail', () => {
    const v = decideMatch({ pA: 0.5, oddsA: 2.0, oddsB: 2.0, bankroll: 1000 })
    expect(v.impliedA).toBeCloseTo(0.5, 10)
    expect(v.vigFreeA).toBeCloseTo(0.5, 10)
    expect(v.vig).toBeCloseTo(0, 10)
  })

  it('respects a custom threshold and cap', () => {
    const v = decideMatch({
      pA: 0.6,
      oddsA: 2.0,
      oddsB: 1.9,
      bankroll: 1000,
      evThreshold: 0.25, // higher than evA=0.20
      capFraction: 0.05
    })
    expect(v.side).toBeNull()
  })

  it('rejects an invalid bankroll with a plain error', () => {
    expect(() => decideMatch({ pA: 0.5, oddsA: 2.0, oddsB: 2.0, bankroll: -5 })).toThrow(
      /Bankroll/
    )
  })
})
