import { useState } from 'react'
import type { CalcResult } from '../../../main/engine/decision'

// Temporary Phase 2 page: enter a probability and odds by hand and watch
// the engine's EV / verdict / stake math work. Replaced by the real
// Analysis flow in Phase 3.
export function Calculator(): React.JSX.Element {
  const [probPct, setProbPct] = useState('')
  const [odds, setOdds] = useState('')
  const [oppOdds, setOppOdds] = useState('')
  const [bankroll, setBankroll] = useState('1000')
  const [result, setResult] = useState<CalcResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function calculate(): Promise<void> {
    setError(null)
    setResult(null)
    const response = await window.api.evaluateBet({
      pFinal: Number(probPct) / 100,
      decimalOdds: Number(odds),
      oppositeOdds: oppOdds.trim() === '' ? undefined : Number(oppOdds),
      bankroll: Number(bankroll)
    })
    if (response.ok) setResult(response.result)
    else setError(response.error)
  }

  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`
  const ready = probPct.trim() !== '' && odds.trim() !== '' && bankroll.trim() !== ''

  return (
    <div className="page">
      <h2>Calculator</h2>
      <p className="hint">
        Temporary page to see the betting math work. Enter how likely you think your side is to win,
        the bookmaker&apos;s decimal odds, and your bankroll.
      </p>

      <label htmlFor="prob">Your win probability (%)</label>
      <input
        id="prob"
        value={probPct}
        placeholder="55"
        onChange={(e) => setProbPct(e.target.value)}
      />

      <label htmlFor="odds">Decimal odds for your side</label>
      <input id="odds" value={odds} placeholder="2.10" onChange={(e) => setOdds(e.target.value)} />

      <label htmlFor="opp-odds">Decimal odds for the other side (optional, shows the vig)</label>
      <input
        id="opp-odds"
        value={oppOdds}
        placeholder="1.75"
        onChange={(e) => setOppOdds(e.target.value)}
      />

      <label htmlFor="bankroll">Bankroll</label>
      <input id="bankroll" value={bankroll} onChange={(e) => setBankroll(e.target.value)} />

      <button onClick={calculate} disabled={!ready}>
        Calculate
      </button>

      {error && <p className="status-error">{error}</p>}

      {result && (
        <div className="calc-result">
          <p
            className={result.verdict === 'BET' ? 'verdict verdict-bet' : 'verdict verdict-no-bet'}
          >
            {result.verdict === 'BET'
              ? `BET — stake ${result.stake.toFixed(2)}`
              : 'NO BET — you just avoided a losing bet'}
          </p>
          <p>Bookmaker&apos;s implied probability: {pct(result.impliedProbability)}</p>
          {result.vigFreeProbability !== null && result.vig !== null && (
            <p>
              After removing the bookmaker&apos;s margin (vig {pct(result.vig)}):{' '}
              {pct(result.vigFreeProbability)}
            </p>
          )}
          <p>Expected value: {pct(result.ev)} per unit staked</p>
          <p className="hint">
            Rule: bet only when expected value is at least 4%. Stake is quarter-Kelly, capped at 2%
            of bankroll.
          </p>
        </div>
      )}
    </div>
  )
}
