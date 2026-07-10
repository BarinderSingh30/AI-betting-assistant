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
