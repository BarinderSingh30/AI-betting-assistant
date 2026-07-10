// Pure betting-odds math. No I/O, no Electron — every function is
// unit-tested against hand-computed cases because this handles real money.

export function assertOdds(decimalOdds: number): void {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) {
    throw new Error('Decimal odds must be a number greater than 1 (e.g. 1.85)')
  }
}

export function assertProbability(p: number): void {
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new Error('Probability must be between 0 and 1')
  }
}

// What the bookmaker's price says the chance is, before removing their margin.
export function impliedProbability(decimalOdds: number): number {
  assertOdds(decimalOdds)
  return 1 / decimalOdds
}

// A bookmaker's two prices imply probabilities summing to MORE than 1 —
// the excess is their margin (the "vig"). Normalizing removes it.
export function removeVig(
  oddsA: number,
  oddsB: number
): { probA: number; probB: number; vig: number } {
  assertOdds(oddsA)
  assertOdds(oddsB)
  const rawA = 1 / oddsA
  const rawB = 1 / oddsB
  const total = rawA + rawB
  return { probA: rawA / total, probB: rawB / total, vig: total - 1 }
}

// EV per unit staked: p × odds − 1. Positive means the price underrates
// our chance; negative means the bet loses money on average.
export function expectedValue(probability: number, decimalOdds: number): number {
  assertProbability(probability)
  assertOdds(decimalOdds)
  return probability * decimalOdds - 1
}
