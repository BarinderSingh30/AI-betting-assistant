import { ipcMain } from 'electron'
import type { SettingsStore } from './store/settings'
import { readApiKey, writeApiKey } from './store/apiKey'
import { decide, type CalcInput, type CalcResponse } from './engine/decision'
import { analyzeMatch, type AnalysisInput, type AnalysisResponse } from './analysis/pipeline'
import { createWebSearchCaller, explainApiError } from './semantic/claude'
import { researchMatch } from './adapters/universal/researcher'
import { gatherExpertOpinion } from './semantic/analyst'

export function registerIpc(settings: SettingsStore): void {
  ipcMain.handle('settings:getApiKey', () => readApiKey(settings))

  ipcMain.handle('settings:setApiKey', (_event, key: string) => {
    writeApiKey(settings, key)
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

  ipcMain.handle(
    'analysis:run',
    async (_event, input: AnalysisInput): Promise<AnalysisResponse> => {
      const apiKey = readApiKey(settings)
      if (!apiKey) {
        return {
          ok: false,
          error:
            'No Anthropic API key is saved yet. Open Settings, paste your API key, and save it — then try the analysis again.'
        }
      }
      const caller = createWebSearchCaller(apiKey)
      try {
        const result = await analyzeMatch(input, {
          research: (match) => researchMatch(caller, match),
          expertOpinion: (match) => gatherExpertOpinion(caller, match)
        })
        return { ok: true, result }
      } catch (err) {
        return { ok: false, error: explainApiError(err) }
      }
    }
  )
}
