# Phase 3 — "Analyze Anything" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Type any real match in any sport plus your bookmaker's odds → a full, cited analysis: BET side + safe stake, or NO BET.

**Architecture:** Two Claude-with-web-search calls per analysis — a *researcher* (facts → schema-validated StatsBundle) and a *semantic analyst* (expert opinion → schema-validated verdict). All numbers then flow through the existing pure engine (`statsProbability` → `blendProbabilities` → new `decideMatch`). The pipeline lives in the Electron main process behind one IPC call; the renderer gets a new Analyze page with a VerdictCard and EvidenceTrail.

**Tech Stack:** Electron main process (Node), `@anthropic-ai/sdk` (web_search server tool), `zod` for schema validation, existing Vitest + React + TypeScript setup.

## Global Constraints

- In-app model: `claude-sonnet-5` — exact string, defined once as a constant (from CLAUDE.md key decisions; do not re-ask).
- **Never run `git` or `gh` commands.** At each commit point, tell the user the exact commands to type and what they do in plain words (CLAUDE.md rule — the user is learning git).
- The user is new to programming: before each task, explain in 1–2 plain sentences what is being built and why it matters for the app.
- Money math is TDD: failing test first, then implementation (`decideMatch`, `semanticProbability`).
- Every AI output is schema-validated (zod) before the app trusts it; invalid output → one retry with feedback, then a plain-language error.
- Errors are never silent — every failure path ends in a plain-language message shown in the UI.
- Web-search tool type for `claude-sonnet-5` is `web_search_20260209` (name `web_search`). Do not use the older `web_search_20250305`.
- Do NOT pass `temperature`/`top_p`/`top_k` or `thinking` config to `claude-sonnet-5` — non-default sampling params are rejected with a 400; adaptive thinking is on by default.
- No analysis persistence in this phase (that's Phase 4). YAGNI.
- Run single test files with `npx vitest run <path>` (fast); run the full suite with `npm test` (its `pretest` rebuilds better-sqlite3 for Node — needed by the settings test). Note from memory: package downloads on this machine can stall silently; if `npm install` hangs >3 minutes with no output, cancel and retry.

---

### Task 1: Dependencies + shared adapter types

**Files:**
- Modify: `package.json` (via `npm install`)
- Create: `src/main/adapters/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MatchDescription`, `FactorCategory`, `ResearchFactor`, `ResearchResult`, `CATEGORY_WEIGHTS` — used by Tasks 5, 6, 7, 8, 9.

- [ ] **Step 1: Install the two new building blocks**

`@anthropic-ai/sdk` is the official library for talking to Claude; `zod` checks that whatever the AI returns has exactly the shape we expect before we trust it.

Run: `npm install @anthropic-ai/sdk zod`

Expected: both appear under `"dependencies"` in `package.json`. (`postinstall` will rebuild better-sqlite3 for Electron — that's normal.) If it stalls silently >3 min, cancel and re-run.

- [ ] **Step 2: Create the shared types file**

Create `src/main/adapters/types.ts`:

```typescript
// Shared shapes for the app's single universal analyzer.
// A "factor" is one researched fact scored for how much it favors side A.

export interface MatchDescription {
  sideA: string // e.g. "Alcaraz"
  sideB: string // e.g. "Sinner"
  context: string // e.g. "Wimbledon semi-final 2026" — may be ''
}

export type FactorCategory = 'form' | 'ranking' | 'headToHead' | 'context'

// The AI supplies bounded values and evidence; the CODE owns the weights
// and all math. Weights are fixed here, per category.
export const CATEGORY_WEIGHTS: Record<FactorCategory, number> = {
  form: 3,
  ranking: 3,
  headToHead: 2,
  context: 2
}

export interface ResearchFactor {
  category: FactorCategory
  name: string // short label, e.g. "Recent form (last 10 matches)"
  value: number // -1 (strongly favors side B) .. +1 (strongly favors side A)
  evidence: string // one-sentence factual summary
  sources: string[] // URLs the fact came from
}

export interface ResearchResult {
  factors: ResearchFactor[]
  dataQuality: 'good' | 'partial' | 'poor'
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run typecheck:node`
Expected: exits 0, no errors.

- [ ] **Step 4: Suggest the commit**

Tell the user to run (each explained: `git add` stages the changed files, `git commit` saves a named snapshot):

```
git add package.json package-lock.json src/main/adapters/types.ts
git commit -m "feat: add Anthropic SDK + zod and shared adapter types for Phase 3"
```

---

### Task 2: JSON extraction + validated-request helper (schema-validation core)

**Files:**
- Create: `src/main/semantic/json.ts`
- Test: `src/main/semantic/json.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces:
  - `extractJson(text: string): unknown` — throws `Error` if no JSON object found.
  - `requestValidated<T>(call: (feedback?: string) => Promise<string>, schema: ZodType<T>): Promise<T>` — calls once; on invalid JSON/schema calls once more with a feedback string; throws plain-language `Error` if still invalid. Used by Tasks 6 and 7.

- [ ] **Step 1: Write the failing tests**

Create `src/main/semantic/json.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { extractJson, requestValidated } from './json'

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('parses JSON inside a fenced code block with prose around it', () => {
    const text = 'Here is the result:\n```json\n{"a": 1, "b": [2, 3]}\n```\nDone.'
    expect(extractJson(text)).toEqual({ a: 1, b: [2, 3] })
  })

  it('parses the outermost object when prose surrounds raw JSON', () => {
    const text = 'Based on my research: {"lean": "A", "note": "uses {braces} in strings? no"} end'
    expect(extractJson('prefix {"x": {"y": 1}} suffix')).toEqual({ x: { y: 1 } })
    void text
  })

  it('throws a plain-language error when there is no JSON', () => {
    expect(() => extractJson('sorry, I could not find anything')).toThrow(/JSON/)
  })
})

const schema = z.object({ lean: z.enum(['A', 'B']), confidence: z.number().min(0).max(1) })

describe('requestValidated', () => {
  it('returns the parsed object when the first reply is valid', async () => {
    const result = await requestValidated(async () => '{"lean":"A","confidence":0.7}', schema)
    expect(result).toEqual({ lean: 'A', confidence: 0.7 })
  })

  it('retries once with feedback when the first reply is invalid', async () => {
    const calls: (string | undefined)[] = []
    const result = await requestValidated(async (feedback) => {
      calls.push(feedback)
      return calls.length === 1 ? '{"lean":"maybe"}' : '{"lean":"B","confidence":0.4}'
    }, schema)
    expect(result).toEqual({ lean: 'B', confidence: 0.4 })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toBeUndefined()
    expect(calls[1]).toMatch(/confidence|lean/i) // feedback names what was wrong
  })

  it('throws a plain-language error when both replies are invalid', async () => {
    await expect(requestValidated(async () => 'not json at all', schema)).rejects.toThrow(
      /valid|expected/i
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/semantic/json.test.ts`
Expected: FAIL — cannot resolve `./json`.

- [ ] **Step 3: Write the implementation**

Create `src/main/semantic/json.ts`:

```typescript
import type { z } from 'zod'

// The AI is asked to reply with a JSON object, but models sometimes wrap it
// in prose or a ```json fence. This finds and parses the first object.
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  if (start === -1) throw new Error('The AI reply contained no JSON object')
  // Walk to the matching closing brace (string-aware).
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]
    if (escaped) {
      escaped = false
    } else if (ch === '\\') {
      escaped = true
    } else if (ch === '"') {
      inString = !inString
    } else if (!inString) {
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) return JSON.parse(candidate.slice(start, i + 1))
      }
    }
  }
  throw new Error('The AI reply contained an incomplete JSON object')
}

// Ask -> validate -> (if invalid) ask once more with feedback -> validate.
// The app never trusts AI output that hasn't passed the schema.
export async function requestValidated<T>(
  call: (feedback?: string) => Promise<string>,
  schema: z.ZodType<T>
): Promise<T> {
  let feedback: string | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await call(feedback)
    try {
      const parsed = schema.safeParse(extractJson(reply))
      if (parsed.success) return parsed.data
      feedback =
        'Your previous reply did not match the required JSON schema. Problems: ' +
        parsed.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ') +
        '. Reply again with ONLY a corrected JSON object.'
    } catch (err) {
      feedback =
        'Your previous reply was not parseable JSON (' +
        (err instanceof Error ? err.message : 'unknown error') +
        '). Reply again with ONLY a valid JSON object.'
    }
  }
  throw new Error('The AI did not return a valid, expected answer after a retry')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/semantic/json.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Suggest the commit**

Tell the user to run:

```
git add src/main/semantic/json.ts src/main/semantic/json.test.ts
git commit -m "feat: JSON extraction and schema-validated AI requests with one retry"
```

---

### Task 3: Match decision engine function (money math — TDD)

**Files:**
- Create: `src/main/engine/match.ts`
- Test: `src/main/engine/match.test.ts`

**Interfaces:**
- Consumes: `expectedValue`, `removeVig` from `./odds`; `kellyStake` from `./kelly`.
- Produces:
  - `interface MatchDecisionInput { pA: number; oddsA: number; oddsB: number; bankroll: number; evThreshold?: number; kellyFraction?: number; capFraction?: number }`
  - `interface MatchVerdict { side: 'A' | 'B' | null; stake: number; evA: number; evB: number; impliedA: number; impliedB: number; vigFreeA: number; vig: number }`
  - `decideMatch(input: MatchDecisionInput): MatchVerdict` — used by Task 8.

- [ ] **Step 1: Write the failing tests (hand-computed cases)**

Create `src/main/engine/match.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/engine/match.test.ts`
Expected: FAIL — cannot resolve `./match`.

- [ ] **Step 3: Write the implementation**

Create `src/main/engine/match.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/engine/match.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Suggest the commit**

Tell the user to run:

```
git add src/main/engine/match.ts src/main/engine/match.test.ts
git commit -m "feat: two-sided match decision (TDD) - picks best side or NO BET"
```

---

### Task 4: Claude web-search caller

**Files:**
- Create: `src/main/semantic/claude.ts`
- Test: `src/main/semantic/claude.test.ts`

**Interfaces:**
- Consumes: `@anthropic-ai/sdk`.
- Produces:
  - `DEFAULT_MODEL = 'claude-sonnet-5'`
  - `type ClaudeCaller = (system: string, user: string) => Promise<string>` — returns the model's full text reply. Used by Tasks 6 and 7.
  - `createWebSearchCaller(apiKey: string): ClaudeCaller`
  - `collectSearchedText(create: CreateFn, params: {...}): Promise<string>` — the testable loop (handles `pause_turn`).
  - `explainApiError(err: unknown): string` — plain-language message for the UI. Used by Task 8.

- [ ] **Step 1: Write the failing tests (fake API, no network)**

The `pause_turn` loop is the subtle part: when Claude pauses mid web-search, we must re-send and continue, and join all the text pieces. Create `src/main/semantic/claude.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { collectSearchedText, explainApiError } from './claude'

type FakeResponse = { stop_reason: string; content: { type: string; text?: string }[] }

function fakeCreate(responses: FakeResponse[]): {
  create: (params: unknown) => Promise<FakeResponse>
  calls: unknown[]
} {
  const calls: unknown[] = []
  let i = 0
  return {
    calls,
    create: async (params) => {
      calls.push(params)
      return responses[i++]
    }
  }
}

describe('collectSearchedText', () => {
  it('returns joined text blocks from a single completed response', async () => {
    const { create } = fakeCreate([
      {
        stop_reason: 'end_turn',
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'web_search_tool_result' },
          { type: 'text', text: 'world' }
        ]
      }
    ])
    const text = await collectSearchedText(create as never, {
      model: 'claude-sonnet-5',
      system: 's',
      user: 'u'
    })
    expect(text).toBe('Hello world')
  })

  it('resumes after pause_turn and joins text across responses', async () => {
    const { create, calls } = fakeCreate([
      { stop_reason: 'pause_turn', content: [{ type: 'text', text: 'part1 ' }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'part2' }] }
    ])
    const text = await collectSearchedText(create as never, {
      model: 'claude-sonnet-5',
      system: 's',
      user: 'u'
    })
    expect(text).toBe('part1 part2')
    expect(calls).toHaveLength(2)
  })

  it('gives up after 5 pauses with a plain error', async () => {
    const paused = { stop_reason: 'pause_turn', content: [] as { type: string }[] }
    const { create } = fakeCreate(Array(6).fill(paused))
    await expect(
      collectSearchedText(create as never, { model: 'claude-sonnet-5', system: 's', user: 'u' })
    ).rejects.toThrow(/too long/i)
  })

  it('reports a refusal in plain language', async () => {
    const { create } = fakeCreate([{ stop_reason: 'refusal', content: [] }])
    await expect(
      collectSearchedText(create as never, { model: 'claude-sonnet-5', system: 's', user: 'u' })
    ).rejects.toThrow(/declined/i)
  })
})

describe('explainApiError', () => {
  it('explains an invalid API key', () => {
    const err = new Anthropic.AuthenticationError(
      401,
      { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
      'invalid x-api-key',
      new Headers()
    )
    expect(explainApiError(err)).toMatch(/API key/i)
  })

  it('passes through plain Errors and stringifies the rest', () => {
    expect(explainApiError(new Error('boom'))).toBe('boom')
    expect(explainApiError('weird')).toMatch(/wrong/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/semantic/claude.test.ts`
Expected: FAIL — cannot resolve `./claude`.

- [ ] **Step 3: Write the implementation**

Create `src/main/semantic/claude.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk'

export const DEFAULT_MODEL = 'claude-sonnet-5'

// One function type both AI steps depend on, so tests can inject fakes.
export type ClaudeCaller = (system: string, user: string) => Promise<string>

interface SearchParams {
  model: string
  system: string
  user: string
}

type CreateFn = (params: {
  model: string
  max_tokens: number
  system: string
  messages: { role: 'user' | 'assistant'; content: unknown }[]
  tools: { type: string; name: string; max_uses?: number }[]
}) => Promise<{ stop_reason: string | null; content: { type: string; text?: string }[] }>

// Runs one Claude request with the web_search server tool. Web searches run
// on Anthropic's side; if the turn pauses (stop_reason 'pause_turn') we
// re-send to let it continue, and join all text the model produced.
export async function collectSearchedText(create: CreateFn, params: SearchParams): Promise<string> {
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [
    { role: 'user', content: params.user }
  ]
  let text = ''
  for (let round = 0; round < 6; round++) {
    const response = await create({
      model: params.model,
      max_tokens: 8000,
      system: params.system,
      messages,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }]
    })
    for (const block of response.content) {
      if (block.type === 'text' && block.text) text += block.text
    }
    if (response.stop_reason === 'refusal') {
      throw new Error('The AI declined to answer this request')
    }
    if (response.stop_reason !== 'pause_turn') return text
    messages.push({ role: 'assistant', content: response.content })
  }
  throw new Error('The research took too long and was stopped — please try again')
}

export function createWebSearchCaller(apiKey: string, model = DEFAULT_MODEL): ClaudeCaller {
  const client = new Anthropic({ apiKey, timeout: 10 * 60 * 1000, maxRetries: 2 })
  return (system, user) =>
    collectSearchedText((p) => client.messages.create(p as never) as never, {
      model,
      system,
      user
    })
}

// Turns SDK errors into sentences a non-programmer can act on.
export function explainApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'Your Anthropic API key was rejected. Open Settings and check that the key is correct.'
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return 'Your Anthropic account does not allow this request — check your plan and credits at console.anthropic.com.'
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'The AI service is rate-limiting requests right now. Wait a minute and try again.'
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the AI service — check your internet connection and try again.'
  }
  if (err instanceof Anthropic.APIError) {
    return `The AI service returned an error (${err.status ?? 'unknown'}). Try again in a moment.`
  }
  if (err instanceof Error) return err.message
  return 'Something went wrong during the analysis'
}
```

Note: check `instanceof Anthropic.APIConnectionError` **before** `Anthropic.APIError` in any reordering — in the TypeScript SDK it subclasses `APIError`. (The order above already handles the specific classes first.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/semantic/claude.test.ts`
Expected: PASS (6 tests). If the `AuthenticationError` constructor signature errors, construct it via `Object.create(Anthropic.AuthenticationError.prototype)` in the test instead — the assertion is about the mapping, not the constructor.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck:node`
Expected: exits 0.

- [ ] **Step 6: Suggest the commit**

```
git add src/main/semantic/claude.ts src/main/semantic/claude.test.ts
git commit -m "feat: Claude web-search caller with pause handling and plain-language errors"
```

---

### Task 5: Universal researcher (facts → StatsBundle → factors)

**Files:**
- Create: `src/main/adapters/universal/researcher.ts`
- Test: `src/main/adapters/universal/researcher.test.ts`

**Interfaces:**
- Consumes: `requestValidated` (Task 2), `ClaudeCaller` (Task 4), types + `CATEGORY_WEIGHTS` (Task 1), `Factor` from `../../engine/probability`.
- Produces:
  - `researchMatch(caller: ClaudeCaller, match: MatchDescription): Promise<ResearchResult>`
  - `toEngineFactors(factors: ResearchFactor[]): Factor[]` — attaches code-owned weights. Used by Task 8.

- [ ] **Step 1: Write the failing tests**

Create `src/main/adapters/universal/researcher.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { researchMatch, toEngineFactors } from './researcher'
import { CATEGORY_WEIGHTS } from '../types'

const validReply = JSON.stringify({
  factors: [
    {
      category: 'form',
      name: 'Recent form',
      value: 0.5,
      evidence: 'A won 8 of last 10; B won 5 of last 10',
      sources: ['https://example.com/results']
    },
    {
      category: 'ranking',
      name: 'World ranking',
      value: 0.2,
      evidence: 'A ranked #2, B ranked #3',
      sources: ['https://example.com/rankings']
    }
  ],
  dataQuality: 'good'
})

describe('researchMatch', () => {
  it('returns a validated ResearchResult from a good AI reply', async () => {
    const result = await researchMatch(async () => validReply, {
      sideA: 'Alcaraz',
      sideB: 'Sinner',
      context: 'Wimbledon SF'
    })
    expect(result.dataQuality).toBe('good')
    expect(result.factors).toHaveLength(2)
    expect(result.factors[0].value).toBe(0.5)
  })

  it('includes both side names in the prompt sent to the AI', async () => {
    let seenUser = ''
    await researchMatch(
      async (_system, user) => {
        seenUser = user ?? ''
        return validReply
      },
      { sideA: 'Alcaraz', sideB: 'Sinner', context: 'Wimbledon SF' }
    )
    expect(seenUser).toContain('Alcaraz')
    expect(seenUser).toContain('Sinner')
    expect(seenUser).toContain('Wimbledon SF')
  })

  it('rejects out-of-range factor values via the schema (after retry)', async () => {
    const bad = JSON.stringify({
      factors: [
        { category: 'form', name: 'x', value: 3, evidence: 'e', sources: [] }
      ],
      dataQuality: 'good'
    })
    await expect(
      researchMatch(async () => bad, { sideA: 'A', sideB: 'B', context: '' })
    ).rejects.toThrow(/valid/i)
  })
})

describe('toEngineFactors', () => {
  it('attaches the fixed code-owned weight per category', () => {
    const engine = toEngineFactors([
      { category: 'form', name: 'f', value: 0.5, evidence: 'e', sources: [] },
      { category: 'headToHead', name: 'h', value: -0.2, evidence: 'e', sources: [] }
    ])
    expect(engine).toEqual([
      { name: 'f', weight: CATEGORY_WEIGHTS.form, value: 0.5 },
      { name: 'h', weight: CATEGORY_WEIGHTS.headToHead, value: -0.2 }
    ])
  })
})
```

Note the caller fake has signature `(system, user) => Promise<string>` matching `ClaudeCaller`. The single-argument fakes (`async () => validReply`) are fine — extra params are just unused.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/adapters/universal/researcher.test.ts`
Expected: FAIL — cannot resolve `./researcher`.

- [ ] **Step 3: Write the implementation**

Create `src/main/adapters/universal/researcher.ts`:

```typescript
import { z } from 'zod'
import { requestValidated } from '../../semantic/json'
import type { ClaudeCaller } from '../../semantic/claude'
import type { Factor } from '../../engine/probability'
import {
  CATEGORY_WEIGHTS,
  type MatchDescription,
  type ResearchFactor,
  type ResearchResult
} from '../types'

const researchSchema = z.object({
  factors: z
    .array(
      z.object({
        category: z.enum(['form', 'ranking', 'headToHead', 'context']),
        name: z.string().min(1),
        value: z.number().min(-1).max(1),
        evidence: z.string().min(1),
        sources: z.array(z.string())
      })
    )
    .min(1),
  dataQuality: z.enum(['good', 'partial', 'poor'])
})

const SYSTEM = `You are a sports research assistant inside a betting-risk tool.
Research ONLY verifiable facts about the upcoming match using web search:
recent form, rankings/ratings, head-to-head record, and context (venue,
injuries, roster changes, surface, LAN/online). Do NOT predict a winner and
do NOT consider betting odds. Score each factor for how much the FACTS favor
side A: +1 strongly favors A, -1 strongly favors B, 0 neutral. Be conservative:
if data is thin, use small values and set dataQuality accordingly.
Reply with ONLY a JSON object matching:
{"factors":[{"category":"form"|"ranking"|"headToHead"|"context","name":string,
"value":number(-1..1),"evidence":string,"sources":[url strings]}],
"dataQuality":"good"|"partial"|"poor"}`

export async function researchMatch(
  caller: ClaudeCaller,
  match: MatchDescription
): Promise<ResearchResult> {
  const user = `Match: ${match.sideA} (side A) vs ${match.sideB} (side B).${
    match.context ? ` Context: ${match.context}.` : ''
  } Research the factual record and return the JSON object.`
  return requestValidated(
    (feedback) => caller(SYSTEM, feedback ? `${user}\n\n${feedback}` : user),
    researchSchema
  )
}

// The AI supplied bounded values; the code owns the weights.
export function toEngineFactors(factors: ResearchFactor[]): Factor[] {
  return factors.map((f) => ({
    name: f.name,
    weight: CATEGORY_WEIGHTS[f.category],
    value: f.value
  }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/adapters/universal/researcher.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Suggest the commit**

```
git add src/main/adapters/universal/
git commit -m "feat: universal research adapter - web search facts to validated factors"
```

---

### Task 6: Semantic analyst (expert opinion → pSem)

**Files:**
- Create: `src/main/semantic/analyst.ts`
- Test: `src/main/semantic/analyst.test.ts`

**Interfaces:**
- Consumes: `requestValidated` (Task 2), `ClaudeCaller` (Task 4), `MatchDescription` (Task 1).
- Produces:
  - `interface ExpertVerdict { lean: 'A' | 'B' | 'none'; confidence: number; keyFactors: string[]; sources: { url: string; title: string }[] }`
  - `semanticProbability(verdict: ExpertVerdict): number` — pure money-adjacent math, TDD.
  - `gatherExpertOpinion(caller: ClaudeCaller, match: MatchDescription): Promise<ExpertVerdict>` — used by Task 8.

- [ ] **Step 1: Write the failing tests**

Create `src/main/semantic/analyst.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { gatherExpertOpinion, semanticProbability } from './analyst'

// semanticProbability maps (lean, confidence) onto 0..1:
//   none        -> 0.5 exactly
//   A, conf c   -> 0.5 + 0.5*c   (A with full confidence -> 1.0)
//   B, conf c   -> 0.5 - 0.5*c
describe('semanticProbability', () => {
  const base = { keyFactors: ['x'], sources: [] }
  it('is 0.5 when experts have no lean', () => {
    expect(semanticProbability({ lean: 'none', confidence: 0.9, ...base })).toBe(0.5)
  })
  it('leans toward A proportionally to confidence', () => {
    expect(semanticProbability({ lean: 'A', confidence: 0.6, ...base })).toBeCloseTo(0.8, 10)
  })
  it('leans toward B proportionally to confidence', () => {
    expect(semanticProbability({ lean: 'B', confidence: 0.4, ...base })).toBeCloseTo(0.3, 10)
  })
})

const validReply = JSON.stringify({
  lean: 'A',
  confidence: 0.55,
  keyFactors: ['Most previews favor A on grass'],
  sources: [{ url: 'https://example.com/preview', title: 'Match preview' }]
})

describe('gatherExpertOpinion', () => {
  it('returns a validated verdict from a good AI reply', async () => {
    const v = await gatherExpertOpinion(async () => validReply, {
      sideA: 'Alcaraz',
      sideB: 'Sinner',
      context: ''
    })
    expect(v.lean).toBe('A')
    expect(v.sources[0].title).toBe('Match preview')
  })

  it('rejects confidence outside 0..1 (after retry)', async () => {
    const bad = JSON.stringify({ lean: 'A', confidence: 7, keyFactors: ['x'], sources: [] })
    await expect(
      gatherExpertOpinion(async () => bad, { sideA: 'A', sideB: 'B', context: '' })
    ).rejects.toThrow(/valid/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/semantic/analyst.test.ts`
Expected: FAIL — cannot resolve `./analyst`.

- [ ] **Step 3: Write the implementation**

Create `src/main/semantic/analyst.ts`:

```typescript
import { z } from 'zod'
import { requestValidated } from './json'
import type { ClaudeCaller } from './claude'
import type { MatchDescription } from '../adapters/types'

export interface ExpertVerdict {
  lean: 'A' | 'B' | 'none'
  confidence: number // 0..1 — how united/strong expert opinion is
  keyFactors: string[]
  sources: { url: string; title: string }[]
}

const verdictSchema = z.object({
  lean: z.enum(['A', 'B', 'none']),
  confidence: z.number().min(0).max(1),
  keyFactors: z.array(z.string()).min(1),
  sources: z.array(z.object({ url: z.string(), title: z.string() }))
})

// Maps expert lean onto a probability for side A. The blend step later
// bounds this signal to ±10 points, so it can only NUDGE the stats.
export function semanticProbability(verdict: ExpertVerdict): number {
  if (verdict.lean === 'none') return 0.5
  const direction = verdict.lean === 'A' ? 1 : -1
  return 0.5 + direction * 0.5 * verdict.confidence
}

const SYSTEM = `You are gathering EXPERT and COMMUNITY OPINION about an upcoming
match for a betting-risk tool. Use web search to find previews, analyst picks,
and informed community consensus from reputable sources. You are summarizing
what OTHERS think — not making your own prediction. If opinion is split or
scarce, lean "none" or use low confidence. Cite every source you used.
Reply with ONLY a JSON object matching:
{"lean":"A"|"B"|"none","confidence":number(0..1),
"keyFactors":[strings],"sources":[{"url":string,"title":string}]}`

export async function gatherExpertOpinion(
  caller: ClaudeCaller,
  match: MatchDescription
): Promise<ExpertVerdict> {
  const user = `Match: ${match.sideA} (side A) vs ${match.sideB} (side B).${
    match.context ? ` Context: ${match.context}.` : ''
  } Summarize expert/community opinion and return the JSON object.`
  return requestValidated(
    (feedback) => caller(SYSTEM, feedback ? `${user}\n\n${feedback}` : user),
    verdictSchema
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/semantic/analyst.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Suggest the commit**

```
git add src/main/semantic/analyst.ts src/main/semantic/analyst.test.ts
git commit -m "feat: semantic analyst - expert opinion to bounded probability signal"
```

---

### Task 7: Analysis pipeline (adapter → engine → verdict, with degradation)

**Files:**
- Create: `src/main/analysis/pipeline.ts`
- Test: `src/main/analysis/pipeline.test.ts`

**Interfaces:**
- Consumes: everything above — `researchMatch`/`toEngineFactors`, `gatherExpertOpinion`/`semanticProbability`, `statsProbability`, `blendProbabilities`, `decideMatch`.
- Produces (used by Tasks 8 and 9):

```typescript
export interface AnalysisInput {
  sideA: string
  sideB: string
  context: string
  oddsA: number
  oddsB: number
  bankroll: number
}

export interface AnalysisResult {
  match: MatchDescription
  pStats: number
  pSem: number | null // null when the expert-opinion step failed
  pFinal: number
  factors: (ResearchFactor & { weight: number })[]
  dataQuality: 'good' | 'partial' | 'poor'
  expert: ExpertVerdict | null
  verdict: MatchVerdict
  confidence: 'medium' | 'low' // universal adapter = medium; degraded/poor data = low
  warnings: string[]
}

export type AnalysisResponse = { ok: true; result: AnalysisResult } | { ok: false; error: string }

export interface PipelineDeps {
  research: (match: MatchDescription) => Promise<ResearchResult>
  expertOpinion: (match: MatchDescription) => Promise<ExpertVerdict>
}

export async function analyzeMatch(input: AnalysisInput, deps: PipelineDeps): Promise<AnalysisResult>
```

- [ ] **Step 1: Write the failing tests**

Create `src/main/analysis/pipeline.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { analyzeMatch } from './pipeline'
import type { ResearchResult } from '../adapters/types'
import type { ExpertVerdict } from '../semantic/analyst'

const research: ResearchResult = {
  factors: [
    { category: 'form', name: 'Form', value: 0.5, evidence: 'e', sources: ['https://x'] },
    { category: 'ranking', name: 'Rank', value: 0.3, evidence: 'e', sources: [] }
  ],
  dataQuality: 'good'
}
const expert: ExpertVerdict = {
  lean: 'A',
  confidence: 0.6,
  keyFactors: ['previews favor A'],
  sources: [{ url: 'https://y', title: 'preview' }]
}
const input = {
  sideA: 'A-team',
  sideB: 'B-team',
  context: '',
  oddsA: 2.4,
  oddsB: 1.6,
  bankroll: 1000
}

// Hand-computed pStats: weights form=3, ranking=3 -> score=(3*0.5+3*0.3)/6=0.4
//   pStats = 0.5 + 0.5*0.4 = 0.70
// pSem = 0.5 + 0.5*0.6 = 0.80 ; blend raw = 0.7*0.7 + 0.3*0.8 = 0.73 (shift 0.03 < 0.10)
// pFinal = 0.73 ; evA = 0.73*2.4 - 1 = 0.752 -> BET A
describe('analyzeMatch', () => {
  it('runs the full chain: research -> stats -> expert -> blend -> verdict', async () => {
    const result = await analyzeMatch(input, {
      research: async () => research,
      expertOpinion: async () => expert
    })
    expect(result.pStats).toBeCloseTo(0.7, 10)
    expect(result.pSem).toBeCloseTo(0.8, 10)
    expect(result.pFinal).toBeCloseTo(0.73, 10)
    expect(result.verdict.side).toBe('A')
    expect(result.confidence).toBe('medium')
    expect(result.warnings).toHaveLength(0)
    expect(result.factors[0].weight).toBe(3) // code-owned weight attached for display
  })

  it('degrades to stats-only when the expert step fails (never silent)', async () => {
    const result = await analyzeMatch(input, {
      research: async () => research,
      expertOpinion: async () => {
        throw new Error('search down')
      }
    })
    expect(result.pSem).toBeNull()
    expect(result.pFinal).toBeCloseTo(result.pStats, 10)
    expect(result.confidence).toBe('low')
    expect(result.warnings.join(' ')).toMatch(/expert/i)
  })

  it('labels poor research data as low confidence with a warning', async () => {
    const result = await analyzeMatch(input, {
      research: async () => ({ ...research, dataQuality: 'poor' as const }),
      expertOpinion: async () => expert
    })
    expect(result.confidence).toBe('low')
    expect(result.warnings.join(' ')).toMatch(/limited|thin|poor/i)
  })

  it('fails loudly when research itself fails', async () => {
    await expect(
      analyzeMatch(input, {
        research: async () => {
          throw new Error('no internet')
        },
        expertOpinion: async () => expert
      })
    ).rejects.toThrow(/no internet/)
  })

  it('validates odds before doing any AI work', async () => {
    let researchCalled = false
    await expect(
      analyzeMatch(
        { ...input, oddsA: 0.9 },
        {
          research: async () => {
            researchCalled = true
            return research
          },
          expertOpinion: async () => expert
        }
      )
    ).rejects.toThrow(/odds/i)
    expect(researchCalled).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/analysis/pipeline.test.ts`
Expected: FAIL — cannot resolve `./pipeline`.

- [ ] **Step 3: Write the implementation**

Create `src/main/analysis/pipeline.ts`:

```typescript
import { statsProbability } from '../engine/probability'
import { blendProbabilities } from '../engine/blend'
import { decideMatch, type MatchVerdict } from '../engine/match'
import { assertOdds } from '../engine/odds'
import { assertBankroll } from '../engine/kelly'
import { toEngineFactors } from '../adapters/universal/researcher'
import { semanticProbability, type ExpertVerdict } from '../semantic/analyst'
import {
  CATEGORY_WEIGHTS,
  type MatchDescription,
  type ResearchFactor,
  type ResearchResult
} from '../adapters/types'

export interface AnalysisInput {
  sideA: string
  sideB: string
  context: string
  oddsA: number
  oddsB: number
  bankroll: number
}

export interface AnalysisResult {
  match: MatchDescription
  pStats: number
  pSem: number | null
  pFinal: number
  factors: (ResearchFactor & { weight: number })[]
  dataQuality: 'good' | 'partial' | 'poor'
  expert: ExpertVerdict | null
  verdict: MatchVerdict
  confidence: 'medium' | 'low'
  warnings: string[]
}

export type AnalysisResponse = { ok: true; result: AnalysisResult } | { ok: false; error: string }

export interface PipelineDeps {
  research: (match: MatchDescription) => Promise<ResearchResult>
  expertOpinion: (match: MatchDescription) => Promise<ExpertVerdict>
}

// The full analysis chain. The AI steps only READ the world; every number
// that touches money comes from the tested engine functions.
export async function analyzeMatch(
  input: AnalysisInput,
  deps: PipelineDeps
): Promise<AnalysisResult> {
  assertOdds(input.oddsA)
  assertOdds(input.oddsB)
  assertBankroll(input.bankroll)

  const match: MatchDescription = {
    sideA: input.sideA,
    sideB: input.sideB,
    context: input.context
  }
  const warnings: string[] = []

  // Step 1: facts (required — without facts there is nothing to analyze)
  const research = await deps.research(match)
  const pStats = statsProbability(toEngineFactors(research.factors))

  // Step 2: expert opinion (optional — degrade with a visible warning)
  let expert: ExpertVerdict | null = null
  let pSem: number | null = null
  try {
    expert = await deps.expertOpinion(match)
    pSem = semanticProbability(expert)
  } catch (err) {
    warnings.push(
      'Expert-opinion research failed (' +
        (err instanceof Error ? err.message : 'unknown error') +
        ') — this verdict uses statistics only.'
    )
  }

  // Step 3: blend (bounded ±10 points) and decide (EV gate + quarter-Kelly)
  const pFinal = pSem === null ? pStats : blendProbabilities(pStats, pSem)
  const verdict = decideMatch({
    pA: pFinal,
    oddsA: input.oddsA,
    oddsB: input.oddsB,
    bankroll: input.bankroll
  })

  if (research.dataQuality === 'poor') {
    warnings.push('The research found only limited data for this match — treat with extra caution.')
  }
  const confidence: 'medium' | 'low' =
    pSem === null || research.dataQuality === 'poor' ? 'low' : 'medium'

  return {
    match,
    pStats,
    pSem,
    pFinal,
    factors: research.factors.map((f) => ({ ...f, weight: CATEGORY_WEIGHTS[f.category] })),
    dataQuality: research.dataQuality,
    expert,
    verdict,
    confidence,
    warnings
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/analysis/pipeline.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Suggest the commit**

```
git add src/main/analysis/
git commit -m "feat: analysis pipeline - research + opinion + engine with visible degradation"
```

---

### Task 8: IPC wiring + preload (renderer can trigger an analysis)

**Files:**
- Create: `src/main/store/apiKey.ts` (extract existing encrypt/decrypt logic)
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

**Interfaces:**
- Consumes: `analyzeMatch` + types (Task 7), `createWebSearchCaller`/`explainApiError` (Task 4), `researchMatch` (Task 5), `gatherExpertOpinion` (Task 6), `SettingsStore`.
- Produces:
  - IPC channel `'analysis:run'` taking `AnalysisInput`, returning `AnalysisResponse`.
  - `window.api.analyzeMatch(input: AnalysisInput): Promise<AnalysisResponse>` for the renderer.
  - `readApiKey(settings): string | null`, `writeApiKey(settings, key): void` in `store/apiKey.ts`.

- [ ] **Step 1: Extract API-key encryption into its own module**

Create `src/main/store/apiKey.ts` (logic moved verbatim from `ipc.ts` so the pipeline can also read the key):

```typescript
import { safeStorage } from 'electron'
import type { SettingsStore } from './settings'

const API_KEY = 'anthropicApiKey'

export function readApiKey(settings: SettingsStore): string | null {
  const stored = settings.get(API_KEY)
  if (stored === null) return null
  if (!safeStorage.isEncryptionAvailable()) return stored
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return null // stored value unreadable (e.g. different user profile) — treat as unset
  }
}

export function writeApiKey(settings: SettingsStore, key: string): void {
  const value = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(key).toString('base64')
    : key
  settings.set(API_KEY, value)
}
```

- [ ] **Step 2: Rewrite `src/main/ipc.ts` to use it and add the analysis handler**

Replace the full contents of `src/main/ipc.ts` with:

```typescript
import { ipcMain } from 'electron'
import type { SettingsStore } from './store/settings'
import { readApiKey, writeApiKey } from './store/apiKey'
import { decide, type CalcInput, type CalcResponse } from './engine/decision'
import { analyzeMatch, type AnalysisInput, type AnalysisResponse } from './analysis/pipeline'
import { createWebSearchCaller, explainApiError } from './semantic/claude'
import { researchMatch } from './adapters/universal/researcher'
import { gatherExpertOpinion } from './semantic/analyst'

export function registerIpc(settings: SettingsStore): void {
  ipcMain.handle('settings:getApiKey', () => readApiKey(settings))

  ipcMain.handle('settings:setApiKey', (_event, key: string) => {
    writeApiKey(settings, key)
  })

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

  ipcMain.handle(
    'analysis:run',
    async (_event, input: AnalysisInput): Promise<AnalysisResponse> => {
      const apiKey = readApiKey(settings)
      if (!apiKey) {
        return {
          ok: false,
          error:
            'No Anthropic API key is saved yet. Open Settings, paste your API key, and save it — then try the analysis again.'
        }
      }
      const caller = createWebSearchCaller(apiKey)
      try {
        const result = await analyzeMatch(input, {
          research: (match) => researchMatch(caller, match),
          expertOpinion: (match) => gatherExpertOpinion(caller, match)
        })
        return { ok: true, result }
      } catch (err) {
        return { ok: false, error: explainApiError(err) }
      }
    }
  )
}
```

- [ ] **Step 3: Expose it in the preload bridge**

In `src/preload/index.ts`, add to the imports:

```typescript
import type { AnalysisInput, AnalysisResponse } from '../main/analysis/pipeline'
```

and add to the `api` object (after `evaluateBet`):

```typescript
  analyzeMatch: (input: AnalysisInput): Promise<AnalysisResponse> =>
    ipcRenderer.invoke('analysis:run', input)
```

- [ ] **Step 4: Update the preload type declarations**

In `src/preload/index.d.ts`, mirror the same method on the declared `api` type (match the file's existing style — add the import of `AnalysisInput`/`AnalysisResponse` and the `analyzeMatch` signature alongside `evaluateBet`).

- [ ] **Step 5: Typecheck everything**

Run: `npm run typecheck`
Expected: exits 0 for both node and web configs.

- [ ] **Step 6: Suggest the commit**

```
git add src/main/store/apiKey.ts src/main/ipc.ts src/preload/
git commit -m "feat: analysis IPC - renderer can run a full match analysis"
```

---

### Task 9: Analyze page UI (form → loading → VerdictCard + EvidenceTrail)

**Files:**
- Create: `src/renderer/src/components/VerdictCard.tsx`
- Create: `src/renderer/src/components/EvidenceTrail.tsx`
- Create: `src/renderer/src/pages/Analyze.tsx`
- Modify: `src/renderer/src/App.tsx` (replace the Analyze placeholder)
- Modify: `src/renderer/src/assets/main.css` (append styles)

**Interfaces:**
- Consumes: `window.api.analyzeMatch` (Task 8), `AnalysisResult` type via `../../../main/analysis/pipeline` (same import style as `Calculator.tsx` uses for engine types).
- Produces: `<Analyze />` page wired into `App.tsx`.

- [ ] **Step 1: Create `src/renderer/src/components/VerdictCard.tsx`**

```tsx
import type { AnalysisResult } from '../../../main/analysis/pipeline'

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`

// The headline answer: which side (if any) and how much money is safe.
export function VerdictCard({ result }: { result: AnalysisResult }): React.JSX.Element {
  const { verdict, match, confidence } = result
  const sideName = verdict.side === 'A' ? match.sideA : verdict.side === 'B' ? match.sideB : null
  return (
    <div className="verdict-card">
      {sideName ? (
        <p className="verdict verdict-bet">
          BET on {sideName} — stake {verdict.stake.toFixed(2)}
        </p>
      ) : (
        <p className="verdict verdict-no-bet">
          NO BET — neither side offers enough value at these odds. You just avoided a losing bet.
        </p>
      )}
      <p className="hint">
        Data confidence: {confidence === 'medium' ? 'Medium (web research)' : 'Low — extra caution'}
        {' · '}Our probability for {match.sideA}: {pct(result.pFinal)}
      </p>
      {result.warnings.map((w) => (
        <p key={w} className="warning-banner">
          ⚠ {w}
        </p>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create `src/renderer/src/components/EvidenceTrail.tsx`**

```tsx
import type { AnalysisResult } from '../../../main/analysis/pipeline'

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`

// Full transparency: every factor, weight, source, and the exact arithmetic.
export function EvidenceTrail({ result }: { result: AnalysisResult }): React.JSX.Element {
  const { verdict, match } = result
  return (
    <div className="evidence-trail">
      <h3>How this verdict was reached</h3>

      <h4>1. Researched facts (weights are fixed in code)</h4>
      <ul>
        {result.factors.map((f) => (
          <li key={f.name}>
            <strong>{f.name}</strong> (weight {f.weight}, leans{' '}
            {f.value > 0 ? match.sideA : f.value < 0 ? match.sideB : 'neither'}{' '}
            {Math.abs(f.value).toFixed(2)}) — {f.evidence}{' '}
            {f.sources.map((s) => (
              <a key={s} href={s} target="_blank" rel="noreferrer">
                [source]
              </a>
            ))}
          </li>
        ))}
      </ul>
      <p>
        Statistics say {match.sideA} wins with probability <strong>{pct(result.pStats)}</strong>.
      </p>

      <h4>2. Expert opinion (can nudge the estimate by at most ±10 points)</h4>
      {result.expert ? (
        <>
          <p>
            Experts lean:{' '}
            {result.expert.lean === 'none'
              ? 'no clear side'
              : result.expert.lean === 'A'
                ? match.sideA
                : match.sideB}{' '}
            (confidence {pct(result.expert.confidence)}) → signal {pct(result.pSem ?? 0.5)}
          </p>
          <ul>
            {result.expert.keyFactors.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
          <p>
            Sources:{' '}
            {result.expert.sources.map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                {s.title}{' '}
              </a>
            ))}
          </p>
        </>
      ) : (
        <p>Not available for this analysis (see warning above).</p>
      )}
      <p>
        Blended final probability: <strong>{pct(result.pFinal)}</strong>
      </p>

      <h4>3. The money math</h4>
      <p>
        Bookmaker implies {match.sideA} {pct(verdict.impliedA)} / {match.sideB}{' '}
        {pct(verdict.impliedB)} (margin {pct(verdict.vig)}; fair for {match.sideA}:{' '}
        {pct(verdict.vigFreeA)}).
      </p>
      <p>
        Expected value — {match.sideA}: {pct(verdict.evA)} · {match.sideB}: {pct(verdict.evB)}.
        Rule: bet only if a side&apos;s EV is at least 4%; stake is quarter-Kelly capped at 2% of
        bankroll.
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Create `src/renderer/src/pages/Analyze.tsx`**

```tsx
import { useState } from 'react'
import type { AnalysisResult } from '../../../main/analysis/pipeline'
import { VerdictCard } from '../components/VerdictCard'
import { EvidenceTrail } from '../components/EvidenceTrail'

// The core Phase 3 screen: describe any match + your bookmaker's odds,
// get a cited verdict. The AI research runs in the main process.
export function Analyze(): React.JSX.Element {
  const [sideA, setSideA] = useState('')
  const [sideB, setSideB] = useState('')
  const [context, setContext] = useState('')
  const [oddsA, setOddsA] = useState('')
  const [oddsB, setOddsB] = useState('')
  const [bankroll, setBankroll] = useState('1000')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)

  const ready =
    !busy &&
    [sideA, sideB, oddsA, oddsB, bankroll].every((v) => v.trim() !== '')

  async function run(): Promise<void> {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const response = await window.api.analyzeMatch({
        sideA: sideA.trim(),
        sideB: sideB.trim(),
        context: context.trim(),
        oddsA: Number(oddsA),
        oddsB: Number(oddsB),
        bankroll: Number(bankroll)
      })
      if (response.ok) setResult(response.result)
      else setError(response.error)
    } catch {
      setError('The analysis failed unexpectedly. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <h2>Analyze</h2>
      <p className="hint">
        Enter any real upcoming match and the decimal odds your bookmaker shows. The AI researches
        the match on the web; the app&apos;s own math decides if a bet is worth it.
      </p>

      <label htmlFor="side-a">Side A (first team/player)</label>
      <input id="side-a" value={sideA} placeholder="Alcaraz" onChange={(e) => setSideA(e.target.value)} />

      <label htmlFor="side-b">Side B (second team/player)</label>
      <input id="side-b" value={sideB} placeholder="Sinner" onChange={(e) => setSideB(e.target.value)} />

      <label htmlFor="context">Competition / context (optional but helps)</label>
      <input
        id="context"
        value={context}
        placeholder="Wimbledon semi-final, 11 July 2026"
        onChange={(e) => setContext(e.target.value)}
      />

      <label htmlFor="odds-a">Decimal odds for side A</label>
      <input id="odds-a" value={oddsA} placeholder="2.10" onChange={(e) => setOddsA(e.target.value)} />

      <label htmlFor="odds-b">Decimal odds for side B</label>
      <input id="odds-b" value={oddsB} placeholder="1.75" onChange={(e) => setOddsB(e.target.value)} />

      <label htmlFor="bankroll">Bankroll</label>
      <input id="bankroll" value={bankroll} onChange={(e) => setBankroll(e.target.value)} />

      <button onClick={run} disabled={!ready}>
        {busy ? 'Analyzing…' : 'Analyze match'}
      </button>

      {busy && (
        <p className="hint">
          Researching the match on the web — this usually takes one to three minutes. Two AI
          research passes run: facts first, then expert opinion.
        </p>
      )}

      {error && <p className="status-error">{error}</p>}

      {result && (
        <>
          <VerdictCard result={result} />
          <EvidenceTrail result={result} />
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire it into `src/renderer/src/App.tsx`**

Replace the analyze placeholder line:

```tsx
{page === 'analyze' && <Placeholder title="Analyze" phase="Phase 3" />}
```

with:

```tsx
{page === 'analyze' && <Analyze />}
```

and add `import { Analyze } from './pages/Analyze'` to the imports. If `Placeholder` is now unused, remove its import (keep the file — Bankroll/Track Record/Chat still use it; check before deleting anything).

- [ ] **Step 5: Append styles to `src/renderer/src/assets/main.css`**

Match the existing CSS's conventions (inspect the file first), then append:

```css
.verdict-card {
  margin-top: 1.5rem;
  padding: 1rem 1.25rem;
  border: 1px solid #444;
  border-radius: 8px;
}

.warning-banner {
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  background: rgba(255, 180, 0, 0.15);
  border: 1px solid rgba(255, 180, 0, 0.5);
}

.evidence-trail {
  margin-top: 1rem;
}

.evidence-trail h4 {
  margin-top: 1rem;
}

.evidence-trail a {
  margin-right: 0.35rem;
}
```

(Adjust colors to the app's existing palette if it differs — the warning must be clearly visible in the app's theme.)

- [ ] **Step 6: Typecheck + full test suite**

Run: `npm run typecheck` then `npm test`
Expected: both exit 0; all existing + new tests pass.

- [ ] **Step 7: Suggest the commit**

```
git add src/renderer/
git commit -m "feat: Analyze page with VerdictCard and EvidenceTrail"
```

---

### Task 10: End-to-end verification with a real match + roadmap update

**Files:**
- Modify: `docs/superpowers/plans/2026-07-09-phase-roadmap.md` (Phase 3 ⬜ → ✅)

- [ ] **Step 1: Launch the app**

Run: `npm run dev` (this starts the desktop app in development mode; `predev` rebuilds the database driver for Electron first — normal).

- [ ] **Step 2: Guide the user through a real test (numbered, click-by-click)**

Tell the user:

1. Make sure your API key is saved in **Settings** (it survived from Phase 1).
2. Click **Analyze** in the sidebar.
3. Pick any real match happening in the next few days (any sport). Type the two sides, the competition, and the decimal odds from your bookmaker (or a betting site's public odds).
4. Click **Analyze match** and wait 1–3 minutes.
5. Check: the verdict card shows BET or NO BET; the evidence trail lists researched facts **with clickable sources**, the expert-opinion summary with sources, and the exact odds math. NO BET is a *correct* and common outcome.
6. Also test the failure paths: (a) go to Settings, temporarily replace the key with `sk-ant-wrong`, run an analysis — you should see a plain-language key error, not a crash; restore the real key after. (b) Try an analysis with odds `1.0` — you should see a plain odds error immediately.

- [ ] **Step 3: Fix anything the live test surfaces**

If the model's JSON reliably fails validation, tighten the two SYSTEM prompts (Tasks 5/6) rather than loosening the schemas. Re-run the failing scenario after each fix.

- [ ] **Step 4: Mark Phase 3 done in the roadmap**

In `docs/superpowers/plans/2026-07-09-phase-roadmap.md`, change the Phase 3 heading from `## ⬜ Phase 3` to `## ✅ Phase 3` and add a line `**Detailed plan:** \`2026-07-10-phase-3-analyze-anything.md\`` under it.

- [ ] **Step 5: Suggest the final commit**

```
git add docs/superpowers/plans/
git commit -m "docs: mark Phase 3 (analyze anything) complete in roadmap"
```

---

## Self-Review Notes

- **Spec coverage:** universal research adapter (Task 5), schema-validated StatsBundle equivalent with citations (Tasks 2+5), semantic analyst with `{lean, confidence, key_factors, sources}` (Task 6), bounded blend + vig removal + EV gate + quarter-Kelly (existing engine + Task 3), full pipeline with stats-only degradation and visible warnings (Task 7), Analysis view with VerdictCard, EvidenceTrail, confidence label, and clickable sources (Task 9), missing/invalid-API-key guidance (Tasks 4+8), E2E test per spec §8 (Task 10). Not in scope by design: persistence of analyses (Phase 4), odds auto-fetch (out of scope v1). There are no sport-specific adapters — the universal analyzer is the only research path.
- **Type consistency check:** `ClaudeCaller` (T4) is consumed by T5/T6 with signature `(system, user) => Promise<string>`; `MatchVerdict`/`decideMatch` (T3) match usage in T7/T9; `AnalysisInput`/`AnalysisResult`/`AnalysisResponse` (T7) match T8's IPC and T9's UI; `CATEGORY_WEIGHTS`/`ResearchFactor` (T1) match T5/T7.
