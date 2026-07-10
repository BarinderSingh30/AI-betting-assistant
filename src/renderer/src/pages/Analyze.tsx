import { useState } from 'react'
import type { AnalysisResult } from '../../../main/analysis/pipeline'
import { VerdictCard } from '../components/VerdictCard'
import { EvidenceTrail } from '../components/EvidenceTrail'

// The core Phase 3 screen: describe any match + your bookmaker's odds,
// get a cited verdict. The AI research runs in the main process.
export function Analyze(): React.JSX.Element {
  const [sideA, setSideA] = useState('')
  const [sideB, setSideB] = useState('')
  const [context, setContext] = useState('')
  const [oddsA, setOddsA] = useState('')
  const [oddsB, setOddsB] = useState('')
  const [bankroll, setBankroll] = useState('1000')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)

  const ready =
    !busy &&
    [sideA, sideB, oddsA, oddsB, bankroll].every((v) => v.trim() !== '')

  async function run(): Promise<void> {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const response = await window.api.analyzeMatch({
        sideA: sideA.trim(),
        sideB: sideB.trim(),
        context: context.trim(),
        oddsA: Number(oddsA),
        oddsB: Number(oddsB),
        bankroll: Number(bankroll)
      })
      if (response.ok) setResult(response.result)
      else setError(response.error)
    } catch {
      setError('The analysis failed unexpectedly. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <h2>Analyze</h2>
      <p className="hint">
        Enter any real upcoming match and the decimal odds your bookmaker shows. The AI researches
        the match on the web; the app&apos;s own math decides if a bet is worth it.
      </p>

      <label htmlFor="side-a">Side A (first team/player)</label>
      <input id="side-a" value={sideA} placeholder="Alcaraz" onChange={(e) => setSideA(e.target.value)} />

      <label htmlFor="side-b">Side B (second team/player)</label>
      <input id="side-b" value={sideB} placeholder="Sinner" onChange={(e) => setSideB(e.target.value)} />

      <label htmlFor="context">Competition / context (optional but helps)</label>
      <input
        id="context"
        value={context}
        placeholder="Wimbledon semi-final, 11 July 2026"
        onChange={(e) => setContext(e.target.value)}
      />

      <label htmlFor="odds-a">Decimal odds for side A</label>
      <input id="odds-a" value={oddsA} placeholder="2.10" onChange={(e) => setOddsA(e.target.value)} />

      <label htmlFor="odds-b">Decimal odds for side B</label>
      <input id="odds-b" value={oddsB} placeholder="1.75" onChange={(e) => setOddsB(e.target.value)} />

      <label htmlFor="bankroll">Bankroll</label>
      <input id="bankroll" value={bankroll} onChange={(e) => setBankroll(e.target.value)} />

      <button onClick={run} disabled={!ready}>
        {busy ? 'Analyzing…' : 'Analyze match'}
      </button>

      {busy && (
        <p className="hint">
          Researching the match on the web — this usually takes one to three minutes. Two AI
          research passes run: facts first, then expert opinion.
        </p>
      )}

      {error && <p className="status-error">{error}</p>}

      {result && (
        <>
          <VerdictCard result={result} />
          <EvidenceTrail result={result} />
        </>
      )}
    </div>
  )
}
