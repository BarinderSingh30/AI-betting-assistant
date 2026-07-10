import { describe, expect, it } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { collectSearchedText, explainApiError } from './claude'

type FakeResponse = { stop_reason: string; content: { type: string; text?: string }[] }

function fakeCreate(responses: FakeResponse[]): {
  create: (params: unknown) => Promise<FakeResponse>
  calls: unknown[]
} {
  const calls: unknown[] = []
  let i = 0
  return {
    calls,
    create: async (params) => {
      calls.push(params)
      return responses[i++]
    }
  }
}

describe('collectSearchedText', () => {
  it('returns joined text blocks from a single completed response', async () => {
    const { create } = fakeCreate([
      {
        stop_reason: 'end_turn',
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'web_search_tool_result' },
          { type: 'text', text: 'world' }
        ]
      }
    ])
    const text = await collectSearchedText(create as never, {
      model: 'claude-sonnet-5',
      system: 's',
      user: 'u'
    })
    expect(text).toBe('Hello world')
  })

  it('resumes after pause_turn and joins text across responses', async () => {
    const { create, calls } = fakeCreate([
      { stop_reason: 'pause_turn', content: [{ type: 'text', text: 'part1 ' }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'part2' }] }
    ])
    const text = await collectSearchedText(create as never, {
      model: 'claude-sonnet-5',
      system: 's',
      user: 'u'
    })
    expect(text).toBe('part1 part2')
    expect(calls).toHaveLength(2)
  })

  it('gives up after 5 pauses with a plain error', async () => {
    const paused = { stop_reason: 'pause_turn', content: [] as { type: string }[] }
    const { create } = fakeCreate(Array(6).fill(paused))
    await expect(
      collectSearchedText(create as never, { model: 'claude-sonnet-5', system: 's', user: 'u' })
    ).rejects.toThrow(/too long/i)
  })

  it('reports a refusal in plain language', async () => {
    const { create } = fakeCreate([{ stop_reason: 'refusal', content: [] }])
    await expect(
      collectSearchedText(create as never, { model: 'claude-sonnet-5', system: 's', user: 'u' })
    ).rejects.toThrow(/declined/i)
  })
})

describe('explainApiError', () => {
  it('explains an invalid API key', () => {
    const err = new Anthropic.AuthenticationError(
      401,
      { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
      'invalid x-api-key',
      new Headers()
    )
    expect(explainApiError(err)).toMatch(/API key/i)
  })

  it('passes through plain Errors and stringifies the rest', () => {
    expect(explainApiError(new Error('boom'))).toBe('boom')
    expect(explainApiError('weird')).toMatch(/wrong/i)
  })
})
