import type { z } from 'zod'

// The AI is asked to reply with a JSON object, but models sometimes wrap it
// in prose or a ```json fence. This finds and parses the first object.
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  if (start === -1) throw new Error('The AI reply contained no JSON object')
  // Walk to the matching closing brace (string-aware).
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]
    if (escaped) {
      escaped = false
    } else if (ch === '\\') {
      escaped = true
    } else if (ch === '"') {
      inString = !inString
    } else if (!inString) {
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) return JSON.parse(candidate.slice(start, i + 1))
      }
    }
  }
  throw new Error('The AI reply contained an incomplete JSON object')
}

// Ask -> validate -> (if invalid) ask once more with feedback -> validate.
// The app never trusts AI output that hasn't passed the schema.
export async function requestValidated<T>(
  call: (feedback?: string) => Promise<string>,
  schema: z.ZodType<T>
): Promise<T> {
  let feedback: string | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await call(feedback)
    try {
      const parsed = schema.safeParse(extractJson(reply))
      if (parsed.success) return parsed.data
      feedback =
        'Your previous reply did not match the required JSON schema. Problems: ' +
        parsed.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ') +
        '. Reply again with ONLY a corrected JSON object.'
    } catch (err) {
      feedback =
        'Your previous reply was not parseable JSON (' +
        (err instanceof Error ? err.message : 'unknown error') +
        '). Reply again with ONLY a valid JSON object.'
    }
  }
  throw new Error('The AI did not return a valid, expected answer after a retry')
}
