import { describe, expect, it } from 'vitest'
import { analyzeMatch } from './pipeline'
import type { ResearchResult } from '../adapters/types'
import type { ExpertVerdict } from '../semantic/analyst'

const research: ResearchResult = {
  factors: [
    { category: 'form', name: 'Form', value: 0.5, evidence: 'e', sources: ['https://x'] },
    { category: 'ranking', name: 'Rank', value: 0.3, evidence: 'e', sources: [] }
  ],
  dataQuality: 'good'
}
const expert: ExpertVerdict = {
  lean: 'A',
  confidence: 0.6,
  keyFactors: ['previews favor A'],
  sources: [{ url: 'https://y', title: 'preview' }]
}
const input = {
  sideA: 'A-team',
  sideB: 'B-team',
  context: '',
  oddsA: 2.4,
  oddsB: 1.6,
  bankroll: 1000
}

// Hand-computed pStats: weights form=3, ranking=3 -> score=(3*0.5+3*0.3)/6=0.4
//   pStats = 0.5 + 0.5*0.4 = 0.70
// pSem = 0.5 + 0.5*0.6 = 0.80 ; blend raw = 0.7*0.7 + 0.3*0.8 = 0.73 (shift 0.03 < 0.10)
// pFinal = 0.73 ; evA = 0.73*2.4 - 1 = 0.752 -> BET A
describe('analyzeMatch', () => {
  it('runs the full chain: research -> stats -> expert -> blend -> verdict', async () => {
    const result = await analyzeMatch(input, {
      research: async () => research,
      expertOpinion: async () => expert
    })
    expect(result.pStats).toBeCloseTo(0.7, 10)
    expect(result.pSem).toBeCloseTo(0.8, 10)
    expect(result.pFinal).toBeCloseTo(0.73, 10)
    expect(result.verdict.side).toBe('A')
    expect(result.confidence).toBe('medium')
    expect(result.warnings).toHaveLength(0)
    expect(result.factors[0].weight).toBe(3) // code-owned weight attached for display
  })

  it('degrades to stats-only when the expert step fails (never silent)', async () => {
    const result = await analyzeMatch(input, {
      research: async () => research,
      expertOpinion: async () => {
        throw new Error('search down')
      }
    })
    expect(result.pSem).toBeNull()
    expect(result.pFinal).toBeCloseTo(result.pStats, 10)
    expect(result.confidence).toBe('low')
    expect(result.warnings.join(' ')).toMatch(/expert/i)
  })

  it('labels poor research data as low confidence with a warning', async () => {
    const result = await analyzeMatch(input, {
      research: async () => ({ ...research, dataQuality: 'poor' as const }),
      expertOpinion: async () => expert
    })
    expect(result.confidence).toBe('low')
    expect(result.warnings.join(' ')).toMatch(/limited|thin|poor/i)
  })

  it('fails loudly when research itself fails', async () => {
    await expect(
      analyzeMatch(input, {
        research: async () => {
          throw new Error('no internet')
        },
        expertOpinion: async () => expert
      })
    ).rejects.toThrow(/no internet/)
  })

  it('validates odds before doing any AI work', async () => {
    let researchCalled = false
    await expect(
      analyzeMatch(
        { ...input, oddsA: 0.9 },
        {
          research: async () => {
            researchCalled = true
            return research
          },
          expertOpinion: async () => expert
        }
      )
    ).rejects.toThrow(/odds/i)
    expect(researchCalled).toBe(false)
  })
})
