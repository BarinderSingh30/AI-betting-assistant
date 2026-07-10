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
