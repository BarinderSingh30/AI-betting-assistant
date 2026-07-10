import { describe, it, expect } from 'vitest'
import { kellyStake } from './kelly'

// Kelly formula: fullKelly = (p × odds − 1) / (odds − 1).
// Stake = bankroll × fraction × fullKelly, hard-capped at bankroll × capFraction.

describe('kellyStake', () => {
  it('caps at 2% of bankroll when quarter-Kelly wants more', () => {
    // p=0.55, odds=2.0: fullKelly = 0.10/1 = 0.10; quarter = 0.025
    // 1000 × 0.025 = 25, but cap = 1000 × 0.02 = 20 → 20
    expect(kellyStake(0.55, 2.0, 1000)).toBeCloseTo(20, 10)
  })

  it('uses quarter-Kelly when it is below the cap', () => {
    // p=0.52, odds=2.0: fullKelly = 0.04; quarter = 0.01 → 1000 × 0.01 = 10 < 20
    expect(kellyStake(0.52, 2.0, 1000)).toBeCloseTo(10, 10)
  })

  it('works at short odds', () => {
    // p=0.60, odds=1.8: edge = 0.08, b = 0.8, fullKelly = 0.10; quarter = 0.025
    // 500 × 0.025 = 12.5, cap = 500 × 0.02 = 10 → 10
    expect(kellyStake(0.6, 1.8, 500)).toBeCloseTo(10, 10)
  })

  it('returns 0 when the edge is negative (never bet a losing proposition)', () => {
    expect(kellyStake(0.4, 2.0, 1000)).toBe(0)
  })

  it('returns 0 when the edge is exactly zero', () => {
    expect(kellyStake(0.5, 2.0, 1000)).toBe(0)
  })

  it('returns 0 on a zero bankroll', () => {
    expect(kellyStake(0.55, 2.0, 0)).toBe(0)
  })

  it('honors custom fraction and cap from options', () => {
    // half-Kelly, 5% cap: p=0.55, odds=2.0 → 1000 × 0.5 × 0.10 = 50; cap 50 → 50
    expect(kellyStake(0.55, 2.0, 1000, { fraction: 0.5, capFraction: 0.05 })).toBeCloseTo(50, 10)
  })

  it('never exceeds the cap no matter how big the edge is', () => {
    // huge edge: p=0.9 at odds 3.0 → fullKelly = (2.7-1)/2 = 0.85
    expect(kellyStake(0.9, 3.0, 1000)).toBeCloseTo(20, 10)
  })

  it('rejects a negative bankroll', () => {
    expect(() => kellyStake(0.55, 2.0, -100)).toThrow('Bankroll must be 0 or more')
  })

  it('rejects invalid probability and odds', () => {
    expect(() => kellyStake(1.5, 2.0, 1000)).toThrow()
    expect(() => kellyStake(0.5, 1.0, 1000)).toThrow()
  })
})
