import { useMemo, useState } from 'react';
import FormDots from './FormDots';
import ConfidenceBar from './ConfidenceBar';
import EVBadge from './EVBadge';
import KellyStake from './KellyStake';
import TierGate from './TierGate';
import { exportToCSV } from './CSVExport';
import { canSeeEV, canSeeExtras } from '../config/leagues';
import { calculateEV, calculateKelly } from '../lib/ev';

function kickoffStr(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function overConfidenceClass(c) {
  if (c >= 70) return 'green';
  if (c >= 50) return 'yellow';
  return 'red';
}

export default function MatchCard({ match, userTier, onUpgrade }) {
  const [overOdds, setOverOdds] = useState('');
  const [bttsOdds, setBttsOdds] = useState('');
  const [showAnalysis, setShowAnalysis] = useState(false);

  const hasEV = canSeeEV(userTier);
  const hasExtras = canSeeExtras(userTier);
  const isEdge = userTier === 'EDGE';

  const over = match.predictions && match.predictions.over;
  const btts = match.predictions && match.predictions.btts;
  const firstHalf = match.predictions && match.predictions.firstHalf;
  const ah = match.predictions && match.predictions.asianHandicap;

  const evOver = useMemo(
    () => (overOdds && over ? calculateEV(over.confidence, overOdds) : null),
    [overOdds, over],
  );
  const evBtts = useMemo(
    () => (bttsOdds && btts ? calculateEV(btts.confidence, bttsOdds) : null),
    [bttsOdds, btts],
  );
  const kellyOver = useMemo(
    () => (overOdds && over ? calculateKelly(over.confidence, overOdds) : 0),
    [overOdds, over],
  );
  const kellyBtts = useMemo(
    () => (bttsOdds && btts ? calculateKelly(btts.confidence, bttsOdds) : 0),
    [bttsOdds, btts],
  );

  if (match.error) {
    return (
      <div className="card match-card">
        <div className="teams">
          <div className="team-block">
            <div className="team-name">{match.home && match.home.name}</div>
          </div>
          <div className="vs">vs</div>
          <div className="team-block right">
            <div className="team-name">{match.away && match.away.name}</div>
          </div>
        </div>
        <div className="muted small">{match.error}</div>
      </div>
    );
  }

  return (
    <div className="card match-card">
      <div className="spread">
        <div className="kickoff mono">{kickoffStr(match.kickoff)}</div>
        {isEdge && (
          <button
            className="btn btn-ghost small"
            style={{ padding: '4px 10px' }}
            onClick={() => exportToCSV([match])}
            title="Export this match"
          >
            ⬇ CSV
          </button>
        )}
      </div>

      <div className="teams">
        <div className="team-block">
          <div className="team-name">{match.home && match.home.name}</div>
          {match.home && match.home.restDays != null && (
            <span className="mono small muted">{match.home.restDays}d rest</span>
          )}
          <FormDots form={match.home && match.home.form} />
        </div>
        <div className="vs">vs</div>
        <div className="team-block right">
          <div className="team-name">{match.away && match.away.name}</div>
          {match.away && match.away.restDays != null && (
            <span className="mono small muted">{match.away.restDays}d rest</span>
          )}
          <FormDots form={match.away && match.away.form} />
        </div>
      </div>

      {over && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="spread">
            <span className={`badge ${overConfidenceClass(over.confidence)} mono`}>
              OVER {over.line} ✓
            </span>
            <span className="mono small muted">{over.confidence}%</span>
          </div>
          <ConfidenceBar value={over.confidence} />
        </div>
      )}

      {btts && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="spread">
            <span className={`badge ${btts.prediction === 'YES' ? 'green' : 'red'} mono`}>
              BTTS {btts.prediction}
            </span>
            <span className="mono small muted">{btts.confidence}%</span>
          </div>
          <ConfidenceBar value={btts.confidence} />
        </div>
      )}

      {/* EV section (Analyst+) */}
      {hasEV ? (
        <div className="stack" style={{ gap: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <div className="spread">
            <div style={{ flex: 1 }}>
              <label className="label">Over odds</label>
              <input
                type="number"
                step="0.01"
                min="1"
                className="input"
                value={overOdds}
                onChange={(e) => setOverOdds(e.target.value)}
                placeholder="e.g. 1.85"
              />
              <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 6 }}>
                <EVBadge ev={evOver} />
                <KellyStake kelly={kellyOver} />
              </div>
            </div>
          </div>
          <div className="spread">
            <div style={{ flex: 1 }}>
              <label className="label">BTTS odds</label>
              <input
                type="number"
                step="0.01"
                min="1"
                className="input"
                value={bttsOdds}
                onChange={(e) => setBttsOdds(e.target.value)}
                placeholder="e.g. 1.90"
              />
              <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 6 }}>
                <EVBadge ev={evBtts} />
                <KellyStake kelly={kellyBtts} />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <TierGate requiredTier="ANALYST" onUpgrade={onUpgrade}>
          <div className="stack" style={{ gap: 10 }}>
            <div>
              <label className="label">Over odds</label>
              <input className="input" placeholder="1.85" readOnly />
            </div>
            <div>
              <label className="label">BTTS odds</label>
              <input className="input" placeholder="1.90" readOnly />
            </div>
          </div>
        </TierGate>
      )}

      {/* First half + Asian handicap (Edge) */}
      {hasExtras ? (
        (firstHalf || ah) && (
          <div className="stack" style={{ gap: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
            {firstHalf && (
              <div className="spread">
                <span className={`badge ${overConfidenceClass(firstHalf.confidence)} mono`}>
                  1H OVER {firstHalf.line}
                </span>
                <span className="mono small muted">{firstHalf.confidence}%</span>
              </div>
            )}
            {ah && (
              <div className="spread">
                <span className="badge accent mono">
                  AH {ah.line} ({ah.team})
                </span>
                <span className="mono small muted">{ah.confidence}%</span>
              </div>
            )}
          </div>
        )
      ) : (
        <TierGate requiredTier="EDGE" onUpgrade={onUpgrade}>
          <div className="stack" style={{ gap: 10 }}>
            <span className="badge mono">1H OVER 1.5</span>
            <span className="badge mono">AH -0.5</span>
          </div>
        </TierGate>
      )}

      {/* Reasoning section */}
      <div>
        <button
          className="btn btn-ghost small"
          onClick={() => (hasEV ? setShowAnalysis((s) => !s) : onUpgrade('ANALYST'))}
        >
          {showAnalysis ? 'Hide Analysis ▲' : 'Show Analysis ▼'}
        </button>
        {hasEV && showAnalysis && (
          <div className="stack" style={{ gap: 10, marginTop: 12 }}>
            {over && over.reasoning && (
              <div>
                <div className="label">Over reasoning</div>
                <div className="small">{over.reasoning}</div>
              </div>
            )}
            {btts && btts.reasoning && (
              <div>
                <div className="label">BTTS reasoning</div>
                <div className="small">{btts.reasoning}</div>
              </div>
            )}
            {firstHalf && firstHalf.reasoning && (
              <div>
                <div className="label">First half reasoning</div>
                <div className="small">{firstHalf.reasoning}</div>
              </div>
            )}
            {ah && ah.reasoning && (
              <div>
                <div className="label">Asian handicap reasoning</div>
                <div className="small">{ah.reasoning}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
