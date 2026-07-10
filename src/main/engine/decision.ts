import { expectedValue, impliedProbability, removeVig } from './odds'
import { assertBankroll, kellyStake } from './kelly'

export interface CalcInput {
  pFinal: number // our probability the chosen side wins, 0..1
  decimalOdds: number // bookmaker's decimal odds for the chosen side
  oppositeOdds?: number // odds for the other side, enables vig removal display
  bankroll: number
  evThreshold?: number // default 0.04
  kellyFraction?: number // default 0.25
  capFraction?: number // default 0.02
}

export interface CalcResult {
  impliedProbability: number // raw 1/odds
  vigFreeProbability: number | null // null when oppositeOdds not given
  vig: number | null // null when oppositeOdds not given
  ev: number
  verdict: 'BET' | 'NO_BET'
  stake: number // 0 when NO_BET
}

export type CalcResponse = { ok: true; result: CalcResult } | { ok: false; error: string }

// The one decision function: odds math -> EV gate -> stake sizing.
// NO_BET is the default outcome; a stake only appears past the EV threshold.
export function decide(input: CalcInput): CalcResult {
  assertBankroll(input.bankroll)
  const threshold = input.evThreshold ?? 0.04
  const implied = impliedProbability(input.decimalOdds)
  let vigFreeProbability: number | null = null
  let vig: number | null = null
  if (input.oppositeOdds !== undefined) {
    const r = removeVig(input.decimalOdds, input.oppositeOdds)
    vigFreeProbability = r.probA
    vig = r.vig
  }
  const ev = expectedValue(input.pFinal, input.decimalOdds)
  const bet = ev >= threshold
  const stake = bet
    ? kellyStake(input.pFinal, input.decimalOdds, input.bankroll, {
        fraction: input.kellyFraction,
        capFraction: input.capFraction
      })
    : 0
  return {
    impliedProbability: implied,
    vigFreeProbability,
    vig,
    ev,
    verdict: bet ? 'BET' : 'NO_BET',
    stake
  }
}
