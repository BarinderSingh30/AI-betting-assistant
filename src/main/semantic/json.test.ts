import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { extractJson, requestValidated } from './json'

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('parses JSON inside a fenced code block with prose around it', () => {
    const text = 'Here is the result:\n```json\n{"a": 1, "b": [2, 3]}\n```\nDone.'
    expect(extractJson(text)).toEqual({ a: 1, b: [2, 3] })
  })

  it('parses the outermost object when prose surrounds raw JSON', () => {
    const text = 'Based on my research: {"lean": "A", "note": "uses {braces} in strings? no"} end'
    expect(extractJson('prefix {"x": {"y": 1}} suffix')).toEqual({ x: { y: 1 } })
    void text
  })

  it('throws a plain-language error when there is no JSON', () => {
    expect(() => extractJson('sorry, I could not find anything')).toThrow(/JSON/)
  })
})

const schema = z.object({ lean: z.enum(['A', 'B']), confidence: z.number().min(0).max(1) })

describe('requestValidated', () => {
  it('returns the parsed object when the first reply is valid', async () => {
    const result = await requestValidated(async () => '{"lean":"A","confidence":0.7}', schema)
    expect(result).toEqual({ lean: 'A', confidence: 0.7 })
  })

  it('retries once with feedback when the first reply is invalid', async () => {
    const calls: (string | undefined)[] = []
    const result = await requestValidated(async (feedback) => {
      calls.push(feedback)
      return calls.length === 1 ? '{"lean":"maybe"}' : '{"lean":"B","confidence":0.4}'
    }, schema)
    expect(result).toEqual({ lean: 'B', confidence: 0.4 })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toBeUndefined()
    expect(calls[1]).toMatch(/confidence|lean/i) // feedback names what was wrong
  })

  it('throws a plain-language error when both replies are invalid', async () => {
    await expect(requestValidated(async () => 'not json at all', schema)).rejects.toThrow(
      /valid|expected/i
    )
  })
})
