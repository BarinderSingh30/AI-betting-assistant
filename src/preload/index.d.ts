import { ElectronAPI } from '@electron-toolkit/preload'
import type { CalcInput, CalcResponse } from '../main/engine/decision'
import type { AnalysisInput, AnalysisResponse } from '../main/analysis/pipeline'

interface Api {
  getApiKey(): Promise<string | null>
  setApiKey(key: string): Promise<void>
  evaluateBet(input: CalcInput): Promise<CalcResponse>
  analyzeMatch(input: AnalysisInput): Promise<AnalysisResponse>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
