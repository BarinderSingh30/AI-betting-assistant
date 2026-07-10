import type { AnalysisResult } from '../../../main/analysis/pipeline'

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`

// Full transparency: every factor, weight, source, and the exact arithmetic.
export function EvidenceTrail({ result }: { result: AnalysisResult }): React.JSX.Element {
  const { verdict, match } = result
  return (
    <div className="evidence-trail">
      <h3>How this verdict was reached</h3>

      <h4>1. Researched facts (weights are fixed in code)</h4>
      <ul>
        {result.factors.map((f) => (
          <li key={f.name}>
            <strong>{f.name}</strong> (weight {f.weight}, leans{' '}
            {f.value > 0 ? match.sideA : f.value < 0 ? match.sideB : 'neither'}{' '}
            {Math.abs(f.value).toFixed(2)}) — {f.evidence}{' '}
            {f.sources.map((s) => (
              <a key={s} href={s} target="_blank" rel="noreferrer">
                [source]
              </a>
            ))}
          </li>
        ))}
      </ul>
      <p>
        Statistics say {match.sideA} wins with probability <strong>{pct(result.pStats)}</strong>.
      </p>

      <h4>2. Expert opinion (can nudge the estimate by at most ±10 points)</h4>
      {result.expert ? (
        <>
          <p>
            Experts lean:{' '}
            {result.expert.lean === 'none'
              ? 'no clear side'
              : result.expert.lean === 'A'
                ? match.sideA
                : match.sideB}{' '}
            (confidence {pct(result.expert.confidence)}) → signal {pct(result.pSem ?? 0.5)}
          </p>
          <ul>
            {result.expert.keyFactors.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
          <p>
            Sources:{' '}
            {result.expert.sources.map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                {s.title}{' '}
              </a>
            ))}
          </p>
        </>
      ) : (
        <p>Not available for this analysis (see warning above).</p>
      )}
      <p>
        Blended final probability: <strong>{pct(result.pFinal)}</strong>
      </p>

      <h4>3. The money math</h4>
      <p>
        Bookmaker implies {match.sideA} {pct(verdict.impliedA)} / {match.sideB}{' '}
        {pct(verdict.impliedB)} (margin {pct(verdict.vig)}; fair for {match.sideA}:{' '}
        {pct(verdict.vigFreeA)}).
      </p>
      <p>
        Expected value — {match.sideA}: {pct(verdict.evA)} · {match.sideB}: {pct(verdict.evB)}.
        Rule: bet only if a side&apos;s EV is at least 4%; stake is quarter-Kelly capped at 2% of
        bankroll.
      </p>
    </div>
  )
}
