import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDb } from './db'
import { createSettingsStore } from './settings'

let dir: string
let dbs: Database.Database[]

// Windows cannot delete a database file that is still open, so every
// connection opened in a test is tracked and closed before cleanup.
function open(path: string): Database.Database {
  const db = openDb(path)
  dbs.push(db)
  return db
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'betting-store-'))
  dbs = []
})
afterEach(() => {
  for (const db of dbs) {
    if (db.open) db.close()
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('settings store', () => {
  it('returns null for a key that was never set', () => {
    const store = createSettingsStore(open(join(dir, 'app.db')))
    expect(store.get('apiKey')).toBeNull()
  })

  it('returns what was set', () => {
    const store = createSettingsStore(open(join(dir, 'app.db')))
    store.set('apiKey', 'sk-test-123')
    expect(store.get('apiKey')).toBe('sk-test-123')
  })

  it('overwrites an existing value', () => {
    const store = createSettingsStore(open(join(dir, 'app.db')))
    store.set('apiKey', 'old')
    store.set('apiKey', 'new')
    expect(store.get('apiKey')).toBe('new')
  })

  it('persists across database reopen', () => {
    const path = join(dir, 'app.db')
    const db1 = open(path)
    createSettingsStore(db1).set('apiKey', 'persisted')
    db1.close()
    const store2 = createSettingsStore(open(path))
    expect(store2.get('apiKey')).toBe('persisted')
  })
})
