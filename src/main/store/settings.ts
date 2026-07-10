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
