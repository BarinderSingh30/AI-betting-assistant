import { ElectronAPI } from '@electron-toolkit/preload'

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
