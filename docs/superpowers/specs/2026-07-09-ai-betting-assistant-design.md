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

- **Coverage:** any match in any sport/field from day one, via a single universal AI-research analyzer. There are **no sport-specific adapters or scrapers** — every match goes through the same pipeline. Analyses are labeled with data confidence.
- **Odds:** entered manually by the user from their bookmaker. No odds API in v1.
- **Expert sentiment:** gathered at analysis time via the Claude API's web-search server tool, with source citations shown in the UI.
- **Distribution:** Electron .exe installer; the end user enters their own Anthropic API key in settings.
- **Out of scope:** Elo/Glicko rating models with backtesting, odds-API auto-fetch, dedicated sport adapters/scrapers of any kind, multi-bookmaker line shopping.

## 3. Architecture

**Stack:** Electron (Node main process) + React renderer, TypeScript throughout, Vite for the renderer build, SQLite (better-sqlite3) for local storage, official Anthropic SDK with the `web_search` server tool, electron-builder for packaging.

**Governing principle: the code does all math and decisions; the LLM only reads and explains.**

```
src/
  main/                      # Electron main process (Node)
    adapters/
      types.ts               # normalized research types shared by the pipeline
      universal/             # THE analyzer: Claude web search researches whatever the user enters
    engine/                  # pure functions, no I/O — exhaustively unit-tested
      probability.ts         # weighted factor model -> p_stats
      blend.ts               # p_stats + bounded semantic adjustment -> p_final
      odds.ts                # vig removal, implied probability, EV
      kelly.ts               # fractional Kelly + caps -> stake
    semantic/
      analyst.ts             # Claude + web_search -> structured JSON verdict (schema-validated)
      chat.ts                # multi-conversation chat: sessions, grounding, long-chat summarization
    store/                   # SQLite: bankroll ledger, bets, analyses, chats + messages, settings (API key)
    ipc.ts                   # typed IPC handlers for the renderer
  renderer/                  # React dashboard
    pages/                   # Analyze, Bankroll, TrackRecord, Settings
    components/              # VerdictCard, EvidenceTrail, ChatPanel, CalibrationChart
```

### The universal analyzer

One research path for every sport: the user types the matchup, and Claude + web search returns a normalized, schema-validated research result — recent form, head-to-head, participant ratings/rankings, context factors (venue, surface, injuries/roster), each with sources and an overall data-quality marker. Bet settlement is always manual (the user marks won/lost).

## 4. The core formula (analysis pipeline)

0. **Match entry:** user types any matchup ("Alcaraz vs Sinner, Wimbledon SF") into the "Analyze anything" input, plus the odds their bookmaker offers.
1. **Stats probability (code + research):** Claude + web search researches the factual record and returns a schema-validated research result with citations → weighted factor model (weights fixed in code) → `p_stats`. Medium confidence, labeled on the verdict.
2. **Semantic signal (LLM):** Claude + web search gathers expert previews and community picks from reputable sources → structured JSON `{lean, confidence, key_factors[], sources[]}` → `p_sem`. Schema-validated; retried on invalid output.
3. **Blend (code):** `p_final` = weighted blend of `p_stats` and `p_sem`; the semantic adjustment is bounded to ±10 percentage points — the LLM can nudge the estimate, never override the data.
4. **Odds math (code):** remove the vig from entered odds → true implied probability. `EV = p_final × odds − 1`.
5. **Decision (code):**
   - `EV < threshold` (default 4%) → **NO BET**, shown as a positive outcome ("you just avoided a losing bet").
   - Otherwise → stake = ¼-Kelly: `bankroll × 0.25 × (p_final × odds − 1) / (odds − 1)`, hard-capped at 2% of current bankroll. Both threshold and cap configurable in settings.

## 5. Trust & safety features

- **Bankroll ledger:** deposits, bets, settlements, live balance. Settlement is manual — the user marks each bet won or lost. Every stake recommendation is computed from the live balance.
- **Calibration track record:** every recommendation logged with its probability. Dashboard shows ROI, win rate, and a calibration chart (do the app's "65%" calls actually hit ~65%?).
- **Loss-limit guard:** if the bankroll drops a configurable % within a week, the app recommends a break and pauses stake suggestions.
- **Transparent evidence trail:** every verdict shows factor weights, cited expert sources (clickable), the app's probability vs. the bookmaker's implied probability, and the exact EV/Kelly arithmetic.
- **Language discipline:** probabilities everywhere, never certainties.

## 6. Dashboard (renderer)

- **Analyze page:** "Analyze anything" free-text input — the single entry point for every sport.
- **Analysis view:** verdict card (BET side + stake, or NO BET) on top of the full evidence trail and confidence label.
- **Bankroll page:** balance, open bets, settle results, profit/loss graph.
- **Track record page:** ROI, win rate, calibration chart.
- **Chat (multi-conversation, like modern AI products):**
  - A chat sidebar lists all conversations; the user can open many chats, switch between them, rename and delete them — same pattern as the Claude app.
  - Every conversation and all its messages are stored in SQLite, so chats survive app restarts and can be continued days later.
  - Chats are auto-titled from their first message (a cheap model call), editable by the user.
  - A chat can be **linked to an analysis** (started from a verdict — pre-grounded in that match's computed numbers) or **standalone** (general betting/bankroll questions, grounded in the user's bankroll and track record).
  - Long conversations are handled by a context strategy: the full history is stored, but requests send the grounding data + a running summary of older messages + the most recent messages, so chats never break by growing too long.
- **Settings:** API key, bankroll settings, EV threshold, Kelly fraction/cap, loss-limit, in-app model choice (default `claude-sonnet-5`).

## 7. Error handling

- Expert-opinion (web search) failure → stats-only mode, clearly labeled with a visible warning banner.
- Missing/invalid API key or exhausted credits → guided setup screen with click-by-click instructions. Never a silent failure.
- All AI outputs schema-validated before the app trusts them; invalid output → bounded retry, then graceful degradation.

## 8. Testing

- **Engine math:** unit tests written before implementation (TDD) against hand-computed cases — vig removal, EV, Kelly, caps, blend bounds. This is money math; it gets the most rigor.
- **Semantic layer:** JSON schema validation tests, including rejection/retry paths.
- **End-to-end:** analyze a real match of an arbitrary sport via "Analyze anything" with real odds → full cited analysis and sane stake; settle a fake bet → ledger and track record update; package the installer and confirm a clean install/run with a fresh profile.

## 9. Implementation order

1. Scaffold: Electron + Vite + React + TypeScript + SQLite; settings screen with API-key entry
2. Engine (pure math) with exhaustive unit tests first
3. Universal analyzer + semantic analyst (makes any-sport analysis work immediately)
4. Analysis pipeline + IPC wiring end-to-end
5. Dashboard pages and components
6. Multi-conversation chat system (sidebar, persistence, grounding, long-chat summarization)
7. Packaging: electron-builder .exe + first-run onboarding (API key, starting bankroll)
