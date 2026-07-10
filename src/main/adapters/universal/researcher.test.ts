import { describe, expect, it } from 'vitest'
import { researchMatch, toEngineFactors } from './researcher'
import { CATEGORY_WEIGHTS } from '../types'

const validReply = JSON.stringify({
  factors: [
    {
      category: 'form',
      name: 'Recent form',
      value: 0.5,
      evidence: 'A won 8 of last 10; B won 5 of last 10',
      sources: ['https://example.com/results']
    },
    {
      category: 'ranking',
      name: 'World ranking',
      value: 0.2,
      evidence: 'A ranked #2, B ranked #3',
      sources: ['https://example.com/rankings']
    }
  ],
  dataQuality: 'good'
})

describe('researchMatch', () => {
  it('returns a validated ResearchResult from a good AI reply', async () => {
    const result = await researchMatch(async () => validReply, {
      sideA: 'Alcaraz',
      sideB: 'Sinner',
      context: 'Wimbledon SF'
    })
    expect(result.dataQuality).toBe('good')
    expect(result.factors).toHaveLength(2)
    expect(result.factors[0].value).toBe(0.5)
  })

  it('includes both side names in the prompt sent to the AI', async () => {
    let seenUser = ''
    await researchMatch(
      async (_system, user) => {
        seenUser = user ?? ''
        return validReply
      },
      { sideA: 'Alcaraz', sideB: 'Sinner', context: 'Wimbledon SF' }
    )
    expect(seenUser).toContain('Alcaraz')
    expect(seenUser).toContain('Sinner')
    expect(seenUser).toContain('Wimbledon SF')
  })

  it('rejects out-of-range factor values via the schema (after retry)', async () => {
    const bad = JSON.stringify({
      factors: [
        { category: 'form', name: 'x', value: 3, evidence: 'e', sources: [] }
      ],
      dataQuality: 'good'
    })
    await expect(
      researchMatch(async () => bad, { sideA: 'A', sideB: 'B', context: '' })
    ).rejects.toThrow(/valid/i)
  })
})

describe('toEngineFactors', () => {
  it('attaches the fixed code-owned weight per category', () => {
    const engine = toEngineFactors([
      { category: 'form', name: 'f', value: 0.5, evidence: 'e', sources: [] },
      { category: 'headToHead', name: 'h', value: -0.2, evidence: 'e', sources: [] }
    ])
    expect(engine).toEqual([
      { name: 'f', weight: CATEGORY_WEIGHTS.form, value: 0.5 },
      { name: 'h', weight: CATEGORY_WEIGHTS.headToHead, value: -0.2 }
    ])
  })
})
