import { assertOdds, assertProbability } from './odds'

export interface KellyOptions {
  fraction?: number // fraction of full Kelly to stake (default 0.25 = quarter-Kelly)
  capFraction?: number // hard cap as a fraction of bankroll (default 0.02 = 2%)
}

export function assertBankroll(bankroll: number): void {
  if (!Number.isFinite(bankroll) || bankroll < 0) {
    throw new Error('Bankroll must be 0 or more')
  }
}

// Full Kelly maximizes long-run growth but swings violently; betting a
// quarter of it keeps most of the growth with far smaller drawdowns.
// The cap guarantees no single recommendation can hurt the bankroll badly.
export function kellyStake(
  probability: number,
  decimalOdds: number,
  bankroll: number,
  options: KellyOptions = {}
): number {
  assertProbability(probability)
  assertOdds(decimalOdds)
  assertBankroll(bankroll)
  const fraction = options.fraction ?? 0.25
  const capFraction = options.capFraction ?? 0.02
  const edge = probability * decimalOdds - 1
  if (edge <= 0) return 0
  const fullKelly = edge / (decimalOdds - 1)
  return Math.min(bankroll * fraction * fullKelly, bankroll * capFraction)
}
