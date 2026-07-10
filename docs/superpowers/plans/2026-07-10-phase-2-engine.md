# Phase 2 — Money-Math Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all betting math as pure, exhaustively unit-tested functions (TDD), plus a temporary Calculator page in the app so the math is visible and testable by hand.

**Architecture:** Four pure-math modules in `src/main/engine/` (no I/O, no Electron imports) built test-first, plus a fifth module `decision.ts` that composes them into one "evaluate this bet" entry point. The renderer's temporary Calculator page calls `decision.ts` through a new IPC channel (`calc:evaluate`), exactly the shape the real analysis pipeline will use in Phase 3.

**Tech Stack:** TypeScript, Vitest (already installed), Electron IPC (existing pattern in `src/main/ipc.ts` + `src/preload/index.ts`), React (existing pages pattern).

## Global Constraints

- **User runs ALL git commands.** Never run `git add`/`git commit`/any git yourself (CLAUDE.md rule). Each task ends with a "suggest commit" step: record the exact commands so they can be presented to the user; then continue to the next task.
- Probabilities are decimals in `[0, 1]` internally; the UI converts to/from percent.
- Odds are **decimal (European) odds**, must be `> 1`.
- Defaults (from spec §4): EV threshold `0.04` (4%), Kelly fraction `0.25` (¼-Kelly), stake cap `0.02` (2% of bankroll), semantic blend weight `0.30`, semantic max shift `±0.10` (10 percentage points).
- `NO BET` when `EV < threshold` (strictly less than — EV exactly at threshold is a BET).
- Engine functions throw `Error` with plain-language messages on invalid input (exact strings defined in tasks). The IPC handler catches and returns them; the UI shows them. Never a silent failure.
- Engine files must not import from `electron`, `node:*`, or anything with side effects — pure functions only.
- Test files are colocated next to the module (`odds.ts` + `odds.test.ts`), matching `src/main/store/settings.test.ts`.
- Run a single test file with `npx vitest run <path>` (fast; engine tests don't touch better-sqlite3). Run the full suite with `npm test` (its `pretest` script rebuilds better-sqlite3 for Node — required because `npm run dev` rebuilds it for Electron).
- Expected floating-point values in tests use `toBeCloseTo`, never `toBe`, unless the value is exact by construction (e.g. `0`, `0.5` from symmetric inputs).

---

### Task 1: `engine/odds.ts` — implied probability, vig removal, EV

**Files:**
- Create: `src/main/engine/odds.ts`
- Test: `src/main/engine/odds.test.ts`

**Interfaces:**
- Consumes: nothing (first engine module).
- Produces (used by Tasks 2, 4, 5):
  - `impliedProbability(decimalOdds: number): number`
  - `removeVig(oddsA: number, oddsB: number): { probA: number; probB: number; vig: number }`
  - `expectedValue(probability: number, decimalOdds: number): number`
  - `assertOdds(decimalOdds: number): void` — throws `'Decimal odds must be a number greater than 1 (e.g. 1.85)'`
  - `assertProbability(p: number): void` — throws `'Probability must be between 0 and 1'`

- [ ] **Step 1: Write the failing tests**

Create `src/main/engine/odds.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/engine/odds.test.ts`
Expected: FAIL — cannot resolve `./odds` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/main/engine/odds.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/engine/odds.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Suggest commit (user runs it — do NOT run git yourself)**

Record for the user:

```bash
git add src/main/engine/odds.ts src/main/engine/odds.test.ts
git commit -m "feat: odds math - implied probability, vig removal, expected value (TDD)"
```

---

### Task 2: `engine/kelly.ts` — ¼-Kelly stake with 2% cap

**Files:**
- Create: `src/main/engine/kelly.ts`
- Test: `src/main/engine/kelly.test.ts`

**Interfaces:**
- Consumes: `assertOdds`, `assertProbability` from `./odds` (Task 1).
- Produces (used by Task 5):
  - `assertBankroll(bankroll: number): void` — throws `'Bankroll must be 0 or more'`
  - `kellyStake(probability: number, decimalOdds: number, bankroll: number, options?: KellyOptions): number`
  - `interface KellyOptions { fraction?: number; capFraction?: number }` (defaults 0.25 and 0.02)

- [ ] **Step 1: Write the failing tests**

Create `src/main/engine/kelly.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/engine/kelly.test.ts`
Expected: FAIL — cannot resolve `./kelly`.

- [ ] **Step 3: Write the implementation**

Create `src/main/engine/kelly.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/engine/kelly.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Suggest commit (user runs it — do NOT run git yourself)**

```bash
git add src/main/engine/kelly.ts src/main/engine/kelly.test.ts
git commit -m "feat: quarter-Kelly stake sizing with 2% bankroll cap (TDD)"
```

---

### Task 3: `engine/probability.ts` — weighted factor model → p_stats

**Files:**
- Create: `src/main/engine/probability.ts`
- Test: `src/main/engine/probability.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by the Phase 3 pipeline; not consumed inside Phase 2):
  - `interface Factor { name: string; weight: number; value: number }` — `weight > 0`; `value` in `[-1, 1]` where `+1` strongly favors side A, `-1` strongly favors side B
  - `statsProbability(factors: Factor[]): number` — returns P(side A wins), clamped to `[0.05, 0.95]`

Model: `score = Σ(weight × value) / Σ(weight)` (a weighted average in `[-1, 1]`), mapped linearly `p = 0.5 + 0.5 × score`, then clamped to `[0.05, 0.95]` — stats alone never claim near-certainty.

- [ ] **Step 1: Write the failing tests**

Create `src/main/engine/probability.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/engine/probability.test.ts`
Expected: FAIL — cannot resolve `./probability`.

- [ ] **Step 3: Write the implementation**

Create `src/main/engine/probability.ts`:

```ts
export interface Factor {
  name: string
  weight: number // importance of this factor, must be > 0
  value: number // -1 (strongly favors side B) .. +1 (strongly favors side A)
}

// Weighted average of the factor values, mapped linearly onto a probability.
// Clamped to [0.05, 0.95]: statistics alone never justify near-certainty.
export function statsProbability(factors: Factor[]): number {
  for (const f of factors) {
    if (!Number.isFinite(f.weight) || f.weight <= 0) {
      throw new Error('Factor weights must be positive numbers')
    }
    if (!Number.isFinite(f.value) || f.value < -1 || f.value > 1) {
      throw new Error('Factor values must be between -1 and 1')
    }
  }
  if (factors.length === 0) return 0.5
  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0)
  const score = factors.reduce((sum, f) => sum + f.weight * f.value, 0) / totalWeight
  return Math.min(0.95, Math.max(0.05, 0.5 + 0.5 * score))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/engine/probability.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Suggest commit (user runs it — do NOT run git yourself)**

```bash
git add src/main/engine/probability.ts src/main/engine/probability.test.ts
git commit -m "feat: weighted factor model for stats probability (TDD)"
```

---

### Task 4: `engine/blend.ts` — bounded blend of p_stats and p_sem

**Files:**
- Create: `src/main/engine/blend.ts`
- Test: `src/main/engine/blend.test.ts`

**Interfaces:**
- Consumes: `assertProbability` from `./odds` (Task 1).
- Produces (used by the Phase 3 pipeline):
  - `interface BlendOptions { semanticWeight?: number; maxShift?: number }` (defaults 0.3 and 0.1)
  - `blendProbabilities(pStats: number, pSemantic: number, options?: BlendOptions): number`

Model (spec §4 step 3): raw blend `= (1 − w) × pStats + w × pSemantic` with `w = 0.3`; the resulting shift away from `pStats` is clamped to `±maxShift` (default ±10 percentage points — the LLM can nudge, never override); final result clamped to `[0.01, 0.99]`.

- [ ] **Step 1: Write the failing tests**

Create `src/main/engine/blend.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/engine/blend.test.ts`
Expected: FAIL — cannot resolve `./blend`.

- [ ] **Step 3: Write the implementation**

Create `src/main/engine/blend.ts`:

```ts
import { assertProbability } from './odds'

export interface BlendOptions {
  semanticWeight?: number // how much the expert-opinion signal counts (default 0.3)
  maxShift?: number // max distance from pStats, in probability points (default 0.10)
}

// The semantic (expert-opinion) signal may nudge the stats estimate but
// never override it: the shift away from pStats is hard-bounded.
export function blendProbabilities(
  pStats: number,
  pSemantic: number,
  options: BlendOptions = {}
): number {
  assertProbability(pStats)
  assertProbability(pSemantic)
  const w = options.semanticWeight ?? 0.3
  const maxShift = options.maxShift ?? 0.1
  const raw = (1 - w) * pStats + w * pSemantic
  const shift = Math.min(maxShift, Math.max(-maxShift, raw - pStats))
  return Math.min(0.99, Math.max(0.01, pStats + shift))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/engine/blend.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Suggest commit (user runs it — do NOT run git yourself)**

```bash
git add src/main/engine/blend.ts src/main/engine/blend.test.ts
git commit -m "feat: bounded blend of stats and semantic probabilities (TDD)"
```

---

### Task 5: `engine/decision.ts` — the single "evaluate this bet" entry point

**Files:**
- Create: `src/main/engine/decision.ts`
- Test: `src/main/engine/decision.test.ts`

**Interfaces:**
- Consumes: `impliedProbability`, `removeVig`, `expectedValue` from `./odds`; `kellyStake`, `assertBankroll` from `./kelly`.
- Produces (used by Task 6's IPC handler and Calculator page, and by the Phase 3 pipeline):

```ts
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

export function decide(input: CalcInput): CalcResult
```

- [ ] **Step 1: Write the failing tests**

Create `src/main/engine/decision.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/engine/decision.test.ts`
Expected: FAIL — cannot resolve `./decision`.

- [ ] **Step 3: Write the implementation**

Create `src/main/engine/decision.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/engine/decision.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the whole suite (rebuilds better-sqlite3 for Node first)**

Run: `npm test`
Expected: PASS — all engine tests plus the 4 existing settings-store tests.

- [ ] **Step 6: Suggest commit (user runs it — do NOT run git yourself)**

```bash
git add src/main/engine/decision.ts src/main/engine/decision.test.ts
git commit -m "feat: decision module - EV gate plus stake sizing in one entry point (TDD)"
```

---

### Task 6: Calculator page — the math made visible

**Files:**
- Create: `src/renderer/src/pages/Calculator.tsx`
- Modify: `src/main/ipc.ts` (add `calc:evaluate` handler)
- Modify: `src/preload/index.ts` (expose `evaluateBet`)
- Modify: `src/preload/index.d.ts` (type the new API)
- Modify: `src/renderer/src/components/Sidebar.tsx` (add nav entry)
- Modify: `src/renderer/src/App.tsx` (route the page)
- Modify: `src/renderer/src/assets/main.css` (verdict styles)
- Modify: `docs/superpowers/plans/2026-07-09-phase-roadmap.md` (mark Phase 2 done)

**Interfaces:**
- Consumes: `decide`, `CalcInput`, `CalcResult`, `CalcResponse` from `src/main/engine/decision` (Task 5). Type-only imports of these from renderer/preload are fine — they are erased at build time and the module is pure TS.
- Produces: `window.api.evaluateBet(input: CalcInput): Promise<CalcResponse>` for the renderer.

No automated UI tests for this page (no jsdom/testing-library installed; the page is temporary and all math it displays is already unit-tested). Verification is manual via `npm run dev`.

- [ ] **Step 1: Add the IPC handler**

In `src/main/ipc.ts`, add to the imports:

```ts
import { decide, type CalcInput, type CalcResponse } from './engine/decision'
```

and add inside `registerIpc`, after the existing handlers:

```ts
ipcMain.handle('calc:evaluate', (_event, input: CalcInput): CalcResponse => {
  try {
    return { ok: true, result: decide(input) }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Something went wrong with the calculation'
    }
  }
})
```

- [ ] **Step 2: Expose it through the preload bridge**

In `src/preload/index.ts`, add to the imports:

```ts
import type { CalcInput, CalcResponse } from '../main/engine/decision'
```

and extend the `api` object:

```ts
const api = {
  getApiKey: (): Promise<string | null> => ipcRenderer.invoke('settings:getApiKey'),
  setApiKey: (key: string): Promise<void> => ipcRenderer.invoke('settings:setApiKey', key),
  evaluateBet: (input: CalcInput): Promise<CalcResponse> =>
    ipcRenderer.invoke('calc:evaluate', input)
}
```

In `src/preload/index.d.ts`, add the import and extend `Api`:

```ts
import { ElectronAPI } from '@electron-toolkit/preload'
import type { CalcInput, CalcResponse } from '../main/engine/decision'

interface Api {
  getApiKey(): Promise<string | null>
  setApiKey(key: string): Promise<void>
  evaluateBet(input: CalcInput): Promise<CalcResponse>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
```

- [ ] **Step 3: Create the Calculator page**

Create `src/renderer/src/pages/Calculator.tsx`:

```tsx
import { useState } from 'react'
import type { CalcResult } from '../../../main/engine/decision'

// Temporary Phase 2 page: enter a probability and odds by hand and watch
// the engine's EV / verdict / stake math work. Replaced by the real
// Analysis flow in Phase 3.
export function Calculator(): React.JSX.Element {
  const [probPct, setProbPct] = useState('')
  const [odds, setOdds] = useState('')
  const [oppOdds, setOppOdds] = useState('')
  const [bankroll, setBankroll] = useState('1000')
  const [result, setResult] = useState<CalcResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function calculate(): Promise<void> {
    setError(null)
    setResult(null)
    const response = await window.api.evaluateBet({
      pFinal: Number(probPct) / 100,
      decimalOdds: Number(odds),
      oppositeOdds: oppOdds.trim() === '' ? undefined : Number(oppOdds),
      bankroll: Number(bankroll)
    })
    if (response.ok) setResult(response.result)
    else setError(response.error)
  }

  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`
  const ready = probPct.trim() !== '' && odds.trim() !== '' && bankroll.trim() !== ''

  return (
    <div className="page">
      <h2>Calculator</h2>
      <p className="hint">
        Temporary page to see the betting math work. Enter how likely you think your side is to
        win, the bookmaker&apos;s decimal odds, and your bankroll.
      </p>

      <label htmlFor="prob">Your win probability (%)</label>
      <input id="prob" value={probPct} placeholder="55" onChange={(e) => setProbPct(e.target.value)} />

      <label htmlFor="odds">Decimal odds for your side</label>
      <input id="odds" value={odds} placeholder="2.10" onChange={(e) => setOdds(e.target.value)} />

      <label htmlFor="opp-odds">Decimal odds for the other side (optional, shows the vig)</label>
      <input
        id="opp-odds"
        value={oppOdds}
        placeholder="1.75"
        onChange={(e) => setOppOdds(e.target.value)}
      />

      <label htmlFor="bankroll">Bankroll</label>
      <input id="bankroll" value={bankroll} onChange={(e) => setBankroll(e.target.value)} />

      <button onClick={calculate} disabled={!ready}>
        Calculate
      </button>

      {error && <p className="status-error">{error}</p>}

      {result && (
        <div className="calc-result">
          <p className={result.verdict === 'BET' ? 'verdict verdict-bet' : 'verdict verdict-no-bet'}>
            {result.verdict === 'BET'
              ? `BET — stake ${result.stake.toFixed(2)}`
              : 'NO BET — you just avoided a losing bet'}
          </p>
          <p>Bookmaker&apos;s implied probability: {pct(result.impliedProbability)}</p>
          {result.vigFreeProbability !== null && result.vig !== null && (
            <p>
              After removing the bookmaker&apos;s margin (vig {pct(result.vig)}):{' '}
              {pct(result.vigFreeProbability)}
            </p>
          )}
          <p>Expected value: {pct(result.ev)} per unit staked</p>
          <p className="hint">
            Rule: bet only when expected value is at least 4%. Stake is quarter-Kelly, capped at 2%
            of bankroll.
          </p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire up navigation**

In `src/renderer/src/components/Sidebar.tsx`, change the `PageId` type and `PAGES` list:

```ts
export type PageId = 'analyze' | 'calculator' | 'bankroll' | 'track-record' | 'chat' | 'settings'

const PAGES: { id: PageId; label: string }[] = [
  { id: 'analyze', label: 'Analyze' },
  { id: 'calculator', label: 'Calculator' },
  { id: 'bankroll', label: 'Bankroll' },
  { id: 'track-record', label: 'Track Record' },
  { id: 'chat', label: 'Chat' },
  { id: 'settings', label: 'Settings' }
]
```

In `src/renderer/src/App.tsx`, add the import and route:

```tsx
import { Calculator } from './pages/Calculator'
```

and inside `<main className="content">`, after the analyze line:

```tsx
{page === 'calculator' && <Calculator />}
```

- [ ] **Step 5: Add the verdict styles**

Append to `src/renderer/src/assets/main.css`:

```css
.calc-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
}

.verdict {
  font-size: 20px;
  font-weight: 700;
}

.verdict-bet {
  color: #3fa34d;
}

.verdict-no-bet {
  color: #d68f2e;
}
```

(NO BET is amber, not red — the spec treats it as a positive outcome, not an error.)

- [ ] **Step 6: Typecheck and run the full test suite**

Run: `npm run typecheck`
Expected: both `typecheck:node` and `typecheck:web` pass with no errors.

Run: `npm test`
Expected: PASS — all engine tests plus settings-store tests.

- [ ] **Step 7: Verify in the running app**

Run: `npm run dev` (its `predev` script rebuilds better-sqlite3 for Electron — do not skip it).

Manual checks in the window:
1. Sidebar shows "Calculator"; clicking it opens the page.
2. Enter probability `55`, odds `2.10`, opposite odds `1.75`, bankroll `1000` → BET, stake `20.00` (¼-Kelly wants 35.23 but the 2% cap wins), EV `15.5%`, implied `47.6%`, vig `4.8%`, after-margin `45.5%`.
3. Enter probability `50`, odds `1.90`, bankroll `1000` → "NO BET — you just avoided a losing bet", EV `-5.0%`.
4. Enter odds `0.9` → plain-language error about decimal odds, not a crash or blank screen.

Then stop the dev process. (Note: after `npm run dev`, better-sqlite3 is on the Electron ABI; the next `npm test` rebuilds it back automatically via `pretest`.)

- [ ] **Step 8: Mark Phase 2 done in the roadmap**

In `docs/superpowers/plans/2026-07-09-phase-roadmap.md`, change:

```
## ⬜ Phase 2 — The money-math engine (the app's brain, proven correct)
```

to:

```
## ✅ Phase 2 — The money-math engine (the app's brain, proven correct)
```

and add below the "You can test" line of Phase 2:

```
**Detailed plan:** `2026-07-10-phase-2-engine.md`
```

- [ ] **Step 9: Suggest the final commits (user runs them — do NOT run git yourself)**

```bash
git add src/main/ipc.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/pages/Calculator.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx src/renderer/src/assets/main.css
git commit -m "feat: temporary Calculator page wired to the engine via IPC"
git add docs/superpowers/plans/
git commit -m "docs: Phase 2 plan and roadmap update"
```

---

## Execution notes

- **Slow network on this machine:** no new npm packages are needed for this phase — everything uses what's already installed. If anything ever does need downloading, use curl-based approaches, not Node downloaders (they stall silently here).
- **Explaining to the user (CLAUDE.md):** when executing, narrate each task in plain language — e.g. "the vig is the bookmaker's built-in fee; this code strips it out so we can see the true odds" — and at the end show the user how to try the Calculator themselves with the two worked examples from Task 6 Step 7.
