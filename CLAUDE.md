# CLAUDE.md — AI Betting Assistant

## About the user (IMPORTANT — read first)

The user is **new to software development**. This is their first Windows app and they have little to no experience with programming tools, terminals, or jargon. Because of this:

- **Use plain language.** No unexplained jargon. If a technical term is unavoidable (e.g., "API key", "scraper", "unit test"), explain it in one simple sentence the first time it comes up.
- **Explain each step before doing it.** One or two sentences: what you're about to do and *why it matters for the app*. Example: "I'm now writing the code that calculates how much to bet — this is the math that keeps the bankroll safe."
- **Explain commands in plain words** when running important ones (e.g., "`npm install` downloads the building blocks this app needs").
- **When you finish a piece, say what it does in everyday terms** and, if possible, show how the user can see or test it themselves.
- **If something fails, don't just show the error** — say what went wrong in plain words and what you're doing to fix it.
- **When the user must do something manually** (create an account, get an API key, test the app), give numbered click-by-click instructions.
- Never assume the user knows what a file, folder, or tool is for — say it briefly.

## What this project is

A Windows desktop app (installable .exe, built with Electron) that helps a person decide **which side of a match to bet on and how much money is safe to stake** given their budget. It works for **any match in any sport/field** (the AI researches it on the web), with extra-rich data for **Valorant** (from vlr.gg).

Core principle: **the code does all the math and decisions; the AI only reads and explains.** The app is a *value scanner + risk manager*, not a fortune teller — "NO BET" is a first-class recommendation.

The full approved design lives in the plan file at
`C:\Users\ninja\.claude\plans\ai-betting-assistant-overview-composed-squid.md`
and the spec (once created) in `docs/superpowers/specs/`.

## Key decisions already made (do not re-ask)

- Stack: Electron + React + TypeScript, Vite, SQLite (better-sqlite3), electron-builder for the .exe
- Odds are **entered manually** by the user from their bookmaker (no odds API in v1)
- Expert opinions gathered via **Claude API web search** at analysis time, with source citations
- The app's end user enters **their own Anthropic API key** in a settings screen
- In-app AI model: `claude-sonnet-5`
- Betting math: remove vig → EV = p × odds − 1 → bet only if EV > 4% → stake = ¼-Kelly, hard-capped at 2% of bankroll
- Safety rails: bankroll ledger, calibration track record, loss-limit guard, probabilities never certainties

## Working rules for this repo

- The money math (`src/main/engine/`) must have unit tests written **before** the implementation (TDD) — bugs there cost real money.
- The vlr.gg scraper is tested against saved HTML files, not the live site.
- Anything the AI returns must be schema-validated before the app trusts it.
- Errors must always be visible to the user in plain language — never silent failures.
