import { useState } from 'react';
import FormDots from './FormDots.jsx';
import Icon from './Icon.jsx';
import PredictionRow from './PredictionRow.jsx';
import {
  analysisText,
  avgConceded,
  avgScored,
  bttsLabel,
  effectiveBttsConf,
  effectiveOverConf,
  formatKickoffShort,
  h2hDisplay,
  refereeDisplay,
  restDaysDisplay,
} from '../lib/fixture.js';

// Centrepiece card. Pared back for the casual bettor: header line,
// teams row with form dots, plain-English stats row, two prediction
// rows showing the calibrated confidence, and an expandable AI
// analysis section. No odds inputs, no EV chips, no Kelly, no
// "strong value" badge.
export default function MatchCard({ fixture, isSharp, onUpgrade }) {
  const [showAnalysis, setShowAnalysis] = useState(false);

  if (!fixture) return null;

  // Per-fixture error path: backend pipeline failed for just this match.
  if (fixture.error) {
    return (
      <div
        className="card"
        style={{ padding: 20, borderColor: 'rgba(239,68,68,0.3)' }}
      >
        <div
          className="mono"
          style={{
            fontSize: 10,
            color: 'var(--text-3)',
            letterSpacing: '0.08em',
            marginBottom: 8,
          }}
        >
          MLS · {formatKickoffShort(fixture.kickoff)}
        </div>
        <div
          className="display"
          style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}
        >
          {fixture.home?.name} vs {fixture.away?.name}
        </div>
        <div className="mono" style={{ color: 'var(--text-3)', fontSize: 12 }}>
          Data temporarily unavailable — try refresh
        </div>
      </div>
    );
  }

  const home = fixture.home || {};
  const away = fixture.away || {};
  const aiPending = fixture.aiStatus === 'pending';
  const aiErrored = fixture.aiStatus === 'error';
  // Show the calibrated number transparently — bettor sees one badge,
  // already adjusted for the model's historical hit rate.
  const ouConf = effectiveOverConf(fixture);
  const btsConf = effectiveBttsConf(fixture);
  const overLine = fixture?.predictions?.over?.line ?? 2.5;

  const result = fixture.actualResult;
  const isPast = !!result;

  const handleAnalysisToggle = () => {
    if (!isSharp) {
      if (onUpgrade) onUpgrade();
      return;
    }
    setShowAnalysis((v) => !v);
  };

  return (
    <div
      className="card"
      style={{
        padding: 20,
        position: 'relative',
        borderColor: 'var(--border)',
        overflow: 'hidden',
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 10,
          color: 'var(--text-3)',
          letterSpacing: '0.08em',
          marginBottom: 12,
        }}
      >
        MLS · {formatKickoffShort(fixture.kickoff)}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          gap: 12,
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <div>
          <div
            className="display"
            style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.2 }}
          >
            {home.name || 'Home'}
          </div>
          <div style={{ marginTop: 8 }}>
            <FormDots form={home.form} delay={100} />
          </div>
        </div>
        <div
          className="mono"
          style={{ fontSize: 11, color: 'var(--text-3)', padding: '0 4px' }}
        >
          VS
        </div>
        <div style={{ textAlign: 'right' }}>
          <div
            className="display"
            style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.2 }}
          >
            {away.name || 'Away'}
          </div>
          <div
            style={{
              marginTop: 8,
              display: 'flex',
              justifyContent: 'flex-end',
            }}
          >
            <FormDots form={away.form} delay={400} />
          </div>
        </div>
      </div>

      {isPast && (
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: 'var(--text-2)',
            marginBottom: 10,
            padding: '6px 10px',
            background: 'var(--bg-2)',
            borderRadius: 6,
            display: 'inline-block',
          }}
        >
          FT {result.homeGoals}–{result.awayGoals}
        </div>
      )}

      <div
        className="mono"
        style={{
          fontSize: 12,
          color: 'var(--text-2)',
          padding: '10px 0',
          borderTop: '1px solid var(--border-soft)',
          borderBottom: '1px solid var(--border-soft)',
          marginBottom: 14,
          lineHeight: 1.6,
        }}
      >
        <div>
          Goals avg:{' '}
          <span style={{ color: 'var(--text)' }}>{avgScored(fixture)}</span> scored /{' '}
          <span style={{ color: 'var(--text)' }}>{avgConceded(fixture)}</span> conceded
        </div>
        <div style={{ color: 'var(--text-3)' }}>
          H2H: <span style={{ color: 'var(--text-2)' }}>{h2hDisplay(fixture)}</span>{' · '}
          Ref: <span style={{ color: 'var(--text-2)' }}>{refereeDisplay(fixture)}</span>{' · '}
          Rest: <span style={{ color: 'var(--text-2)' }}>{restDaysDisplay(fixture)}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 14, marginBottom: 14 }}>
        <PredictionRow
          label={aiPending ? 'OVER —' : `OVER ${overLine}`}
          conf={ouConf}
          pending={aiPending}
        />
        <PredictionRow
          label={aiPending ? 'BTTS —' : bttsLabel(fixture)}
          conf={btsConf}
          delay={200}
          pending={aiPending}
        />
      </div>

      {aiErrored && (
        <div
          className="mono"
          style={{
            marginTop: -4,
            marginBottom: 12,
            padding: '8px 10px',
            borderRadius: 6,
            background: 'var(--bg-2)',
            border: '1px solid var(--border-soft)',
            fontSize: 11,
            color: 'var(--text-3)',
            letterSpacing: '0.04em',
          }}
        >
          Data temporarily unavailable — try refresh
        </div>
      )}

      <div
        style={{
          borderTop: '1px solid var(--border-soft)',
          paddingTop: 12,
          marginTop: 4,
        }}
      >
        <button
          type="button"
          onClick={handleAnalysisToggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'none',
            border: 'none',
            padding: 0,
            color: 'var(--text-2)',
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          <span
            style={{
              transform: showAnalysis ? 'rotate(180deg)' : 'rotate(0)',
              transition: 'transform 0.2s',
              display: 'inline-flex',
            }}
          >
            <Icon name="chevron-down" size={14} />
          </span>
          {showAnalysis ? 'Hide' : 'Show'} Analysis
          {!isSharp && (
            <Icon name="lock" size={11} color="var(--text-faint)" />
          )}
        </button>
        {isSharp && (
          <div
            style={{
              maxHeight: showAnalysis ? 400 : 0,
              overflow: 'hidden',
              transition: 'max-height 0.35s ease, opacity 0.25s',
              opacity: showAnalysis ? 1 : 0,
            }}
          >
            <div
              style={{
                marginTop: 12,
                padding: 12,
                background: 'var(--bg-2)',
                borderRadius: 8,
                border: '1px solid var(--border-soft)',
              }}
            >
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <Icon name="brain" size={14} color="var(--indigo)" />
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: 'var(--indigo)',
                    letterSpacing: '0.08em',
                  }}
                >
                  THE AI THINKS:
                </span>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: 'var(--text-2)',
                  whiteSpace: 'pre-line',
                }}
              >
                {analysisText(fixture)}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
