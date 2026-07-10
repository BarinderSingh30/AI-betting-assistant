import { describe, expect, it } from 'vitest'
import { gatherExpertOpinion, semanticProbability } from './analyst'

// semanticProbability maps (lean, confidence) onto 0..1:
//   none        -> 0.5 exactly
//   A, conf c   -> 0.5 + 0.5*c   (A with full confidence -> 1.0)
//   B, conf c   -> 0.5 - 0.5*c
describe('semanticProbability', () => {
  const base = { keyFactors: ['x'], sources: [] }
  it('is 0.5 when experts have no lean', () => {
    expect(semanticProbability({ lean: 'none', confidence: 0.9, ...base })).toBe(0.5)
  })
  it('leans toward A proportionally to confidence', () => {
    expect(semanticProbability({ lean: 'A', confidence: 0.6, ...base })).toBeCloseTo(0.8, 10)
  })
  it('leans toward B proportionally to confidence', () => {
    expect(semanticProbability({ lean: 'B', confidence: 0.4, ...base })).toBeCloseTo(0.3, 10)
  })
})

const validReply = JSON.stringify({
  lean: 'A',
  confidence: 0.55,
  keyFactors: ['Most previews favor A on grass'],
  sources: [{ url: 'https://example.com/preview', title: 'Match preview' }]
})

describe('gatherExpertOpinion', () => {
  it('returns a validated verdict from a good AI reply', async () => {
    const v = await gatherExpertOpinion(async () => validReply, {
      sideA: 'Alcaraz',
      sideB: 'Sinner',
      context: ''
    })
    expect(v.lean).toBe('A')
    expect(v.sources[0].title).toBe('Match preview')
  })

  it('rejects confidence outside 0..1 (after retry)', async () => {
    const bad = JSON.stringify({ lean: 'A', confidence: 7, keyFactors: ['x'], sources: [] })
    await expect(
      gatherExpertOpinion(async () => bad, { sideA: 'A', sideB: 'B', context: '' })
    ).rejects.toThrow(/valid/i)
  })
})
