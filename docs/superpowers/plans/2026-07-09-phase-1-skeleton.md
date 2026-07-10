# Phase 1: Skeleton App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A launchable Electron desktop app with sidebar navigation, SQLite storage, and a Settings page where an Anthropic API key persists across restarts.

**Architecture:** electron-vite scaffold (main process / preload / React renderer). A generic key-value settings store (better-sqlite3) lives in the main process; the renderer talks to it only through a typed IPC bridge exposed by the preload script. The API key is encrypted with Electron's safeStorage before it touches disk.

**Tech Stack:** Electron, electron-vite, React 19, TypeScript, better-sqlite3, Vitest.

## Global Constraints (from spec + CLAUDE.md)

- Plain-language explanations to the user at every step; explain each command before running it.
- **The user runs ALL git commands themselves.** Commit steps below mean: show the user the exact commands, explain them in one sentence each, wait for them to run.
- TypeScript everywhere; `npm test` must pass before any commit.
- Errors must never be silent — surface them in the UI in plain words.
- Database file lives in Electron's `userData` directory (never in the repo).

---

### Task 1: Scaffold the app and verify it launches

**Files:**
- Create: entire project scaffold at repo root (electron-vite template: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/…`, `electron.vite.config.ts`, `package.json`, `tsconfig*.json`)
- Create: `.gitignore` (template provides; verify `node_modules`, `dist`, `out` are listed)

**Interfaces:**
- Produces: a running Electron window via `npm run dev`; project layout `src/main`, `src/preload`, `src/renderer/src` that all later tasks build on.

- [x] **Step 1: Scaffold with the official electron-vite creator**

The repo already contains `CLAUDE.md`, `docs/`, and `.git`, so scaffold into a temp dir and move the pieces in:

```powershell
npm create @quick-start/electron@latest scaffold-tmp -- --template react-ts --skip
Get-ChildItem scaffold-tmp -Force | Where-Object Name -notin '.git' | Move-Item -Destination .
Remove-Item scaffold-tmp -Recurse -Force
```

- [x] **Step 2: Set the app identity in `package.json`**

Edit the generated `package.json` fields (keep everything else the template made):

```json
{
  "name": "ai-betting-assistant",
  "version": "0.1.0",
  "description": "Decides which side to bet on and how much is safe to stake",
  "author": "Barinder Singh"
}
```

- [x] **Step 3: Install dependencies**

```powershell
npm install
```

Expected: completes without errors (warnings are fine).

- [x] **Step 4: Verify the app launches**

```powershell
npm run dev
```

Expected: a desktop window opens showing the electron-vite template screen. Close it (Ctrl+C in the terminal). If the window opens, the skeleton works.

- [ ] **Step 5: Commit (user runs it)**

Ask the user to run, explaining each line:

```
git add -A
git commit -m "feat: scaffold Electron + React + TypeScript app"
```

(`git add -A` stages every new file; the commit snapshots the working skeleton.)

---

### Task 2: SQLite settings store (with tests)

**Files:**
- Create: `src/main/store/db.ts`
- Create: `src/main/store/settings.ts`
- Test: `src/main/store/settings.test.ts`
- Modify: `package.json` (add deps + `test` script)

**Interfaces:**
- Produces: `openDb(filePath: string): Database.Database` from `db.ts`; `createSettingsStore(db): { get(key: string): string | null; set(key: string, value: string): void }` from `settings.ts`. Task 3 consumes both.

- [x] **Step 1: Install better-sqlite3 and vitest**

```powershell
npm install better-sqlite3
npm install -D vitest @types/better-sqlite3 electron-builder
```

Then add to `package.json` `"scripts"`: `"test": "vitest run"` and `"postinstall": "electron-builder install-app-deps"` (rebuilds the native SQLite module for Electron), and run `npm run postinstall` once.

- [x] **Step 2: Write the failing test**

`src/main/store/settings.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from './db'
import { createSettingsStore } from './settings'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'betting-store-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('settings store', () => {
  it('returns null for a key that was never set', () => {
    const store = createSettingsStore(openDb(join(dir, 'app.db')))
    expect(store.get('apiKey')).toBeNull()
  })

  it('returns what was set', () => {
    const store = createSettingsStore(openDb(join(dir, 'app.db')))
    store.set('apiKey', 'sk-test-123')
    expect(store.get('apiKey')).toBe('sk-test-123')
  })

  it('overwrites an existing value', () => {
    const store = createSettingsStore(openDb(join(dir, 'app.db')))
    store.set('apiKey', 'old')
    store.set('apiKey', 'new')
    expect(store.get('apiKey')).toBe('new')
  })

  it('persists across database reopen', () => {
    const path = join(dir, 'app.db')
    const db1 = openDb(path)
    createSettingsStore(db1).set('apiKey', 'persisted')
    db1.close()
    const store2 = createSettingsStore(openDb(path))
    expect(store2.get('apiKey')).toBe('persisted')
  })
})
```

- [x] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/store/settings.test.ts`
Expected: FAIL — cannot resolve `./db` / `./settings`.

- [x] **Step 4: Write the implementation**

`src/main/store/db.ts`:

```ts
import Database from 'better-sqlite3'

export function openDb(filePath: string): Database.Database {
  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  return db
}
```

`src/main/store/settings.ts`:

```ts
import type Database from 'better-sqlite3'

export interface SettingsStore {
  get(key: string): string | null
  set(key: string, value: string): void
}

export function createSettingsStore(db: Database.Database): SettingsStore {
  const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?')
  const setStmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  return {
    get(key) {
      const row = getStmt.get(key) as { value: string } | undefined
      return row?.value ?? null
    },
    set(key, value) {
      setStmt.run(key, value)
    }
  }
}
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: 4 tests PASS. (If better-sqlite3 fails to load under Node, run `npm rebuild better-sqlite3` — vitest runs under Node, Electron uses its own rebuilt copy.)

- [ ] **Step 6: Commit (user runs it)**

```
git add src/main/store package.json package-lock.json
git commit -m "feat: add SQLite settings store with tests"
```

---

### Task 3: Typed IPC bridge for settings (API key encrypted at rest)

**Files:**
- Create: `src/main/ipc.ts`
- Modify: `src/main/index.ts` (open DB in userData, register IPC)
- Modify: `src/preload/index.ts` (expose `window.api`)
- Modify: `src/preload/index.d.ts` (types for `window.api`)

**Interfaces:**
- Consumes: `openDb`, `createSettingsStore` from Task 2.
- Produces: renderer-callable `window.api.getApiKey(): Promise<string | null>` and `window.api.setApiKey(key: string): Promise<void>`. Task 4 consumes these.

- [x] **Step 1: Create the IPC handlers**

`src/main/ipc.ts`:

```ts
import { ipcMain, safeStorage } from 'electron'
import type { SettingsStore } from './store/settings'

const API_KEY = 'anthropicApiKey'

export function registerIpc(settings: SettingsStore): void {
  ipcMain.handle('settings:getApiKey', () => {
    const stored = settings.get(API_KEY)
    if (stored === null) return null
    if (!safeStorage.isEncryptionAvailable()) return stored
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'))
    } catch {
      return null // stored value unreadable (e.g. different user profile) — treat as unset
    }
  })

  ipcMain.handle('settings:setApiKey', (_event, key: string) => {
    const value = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(key).toString('base64')
      : key
    settings.set(API_KEY, value)
  })
}
```

- [x] **Step 2: Wire DB + IPC into app startup**

In `src/main/index.ts`, inside `app.whenReady().then(...)` **before** `createWindow()`:

```ts
import { join } from 'node:path'
import { openDb } from './store/db'
import { createSettingsStore } from './store/settings'
import { registerIpc } from './ipc'

// inside whenReady:
const db = openDb(join(app.getPath('userData'), 'betting-assistant.db'))
registerIpc(createSettingsStore(db))
```

- [x] **Step 3: Expose the bridge in the preload script**

In `src/preload/index.ts`, replace the template's `api` object with:

```ts
const api = {
  getApiKey: (): Promise<string | null> => ipcRenderer.invoke('settings:getApiKey'),
  setApiKey: (key: string): Promise<void> => ipcRenderer.invoke('settings:setApiKey', key)
}
```

In `src/preload/index.d.ts`, type it:

```ts
interface Api {
  getApiKey(): Promise<string | null>
  setApiKey(key: string): Promise<void>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
```

- [x] **Step 4: Verify it runs**

Run: `npm run dev` — window opens with no errors in the terminal; in the window press Ctrl+Shift+I to open DevTools and run `await window.api.getApiKey()` in the Console. Expected: `null`.

- [ ] **Step 5: Commit (user runs it)**

```
git add src/main src/preload
git commit -m "feat: add typed IPC bridge with encrypted API key storage"
```

---

### Task 4: Navigation shell + Settings page

**Files:**
- Create: `src/renderer/src/pages/Settings.tsx`
- Create: `src/renderer/src/pages/Placeholder.tsx`
- Create: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/App.tsx` (replace template content)
- Modify: `src/renderer/src/assets/main.css` (minimal layout styles; real design comes in Phase 7)

**Interfaces:**
- Consumes: `window.api.getApiKey` / `window.api.setApiKey` from Task 3.
- Produces: `PageId = 'analyze' | 'bankroll' | 'track-record' | 'chat' | 'settings'`; App renders Sidebar + current page. Later phases replace `Placeholder` with real pages.

- [x] **Step 1: Build the shell and pages**

`src/renderer/src/components/Sidebar.tsx`:

```tsx
export type PageId = 'analyze' | 'bankroll' | 'track-record' | 'chat' | 'settings'

const PAGES: { id: PageId; label: string }[] = [
  { id: 'analyze', label: 'Analyze' },
  { id: 'bankroll', label: 'Bankroll' },
  { id: 'track-record', label: 'Track Record' },
  { id: 'chat', label: 'Chat' },
  { id: 'settings', label: 'Settings' }
]

export function Sidebar(props: { current: PageId; onNavigate: (page: PageId) => void }): React.JSX.Element {
  return (
    <nav className="sidebar">
      <h1 className="sidebar-title">Betting Assistant</h1>
      {PAGES.map((p) => (
        <button
          key={p.id}
          className={p.id === props.current ? 'nav-item active' : 'nav-item'}
          onClick={() => props.onNavigate(p.id)}
        >
          {p.label}
        </button>
      ))}
    </nav>
  )
}
```

`src/renderer/src/pages/Placeholder.tsx`:

```tsx
export function Placeholder(props: { title: string; phase: string }): React.JSX.Element {
  return (
    <div className="page">
      <h2>{props.title}</h2>
      <p>Coming in {props.phase}.</p>
    </div>
  )
}
```

`src/renderer/src/pages/Settings.tsx`:

```tsx
import { useEffect, useState } from 'react'

export function Settings(): React.JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<'loading' | 'empty' | 'saved' | 'editing' | 'error'>('loading')

  useEffect(() => {
    window.api
      .getApiKey()
      .then((key) => {
        if (key) setApiKey(key)
        setStatus(key ? 'saved' : 'empty')
      })
      .catch(() => setStatus('error'))
  }, [])

  async function save(): Promise<void> {
    try {
      await window.api.setApiKey(apiKey.trim())
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="page">
      <h2>Settings</h2>
      <label htmlFor="api-key">Anthropic API key</label>
      <p className="hint">
        This key lets the app use AI for research. Get one at console.anthropic.com → API keys. It is
        stored encrypted on this computer only.
      </p>
      <input
        id="api-key"
        type="password"
        value={apiKey}
        placeholder="sk-ant-..."
        onChange={(e) => {
          setApiKey(e.target.value)
          setStatus('editing')
        }}
      />
      <button onClick={save} disabled={status === 'loading' || apiKey.trim() === ''}>
        Save key
      </button>
      {status === 'saved' && <p className="status-ok">Saved. The app can now use AI features.</p>}
      {status === 'error' && <p className="status-error">Something went wrong saving the key. Try again.</p>}
    </div>
  )
}
```

`src/renderer/src/App.tsx` (replace template content):

```tsx
import { useState } from 'react'
import { Sidebar, type PageId } from './components/Sidebar'
import { Settings } from './pages/Settings'
import { Placeholder } from './pages/Placeholder'

function App(): React.JSX.Element {
  const [page, setPage] = useState<PageId>('analyze')
  return (
    <div className="app-shell">
      <Sidebar current={page} onNavigate={setPage} />
      <main className="content">
        {page === 'analyze' && <Placeholder title="Analyze" phase="Phase 3" />}
        {page === 'bankroll' && <Placeholder title="Bankroll" phase="Phase 4" />}
        {page === 'track-record' && <Placeholder title="Track Record" phase="Phase 4" />}
        {page === 'chat' && <Placeholder title="Chat" phase="Phase 6" />}
        {page === 'settings' && <Settings />}
      </main>
    </div>
  )
}

export default App
```

Append this minimal layout CSS to `src/renderer/src/assets/main.css` (plain on purpose — Phase 7 does the real design):

```css
.app-shell { display: flex; height: 100vh; }
.sidebar { width: 220px; flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; padding: 16px 8px; border-right: 1px solid #333; }
.sidebar-title { font-size: 16px; padding: 0 8px 12px; }
.nav-item { text-align: left; padding: 8px 12px; border: none; background: none; border-radius: 6px; cursor: pointer; font: inherit; color: inherit; }
.nav-item:hover { background: rgba(128, 128, 128, 0.15); }
.nav-item.active { background: rgba(128, 128, 128, 0.3); font-weight: 600; }
.content { flex: 1; overflow-y: auto; padding: 24px 32px; }
.page { max-width: 640px; display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
.page input { width: 100%; padding: 8px 10px; font: inherit; }
.hint { opacity: 0.75; font-size: 14px; }
.status-ok { color: #3fa34d; }
.status-error { color: #d64545; }
```

- [x] **Step 2: Verify end-to-end by hand**

Run: `npm run dev`
Expected: sidebar with 5 entries; clicking navigates; Settings accepts a fake key `sk-ant-test`, shows "Saved"; quit the app fully, `npm run dev` again → Settings still shows the saved key (masked).

- [x] **Step 3: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: tests PASS, no type errors.

- [ ] **Step 4: Commit (user runs it) — closes Phase 1**

```
git add src/renderer
git commit -m "feat: add navigation shell and settings page"
git push
```

Then mark Phase 1 ✅ in `docs/superpowers/plans/2026-07-09-phase-roadmap.md` (and commit that too).

---

## Verification for the whole phase

1. `npm test` — all green.
2. `npm run dev` — window opens, navigation works.
3. Save API key → quit → relaunch → key still there (the Phase 1 acceptance test).
4. Confirm no `.db` file appeared inside the repo folder (it must be in the Electron userData folder).
