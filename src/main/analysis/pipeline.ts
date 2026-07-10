import { statsProbability } from '../engine/probability'
import { blendProbabilities } from '../engine/blend'
import { decideMatch, type MatchVerdict } from '../engine/match'
import { assertOdds } from '../engine/odds'
import { assertBankroll } from '../engine/kelly'
import { toEngineFactors } from '../adapters/universal/researcher'
import { semanticProbability, type ExpertVerdict } from '../semantic/analyst'
import {
  CATEGORY_WEIGHTS,
  type MatchDescription,
  type ResearchFactor,
  type ResearchResult
} from '../adapters/types'

export interface AnalysisInput {
  sideA: string
  sideB: string
  context: string
  oddsA: number
  oddsB: number
  bankroll: number
}

export interface AnalysisResult {
  match: MatchDescription
  pStats: number
  pSem: number | null
  pFinal: number
  factors: (ResearchFactor & { weight: number })[]
  dataQuality: 'good' | 'partial' | 'poor'
  expert: ExpertVerdict | null
  verdict: MatchVerdict
  confidence: 'medium' | 'low'
  warnings: string[]
}

export type AnalysisResponse = { ok: true; result: AnalysisResult } | { ok: false; error: string }

export interface PipelineDeps {
  research: (match: MatchDescription) => Promise<ResearchResult>
  expertOpinion: (match: MatchDescription) => Promise<ExpertVerdict>
}

// The full analysis chain. The AI steps only READ the world; every number
// that touches money comes from the tested engine functions.
export async function analyzeMatch(
  input: AnalysisInput,
  deps: PipelineDeps
): Promise<AnalysisResult> {
  assertOdds(input.oddsA)
  assertOdds(input.oddsB)
  assertBankroll(input.bankroll)

  const match: MatchDescription = {
    sideA: input.sideA,
    sideB: input.sideB,
    context: input.context
  }
  const warnings: string[] = []

  // Step 1: facts (required — without facts there is nothing to analyze)
  const research = await deps.research(match)
  const pStats = statsProbability(toEngineFactors(research.factors))

  // Step 2: expert opinion (optional — degrade with a visible warning)
  let expert: ExpertVerdict | null = null
  let pSem: number | null = null
  try {
    expert = await deps.expertOpinion(match)
    pSem = semanticProbability(expert)
  } catch (err) {
    warnings.push(
      'Expert-opinion research failed (' +
        (err instanceof Error ? err.message : 'unknown error') +
        ') — this verdict uses statistics only.'
    )
  }

  // Step 3: blend (bounded ±10 points) and decide (EV gate + quarter-Kelly)
  const pFinal = pSem === null ? pStats : blendProbabilities(pStats, pSem)
  const verdict = decideMatch({
    pA: pFinal,
    oddsA: input.oddsA,
    oddsB: input.oddsB,
    bankroll: input.bankroll
  })

  if (research.dataQuality === 'poor') {
    warnings.push('The research found only limited data for this match — treat with extra caution.')
  }
  const confidence: 'medium' | 'low' =
    pSem === null || research.dataQuality === 'poor' ? 'low' : 'medium'

  return {
    match,
    pStats,
    pSem,
    pFinal,
    factors: research.factors.map((f) => ({ ...f, weight: CATEGORY_WEIGHTS[f.category] })),
    dataQuality: research.dataQuality,
    expert,
    verdict,
    confidence,
    warnings
  }
}
