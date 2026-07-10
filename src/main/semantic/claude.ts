import Anthropic from '@anthropic-ai/sdk'

export const DEFAULT_MODEL = 'claude-sonnet-5'

// One function type both AI steps depend on, so tests can inject fakes.
export type ClaudeCaller = (system: string, user: string) => Promise<string>

interface SearchParams {
  model: string
  system: string
  user: string
}

type CreateFn = (params: {
  model: string
  max_tokens: number
  system: string
  messages: { role: 'user' | 'assistant'; content: unknown }[]
  tools: { type: string; name: string; max_uses?: number }[]
}) => Promise<{ stop_reason: string | null; content: { type: string; text?: string }[] }>

// Runs one Claude request with the web_search server tool. Web searches run
// on Anthropic's side; if the turn pauses (stop_reason 'pause_turn') we
// re-send to let it continue, and join all text the model produced.
export async function collectSearchedText(create: CreateFn, params: SearchParams): Promise<string> {
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [
    { role: 'user', content: params.user }
  ]
  let text = ''
  for (let round = 0; round < 6; round++) {
    const response = await create({
      model: params.model,
      max_tokens: 8000,
      system: params.system,
      messages,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }]
    })
    for (const block of response.content) {
      if (block.type === 'text' && block.text) text += block.text
    }
    if (response.stop_reason === 'refusal') {
      throw new Error('The AI declined to answer this request')
    }
    if (response.stop_reason !== 'pause_turn') return text
    messages.push({ role: 'assistant', content: response.content })
  }
  throw new Error('The research took too long and was stopped — please try again')
}

export function createWebSearchCaller(apiKey: string, model = DEFAULT_MODEL): ClaudeCaller {
  const client = new Anthropic({ apiKey, timeout: 10 * 60 * 1000, maxRetries: 2 })
  return (system, user) =>
    collectSearchedText((p) => client.messages.create(p as never) as never, {
      model,
      system,
      user
    })
}

// Turns SDK errors into sentences a non-programmer can act on.
export function explainApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'Your Anthropic API key was rejected. Open Settings and check that the key is correct.'
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return 'Your Anthropic account does not allow this request — check your plan and credits at console.anthropic.com.'
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'The AI service is rate-limiting requests right now. Wait a minute and try again.'
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the AI service — check your internet connection and try again.'
  }
  if (err instanceof Anthropic.APIError) {
    return `The AI service returned an error (${err.status ?? 'unknown'}). Try again in a moment.`
  }
  if (err instanceof Error) return err.message
  return 'Something went wrong during the analysis'
}
