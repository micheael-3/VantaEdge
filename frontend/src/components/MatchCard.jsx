import { useState } from 'react';
import ConfidenceBadge from './ConfidenceBadge.jsx';
import EVInput from './EVInput.jsx';
import FormDots from './FormDots.jsx';
import { formatKickoff } from '../lib/dateLabel.js';

export default function MatchCard({ fixture }) {
  const [showAnalysis, setShowAnalysis] = useState(false);

  if (!fixture) return null;

  // Per-fixture error path: backend pipeline failed for just this match.
  if (fixture.error) {
    return (
      <div className="error-card">
        <div className="match-meta">{formatKickoff(fixture.kickoff, fixture.league)}</div>
        <div className="match-teams">
          {fixture.home && fixture.home.name}
          <span className="vs">vs</span>
          {fixture.away && fixture.away.name}
        </div>
        <div className="error-text">Analysis failed: {fixture.error}</div>
      </div>
    );
  }

  const home = fixture.home || {};
  const away = fixture.away || {};
  const over = (fixture.predictions && fixture.predictions.over) || {};
  const btts = (fixture.predictions && fixture.predictions.btts) || {};
  const result = fixture.actualResult;
  const isPast = !!result;

  const overHit = isPast ? result.overHit : null;
  const bttsHit = isPast ? result.bttsHit : null;

  let cardKlass = 'match-card';
  if (isPast) {
    const oneHit = overHit === true || bttsHit === true;
    const allMiss = overHit === false && bttsHit === false;
    if (oneHit) cardKlass += ' past-hit';
    else if (allMiss) cardKlass += ' past-miss';
  }

  return (
    <div className={cardKlass}>
      <div className="match-meta">{formatKickoff(fixture.kickoff, fixture.league || 'MLS')}</div>
      <div className="match-teams">
        {home.name || 'Home'}
        <span className="vs">vs</span>
        {away.name || 'Away'}
      </div>

      <div className="match-form">
        <div className="team-form">
          <span className="tf-label">{home.name || 'Home'}</span>
          <FormDots form={home.form} />
        </div>
        <div className="team-form">
          <span className="tf-label">{away.name || 'Away'}</span>
          <FormDots form={away.form} />
        </div>
      </div>

      {isPast && (
        <div className="score-line">
          FT {result.homeGoals}–{result.awayGoals}
        </div>
      )}

      <div className="predictions-row">
        <ConfidenceBadge
          label={`OVER ${over.line != null ? over.line : '2.5'}`}
          confidence={over.confidence}
          result={overHit}
        />
        <ConfidenceBadge
          label={`BTTS ${btts.prediction || '—'}`}
          confidence={btts.confidence}
          result={bttsHit}
        />
      </div>

      <EVInput overConfidence={over.confidence} bttsConfidence={btts.confidence} />

      <button
        type="button"
        className="analysis-toggle"
        onClick={() => setShowAnalysis((v) => !v)}
        aria-expanded={showAnalysis}
      >
        {showAnalysis ? 'Hide analysis ▲' : 'Show analysis ▼'}
      </button>

      {showAnalysis && (
        <div className="analysis-body">
          <h4>Over {over.line != null ? over.line : '2.5'}</h4>
          <p>{over.reasoning || 'No reasoning available.'}</p>
          <h4>BTTS</h4>
          <p>{btts.reasoning || 'No reasoning available.'}</p>
        </div>
      )}
    </div>
  );
}
