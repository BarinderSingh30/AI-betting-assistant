import { expectedValue, removeVig } from './odds'
import { assertBankroll, kellyStake } from './kelly'

export interface MatchDecisionInput {
  pA: number // our final probability that side A wins, 0..1
  oddsA: number // bookmaker decimal odds for side A
  oddsB: number // bookmaker decimal odds for side B
  bankroll: number
  evThreshold?: number // default 0.04
  kellyFraction?: number // default 0.25
  capFraction?: number // default 0.02
}

export interface MatchVerdict {
  side: 'A' | 'B' | null // null = NO BET
  stake: number // 0 when NO BET
  evA: number
  evB: number
  impliedA: number // raw 1/oddsA
  impliedB: number // raw 1/oddsB
  vigFreeA: number // bookmaker's probability for A after removing their margin
  vig: number
}

// Evaluates BOTH sides of the match and only recommends the better one —
// and only if it clears the EV threshold. NO BET is the default outcome.
export function decideMatch(input: MatchDecisionInput): MatchVerdict {
  assertBankroll(input.bankroll)
  const threshold = input.evThreshold ?? 0.04
  const pB = 1 - input.pA
  const evA = expectedValue(input.pA, input.oddsA)
  const evB = expectedValue(pB, input.oddsB)
  const { probA, vig } = removeVig(input.oddsA, input.oddsB)

  let side: 'A' | 'B' | null = null
  if (evA >= threshold || evB >= threshold) side = evA >= evB ? 'A' : 'B'

  const stake =
    side === null
      ? 0
      : kellyStake(
          side === 'A' ? input.pA : pB,
          side === 'A' ? input.oddsA : input.oddsB,
          input.bankroll,
          { fraction: input.kellyFraction, capFraction: input.capFraction }
        )

  return {
    side,
    stake,
    evA,
    evB,
    impliedA: 1 / input.oddsA,
    impliedB: 1 / input.oddsB,
    vigFreeA: probA,
    vig
  }
}
