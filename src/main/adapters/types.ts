// Shared shapes for the app's single universal analyzer.
// A "factor" is one researched fact scored for how much it favors side A.

export interface MatchDescription {
  sideA: string // e.g. "Alcaraz"
  sideB: string // e.g. "Sinner"
  context: string // e.g. "Wimbledon semi-final 2026" — may be ''
}

export type FactorCategory = 'form' | 'ranking' | 'headToHead' | 'context'

// The AI supplies bounded values and evidence; the CODE owns the weights
// and all math. Weights are fixed here, per category.
export const CATEGORY_WEIGHTS: Record<FactorCategory, number> = {
  form: 3,
  ranking: 3,
  headToHead: 2,
  context: 2
}

export interface ResearchFactor {
  category: FactorCategory
  name: string // short label, e.g. "Recent form (last 10 matches)"
  value: number // -1 (strongly favors side B) .. +1 (strongly favors side A)
  evidence: string // one-sentence factual summary
  sources: string[] // URLs the fact came from
}

export interface ResearchResult {
  factors: ResearchFactor[]
  dataQuality: 'good' | 'partial' | 'poor'
}
