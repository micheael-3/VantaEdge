import { useState } from 'react';
import FormDots from './FormDots.jsx';
import Icon from './Icon.jsx';
import PredictionRow from './PredictionRow.jsx';
import LockedOverlay from './LockedOverlay.jsx';
import {
  analysisText,
  avgConceded,
  avgScored,
  bttsCalibrated,
  bttsConf,
  bttsLabel,
  effectiveBttsConf,
  effectiveOverConf,
  formatKickoffShort,
  h2hDisplay,
  isStrongValue,
  overCalibrated,
  overConf,
  restDaysDisplay,
} from '../lib/fixture.js';

// Centrepiece card. Visually matches the design's match-card.jsx —
// header line, teams row with form dots, stats row, prediction rows
// with odds-input + EV, and an expandable AI analysis section.
export default function MatchCard({ fixture, isSharp, onUpgrade }) {
  const [oddsOU, setOddsOU] = useState('');
  const [oddsBTTS, setOddsBTTS] = useState('');
  const [showAnalysis, setShowAnalysis] = useState(false);

  if (!fixture) return null;

  // Per-fixture error path: backend pipeline failed for just this match.
  // We deliberately never surface the raw API-Football error to the user —
  // the backend already converts known failures (rate limit, etc.) to the
  // friendly "Data temporarily unavailable" string.
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
  const strongValue = !aiPending && isStrongValue(fixture);
  // Raw confidence drives the badge text. EV math (inside PredictionRow)
  // uses the EFFECTIVE (calibrated) number so a model that historically
  // over-confidence-d shows realistic edges instead of inflated ones.
  const ouConfRaw = overConf(fixture);
  const btsConfRaw = bttsConf(fixture);
  const ouConfEff = effectiveOverConf(fixture);
  const btsConfEff = effectiveBttsConf(fixture);
  const ouCalibrated = overCalibrated(fixture);
  const btsCalibratedV = bttsCalibrated(fixture);
  const overLine = fixture?.predictions?.over?.line ?? 2.5;

  const result = fixture.actualResult;
  const isPast = !!result;

  return (
    <div
      className="card"
      style={{
        padding: 20,
        position: 'relative',
        borderColor: strongValue
          ? 'rgba(110,231,183,0.35)'
          : 'var(--border)',
        boxShadow: strongValue ? '0 0 30px rgba(110,231,183,0.08)' : 'none',
        overflow: 'hidden',
      }}
    >
      {strongValue && (
        <div
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            padding: '4px 9px',
            borderRadius: 4,
            background: 'rgba(110,231,183,0.12)',
            border: '1px solid rgba(110,231,183,0.3)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 500,
            color: 'var(--mint)',
            letterSpacing: '0.08em',
          }}
        >
          ★ STRONG VALUE
        </div>
      )}

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
          display: 'flex',
          gap: 14,
          fontSize: 11,
          color: 'var(--text-2)',
          padding: '10px 0',
          borderTop: '1px solid var(--border-soft)',
          borderBottom: '1px solid var(--border-soft)',
          marginBottom: 14,
          flexWrap: 'wrap',
        }}
      >
        <span>
          AVG GOALS <span style={{ color: 'var(--text)' }}>{avgScored(fixture)}</span> /{' '}
          <span style={{ color: 'var(--text)' }}>{avgConceded(fixture)}</span>
        </span>
        <span style={{ color: 'var(--text-faint)' }}>·</span>
        <span>
          REST <span style={{ color: 'var(--text)' }}>{restDaysDisplay(fixture)}</span>
        </span>
        <span style={{ color: 'var(--text-faint)' }}>·</span>
        <span>
          H2H <span style={{ color: 'var(--text)' }}>{h2hDisplay(fixture)}</span>
        </span>
      </div>

      <div style={{ display: 'grid', gap: 14, marginBottom: 14 }}>
        <PredictionRow
          label={aiPending ? 'OVER —' : `OVER ${overLine}`}
          conf={ouConfEff}
          rawConf={ouConfRaw}
          calibratedConf={ouCalibrated}
          isSharp={isSharp}
          odds={oddsOU}
          onOdds={setOddsOU}
          onUpgrade={onUpgrade}
          pending={aiPending}
        />
        <PredictionRow
          label={aiPending ? 'BTTS —' : bttsLabel(fixture)}
          conf={btsConfEff}
          rawConf={btsConfRaw}
          calibratedConf={btsCalibratedV}
          isSharp={isSharp}
          odds={oddsBTTS}
          onOdds={setOddsBTTS}
          onUpgrade={onUpgrade}
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
          onClick={() => setShowAnalysis((v) => !v)}
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
          {showAnalysis ? 'Hide' : 'Show'} AI Analysis
        </button>
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
              position: 'relative',
              marginTop: 12,
              padding: 12,
              background: 'var(--bg-2)',
              borderRadius: 8,
              border: '1px solid var(--border-soft)',
            }}
          >
            <div
              style={{
                filter: isSharp ? 'none' : 'blur(5px)',
                userSelect: isSharp ? 'auto' : 'none',
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
                  AI ANALYSIS
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
            {!isSharp && (
              <LockedOverlay onClick={onUpgrade} label="SHARP only" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
