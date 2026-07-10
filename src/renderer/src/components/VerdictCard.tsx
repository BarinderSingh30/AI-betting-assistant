import type { AnalysisResult } from '../../../main/analysis/pipeline'

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`

// The headline answer: which side (if any) and how much money is safe.
export function VerdictCard({ result }: { result: AnalysisResult }): React.JSX.Element {
  const { verdict, match, confidence } = result
  const sideName = verdict.side === 'A' ? match.sideA : verdict.side === 'B' ? match.sideB : null
  return (
    <div className="verdict-card">
      {sideName ? (
        <p className="verdict verdict-bet">
          BET on {sideName} — stake {verdict.stake.toFixed(2)}
        </p>
      ) : (
        <p className="verdict verdict-no-bet">
          NO BET — neither side offers enough value at these odds. You just avoided a losing bet.
        </p>
      )}
      <p className="hint">
        Data confidence: {confidence === 'medium' ? 'Medium (web research)' : 'Low — extra caution'}
        {' · '}Our probability for {match.sideA}: {pct(result.pFinal)}
      </p>
      {result.warnings.map((w) => (
        <p key={w} className="warning-banner">
          ⚠ {w}
        </p>
      ))}
    </div>
  )
}
