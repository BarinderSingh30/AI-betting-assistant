# AI Betting Assistant — Design Spec

**Date:** 2026-07-09
**Status:** Approved by user

## 1. What we're building and why

A Windows desktop app (installable .exe) that helps its user decide **which side of a match to bet on and how much money is safe to stake** given their budget. It will be given to a person who bets real money, so correctness and honesty matter more than flash.

**The key insight behind the design:** bookmaker odds already contain all public information (form, head-to-head, expert consensus). A tool that merely aggregates that data converges on what the odds already say and loses to the bookmaker's margin. So this app is **not a winner-predictor**. It is a:

1. **Value scanner** — finds cases where its probability estimate meaningfully disagrees with the bookmaker's odds
2. **Risk manager** — sizes stakes with real bankroll math so no single bet can hurt badly
3. **Accountable analyst** — logs every recommendation and shows its own track record, so trust is earned, not asserted

"NO BET" is expected to be the most common — and most valuable — recommendation.

## 2. Scope

- **Coverage:** any match in any sport/field from day one, via a universal AI-research adapter. **Valorant** gets the first dedicated adapter with richer structured data from vlr.gg. Analyses are labeled with data confidence (dedicated = high, universal = medium).
- **Odds:** entered manually by the user from their bookmaker. No odds API in v1.
- **Expert sentiment:** gathered at analysis time via the Claude API's web-search server tool, with source citations shown in the UI.
- **Distribution:** Electron .exe installer; the end user enters their own Anthropic API key in settings.
- **Out of scope for v1:** Elo/Glicko rating models with backtesting, odds-API auto-fetch, additional dedicated sport adapters, multi-bookmaker line shopping.

## 3. Architecture

**Stack:** Electron (Node main process) + React renderer, TypeScript throughout, Vite for the renderer build, SQLite (better-sqlite3) for local storage, official Anthropic SDK with the `web_search` server tool, electron-builder for packaging.

**Governing principle: the code does all math and decisions; the LLM only reads and explains.**

```
src/
  main/                      # Electron main process (Node)
    adapters/
      types.ts               # SportAdapter interface + normalized StatsBundle
      universal/             # any-match adapter: Claude web search researches whatever the user enters
      valorant/              # vlr.gg scraper: matches, stats, H2H, results
    engine/                  # pure functions, no I/O — exhaustively unit-tested
      probability.ts         # weighted factor model -> p_stats
      blend.ts               # p_stats + bounded semantic adjustment -> p_final
      odds.ts                # vig removal, implied probability, EV
      kelly.ts               # fractional Kelly + caps -> stake
    semantic/
      analyst.ts             # Claude + web_search -> structured JSON verdict (schema-validated)
      chat.ts                # analysis-grounded chat sessions
    store/                   # SQLite: bankroll ledger, bets, analyses, settings (API key)
    ipc.ts                   # typed IPC handlers for the renderer
  renderer/                  # React dashboard
    pages/                   # MatchBoard, Analysis, Bankroll, TrackRecord, Settings
    components/              # VerdictCard, EvidenceTrail, ChatPanel, CalibrationChart
```

### SportAdapter interface

Every sport plugs in through the same interface:

- `getUpcomingMatches()` — list of matches for the match board (dedicated adapters only)
- `getMatchStats(match)` — returns a normalized `StatsBundle`
- `getResult(match)` — used to auto-settle bets where possible

`StatsBundle` (normalized across all sports): recent form, head-to-head, participant ratings/rankings, context factors (venue, LAN/online, surface, injuries/roster), each with a source and a data-confidence marker.

## 4. The core formula (analysis pipeline)

0. **Match entry:** user picks an upcoming match from the board (dedicated adapter) or types any matchup ("Alcaraz vs Sinner, Wimbledon SF") into the "Analyze anything" input (universal adapter), plus the odds their bookmaker offers.
1. **Stats probability (code + adapter):** adapter produces a `StatsBundle` → weighted factor model → `p_stats`.
   - *Valorant:* scraped from vlr.gg — last-N series form, map records, head-to-head, player ratings, LAN/online. High confidence.
   - *Universal:* Claude + web search researches the factual record and returns a schema-validated StatsBundle with citations. Medium confidence, labeled on the verdict.
2. **Semantic signal (LLM):** Claude + web search gathers expert previews and community picks from reputable sources → structured JSON `{lean, confidence, key_factors[], sources[]}` → `p_sem`. Schema-validated; retried on invalid output.
3. **Blend (code):** `p_final` = weighted blend of `p_stats` and `p_sem`; the semantic adjustment is bounded to ±10 percentage points — the LLM can nudge the estimate, never override the data.
4. **Odds math (code):** remove the vig from entered odds → true implied probability. `EV = p_final × odds − 1`.
5. **Decision (code):**
   - `EV < threshold` (default 4%) → **NO BET**, shown as a positive outcome ("you just avoided a losing bet").
   - Otherwise → stake = ¼-Kelly: `bankroll × 0.25 × (p_final × odds − 1) / (odds − 1)`, hard-capped at 2% of current bankroll. Both threshold and cap configurable in settings.

## 5. Trust & safety features

- **Bankroll ledger:** deposits, bets, settlements, live balance. Settlement auto-fetched from vlr.gg for Valorant; manual marking for universal-adapter bets. Every stake recommendation is computed from the live balance.
- **Calibration track record:** every recommendation logged with its probability. Dashboard shows ROI, win rate, and a calibration chart (do the app's "65%" calls actually hit ~65%?).
- **Loss-limit guard:** if the bankroll drops a configurable % within a week, the app recommends a break and pauses stake suggestions.
- **Transparent evidence trail:** every verdict shows factor weights, cited expert sources (clickable), the app's probability vs. the bookmaker's implied probability, and the exact EV/Kelly arithmetic.
- **Language discipline:** probabilities everywhere, never certainties.

## 6. Dashboard (renderer)

- **Match board:** upcoming Valorant matches auto-pulled; "Analyze anything" free-text input for every other sport.
- **Analysis view:** verdict card (BET side + stake, or NO BET) on top of the full evidence trail and confidence label.
- **Bankroll page:** balance, open bets, settle results, profit/loss graph.
- **Track record page:** ROI, win rate, calibration chart.
- **Chat panel:** docked beside the analysis; Claude conversation pre-grounded in the computed numbers so answers reference real math, not vibes.
- **Settings:** API key, bankroll settings, EV threshold, Kelly fraction/cap, loss-limit, in-app model choice (default `claude-sonnet-5`).

## 7. Error handling

- vlr.gg scrape failure → analysis proceeds stats-degraded with a visible warning banner.
- Web search failure → stats-only mode, clearly labeled.
- Missing/invalid API key or exhausted credits → guided setup screen with click-by-click instructions. Never a silent failure.
- All AI outputs schema-validated before the app trusts them; invalid output → bounded retry, then graceful degradation.

## 8. Testing

- **Engine math:** unit tests written before implementation (TDD) against hand-computed cases — vig removal, EV, Kelly, caps, blend bounds. This is money math; it gets the most rigor.
- **Scraper:** tests against saved vlr.gg HTML fixtures, not the live site.
- **Semantic layer:** JSON schema validation tests, including rejection/retry paths.
- **End-to-end:** analyze a real match of an arbitrary sport via "Analyze anything" with real odds → full cited analysis and sane stake; analyze a real Valorant match via the board; settle a fake bet → ledger and track record update; package the installer and confirm a clean install/run with a fresh profile.

## 9. Implementation order

1. Scaffold: Electron + Vite + React + TypeScript + SQLite; settings screen with API-key entry
2. Engine (pure math) with exhaustive unit tests first
3. Universal adapter + semantic analyst (makes any-sport analysis work immediately)
4. Analysis pipeline + IPC wiring end-to-end
5. Valorant dedicated adapter (vlr.gg scraper with HTML fixtures)
6. Dashboard pages and components
7. Chat panel grounded in computed analysis
8. Packaging: electron-builder .exe + first-run onboarding (API key, starting bankroll)
