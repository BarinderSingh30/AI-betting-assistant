import { ipcMain, safeStorage } from 'electron'
import type { SettingsStore } from './store/settings'
import { decide, type CalcInput, type CalcResponse } from './engine/decision'

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
}
