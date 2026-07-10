import { z } from 'zod'
import { requestValidated } from './json'
import type { ClaudeCaller } from './claude'
import type { MatchDescription } from '../adapters/types'

export interface ExpertVerdict {
  lean: 'A' | 'B' | 'none'
  confidence: number // 0..1 — how united/strong expert opinion is
  keyFactors: string[]
  sources: { url: string; title: string }[]
}

const verdictSchema = z.object({
  lean: z.enum(['A', 'B', 'none']),
  confidence: z.number().min(0).max(1),
  keyFactors: z.array(z.string()).min(1),
  sources: z.array(z.object({ url: z.string(), title: z.string() }))
})

// Maps expert lean onto a probability for side A. The blend step later
// bounds this signal to ±10 points, so it can only NUDGE the stats.
export function semanticProbability(verdict: ExpertVerdict): number {
  if (verdict.lean === 'none') return 0.5
  const direction = verdict.lean === 'A' ? 1 : -1
  return 0.5 + direction * 0.5 * verdict.confidence
}

const SYSTEM = `You are gathering EXPERT and COMMUNITY OPINION about an upcoming
match for a betting-risk tool. Use web search to find previews, analyst picks,
and informed community consensus from reputable sources. You are summarizing
what OTHERS think — not making your own prediction. If opinion is split or
scarce, lean "none" or use low confidence. Cite every source you used.
Reply with ONLY a JSON object matching:
{"lean":"A"|"B"|"none","confidence":number(0..1),
"keyFactors":[strings],"sources":[{"url":string,"title":string}]}`

export async function gatherExpertOpinion(
  caller: ClaudeCaller,
  match: MatchDescription
): Promise<ExpertVerdict> {
  const user = `Match: ${match.sideA} (side A) vs ${match.sideB} (side B).${
    match.context ? ` Context: ${match.context}.` : ''
  } Summarize expert/community opinion and return the JSON object.`
  return requestValidated(
    (feedback) => caller(SYSTEM, feedback ? `${user}\n\n${feedback}` : user),
    verdictSchema
  )
}
