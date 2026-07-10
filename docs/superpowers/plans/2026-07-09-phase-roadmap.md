# AI Betting Assistant — Phase Roadmap

> **How to use this file:** This is the master map of the whole build, in order. Each phase ends with something the user can see and test, and a commit the user runs themselves (they are learning git — never run git commands for them). Before starting a phase, write its detailed task plan to `docs/superpowers/plans/` using the writing-plans skill, based on the spec (`docs/superpowers/specs/2026-07-09-ai-betting-assistant-design.md`) and the code as it exists then. Mark phases done here as we go.

**Status legend:** ⬜ not started · 🔨 in progress · ✅ done

---

## ✅ Phase 1 — Skeleton app (a window you can open)

**Goal:** A real desktop window with the app's navigation shell and a working Settings page.

**Builds:** Electron + Vite + React + TypeScript scaffold; SQLite database wired in; sidebar navigation with placeholder pages (Analyze, Bankroll, Track Record, Chat, Settings); Settings page where an Anthropic API key can be saved and survives restarting the app.

**You can test:** `npm run dev` opens the app window; save an API key, close the app, reopen — it's still there.

**Detailed plan:** `2026-07-09-phase-1-skeleton.md`

## ⬜ Phase 2 — The money-math engine (the app's brain, proven correct)

**Goal:** All betting math implemented as pure, exhaustively tested functions — before any AI is involved.

**Builds:** `engine/odds.ts` (vig removal, implied probability, EV), `engine/kelly.ts` (¼-Kelly stake + 2% cap), `engine/blend.ts` (stats + bounded semantic blend), `engine/probability.ts` (weighted factor model). Written test-first (TDD). Plus a temporary "Calculator" page in the app: enter a probability and odds by hand, see EV, verdict, and stake — so the math is visible, not just green tests.

**You can test:** `npm test` shows all tests passing; the Calculator page gives sane answers to examples we'll check together by hand.

## ⬜ Phase 3 — "Analyze anything" (the AI joins)

**Goal:** Type any real match in any sport + your bookmaker's odds → full analysis with citations.

**Builds:** universal research adapter (Claude + web search gathers facts → schema-validated StatsBundle), semantic analyst (expert takes → structured verdict with sources), the full analysis pipeline connecting adapter → engine → verdict, and the Analysis view (VerdictCard + EvidenceTrail + confidence label).

**You can test:** analyze a real upcoming match from any sport with real odds; get a cited, transparent verdict (often "NO BET" — that's correct behavior).

## ⬜ Phase 4 — Bankroll & track record (the safety system)

**Goal:** The app manages money history and holds itself accountable.

**Builds:** bankroll ledger (deposits, bets, settlements, live balance), "log this bet" from a verdict, manual settlement, Bankroll page with profit/loss graph, Track Record page with ROI, win rate, and calibration chart; loss-limit guard.

**You can test:** log a bet, settle it as won/lost, watch balance, graphs, and track record update; stake suggestions shrink/grow with the balance.

## ⬜ Phase 5 — Valorant deep data

**Goal:** Valorant matches get richer, higher-confidence analysis from structured vlr.gg data.

**Builds:** vlr.gg scraper (upcoming matches, team form, head-to-head, map stats, player ratings, results) tested against saved HTML files; Match Board page listing upcoming Valorant matches; auto-settlement of Valorant bets from results.

**You can test:** pick a real upcoming Valorant match from the board — analysis shows high-confidence structured stats; a settled Valorant match resolves the bet automatically.

## ⬜ Phase 6 — Multi-conversation chat

**Goal:** Chat like the Claude app: many conversations, all remembered.

**Builds:** chat sidebar (new chat, switch, rename, delete), SQLite persistence of every conversation, auto-titles from the first message, chats grounded in a specific analysis ("discuss this verdict") or standalone (grounded in bankroll + track record), running-summary strategy so long chats never break.

**You can test:** open several chats about different matches, quit the app, reopen, continue any of them where you left off.

## ⬜ Phase 7 — Dashboard beauty & polish

**Goal:** From functional to genuinely pretty and clear.

**Builds:** full visual design pass (frontend-design + dataviz skills): typography, layout, charts, empty states, loading states, friendly error banners for every failure mode in the spec (scrape failure, web-search failure, missing/invalid API key).

**You can test:** every page looks intentional and beautiful; unplug the internet and every failure explains itself in plain language.

## ⬜ Phase 8 — Ship it (.exe installer)

**Goal:** A double-clickable installer you can hand to the person it's for.

**Builds:** electron-builder packaging, app icon, first-run onboarding wizard (welcome → API key with click-by-click instructions → starting bankroll → safety explainer), final end-to-end verification per the spec's checklist.

**You can test:** install the .exe on this machine with a fresh profile and walk through onboarding to a first analysis, exactly as the recipient will.

---

**Cross-phase rules (from CLAUDE.md):** plain language with the user at every step; user runs all git commands themselves (suggest the exact commands and explain them); money math is TDD always; AI outputs are always schema-validated; errors are never silent.
