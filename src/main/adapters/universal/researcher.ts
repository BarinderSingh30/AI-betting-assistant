import { z } from 'zod'
import { requestValidated } from '../../semantic/json'
import type { ClaudeCaller } from '../../semantic/claude'
import type { Factor } from '../../engine/probability'
import {
  CATEGORY_WEIGHTS,
  type MatchDescription,
  type ResearchFactor,
  type ResearchResult
} from '../types'

const researchSchema = z.object({
  factors: z
    .array(
      z.object({
        category: z.enum(['form', 'ranking', 'headToHead', 'context']),
        name: z.string().min(1),
        value: z.number().min(-1).max(1),
        evidence: z.string().min(1),
        sources: z.array(z.string())
      })
    )
    .min(1),
  dataQuality: z.enum(['good', 'partial', 'poor'])
})

const SYSTEM = `You are a sports research assistant inside a betting-risk tool.
Research ONLY verifiable facts about the upcoming match using web search:
recent form, rankings/ratings, head-to-head record, and context (venue,
injuries, roster changes, surface, LAN/online). Do NOT predict a winner and
do NOT consider betting odds. Score each factor for how much the FACTS favor
side A: +1 strongly favors A, -1 strongly favors B, 0 neutral. Be conservative:
if data is thin, use small values and set dataQuality accordingly.
Reply with ONLY a JSON object matching:
{"factors":[{"category":"form"|"ranking"|"headToHead"|"context","name":string,
"value":number(-1..1),"evidence":string,"sources":[url strings]}],
"dataQuality":"good"|"partial"|"poor"}`

export async function researchMatch(
  caller: ClaudeCaller,
  match: MatchDescription
): Promise<ResearchResult> {
  const user = `Match: ${match.sideA} (side A) vs ${match.sideB} (side B).${
    match.context ? ` Context: ${match.context}.` : ''
  } Research the factual record and return the JSON object.`
  return requestValidated(
    (feedback) => caller(SYSTEM, feedback ? `${user}\n\n${feedback}` : user),
    researchSchema
  )
}

// The AI supplied bounded values; the code owns the weights.
export function toEngineFactors(factors: ResearchFactor[]): Factor[] {
  return factors.map((f) => ({
    name: f.name,
    weight: CATEGORY_WEIGHTS[f.category],
    value: f.value
  }))
}
