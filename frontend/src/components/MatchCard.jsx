import { useState } from 'react';
import FormDots from './FormDots.jsx';
import Icon from './Icon.jsx';
import PredictionRow from './PredictionRow.jsx';
import ShareButtons from './ShareButtons.jsx';
import {
  analysisText,
  avgConceded,
  avgScored,
  bttsPlainEnglish,
  effectiveBttsConf,
  effectiveOverConf,
  formatKickoffShort,
  h2hDisplay,
  overPlainEnglish,
  refereeGoalsPerGame,
  refereeName,
  restDaysDisplay,
} from '../lib/fixture.js';

// Centrepiece card. Pared back for the casual bettor: header line,
// teams row with form dots, plain-English stats row, two prediction
// rows showing the calibrated confidence, expandable analysis, and a
// pair of share buttons. When BOTH calibrated confidences are <60 we
// render a muted card with a single "AI not confident" neutral chip
// instead of the prediction block.
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
  const bttsPred = fixture?.predictions?.btts?.prediction || 'YES';

  const result = fixture.actualResult;
  const isPast = !!result;

  // Hide weak predictions: when BOTH calibrated confidences are below 60
  // we don't show the prediction block at all — we admit "the AI's not
  // confident" rather than pollute the page with a low-confidence guess.
  // Stats row + form dots still render (still informational).
  const weakSignal = !aiPending && ouConf < 60 && btsConf < 60;

  const handleAnalysisToggle = () => {
    if (!isSharp) {
      if (onUpgrade) onUpgrade();
      return;
    }
    setShowAnalysis((v) => !v);
  };

  const overExplainer = `This means the AI thinks both teams combined will score ${Math.floor(overLine) + 1} or more goals in this match.`;
  const bttsExplainer = String(bttsPred).toUpperCase() === 'NO'
    ? 'This means the AI thinks one of the two teams will fail to score.'
    : 'This means the AI thinks both teams will score at least one goal each.';

  return (
    <div
      className="card"
      style={{
        padding: 20,
        position: 'relative',
        borderColor: 'var(--border)',
        overflow: 'hidden',
        opacity: weakSignal ? 0.6 : 1,
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

      {/* 2x2 stats grid — one block per stat with icon, label, value, and a
          plain-English explanation. Even on mobile we keep 2 columns so the
          card stays compact; explanations are always visible (no tap-to-reveal
          needed). Replaces the old dense one-line stats row. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 14,
        }}
      >
        <StatBlock
          icon="⚽"
          label="Goals per game"
          value={`${avgScored(fixture)} scored · ${avgConceded(fixture)} conceded`}
          explanation="How many goals each team scores and lets in on average"
        />
        <StatBlock
          icon="⚔️"
          label="Last meetings"
          value={h2hDisplay(fixture)}
          explanation="Average goals when these two teams play each other"
        />
        <StatBlock
          icon="🟨"
          label="Referee"
          value={refereeName(fixture)}
          explanation={
            // Three states:
            // 1. No name yet → ref hasn't been announced (normal >48h out)
            // 2. Name + per-ref goals → full data, surface the tendency
            // 3. Name but no goals/game → ref is new or limited history
            refereeName(fixture) === 'Not announced'
              ? 'Referees are usually announced 24–48 hours before kickoff'
              : refereeGoalsPerGame(fixture) != null
                ? `This referee averages ${refereeGoalsPerGame(fixture).toFixed(1)} goals per game officiated`
                : 'Limited history — no per-referee tendency yet'
          }
        />
        <StatBlock
          icon="😴"
          label="Days since last game"
          value={restDaysDisplay(fixture)}
          explanation="Teams with more rest tend to perform better"
        />
      </div>

      {weakSignal ? (
        <div
          className="mono"
          style={{
            padding: '12px 14px',
            borderRadius: 8,
            background: 'var(--bg-2)',
            border: '1px solid var(--border-soft)',
            fontSize: 12,
            color: 'var(--text-2)',
            textAlign: 'center',
            letterSpacing: '0.02em',
            marginBottom: 14,
          }}
        >
          AI not confident — skip this match
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14, marginBottom: 14 }}>
          {/* Key tied to fixture id so the ✓ animation replays exactly when
              the user navigates between fixtures, not on every re-render. */}
          <PredictionRow
            key={`over-${fixture.id || fixture.fixtureId}`}
            plainLabel={aiPending ? 'Loading…' : overPlainEnglish(overLine)}
            conf={ouConf}
            pending={aiPending}
            explainer={overExplainer}
            hit={isPast ? !!result.overHit : null}
          />
          <PredictionRow
            key={`btts-${fixture.id || fixture.fixtureId}`}
            plainLabel={aiPending ? 'Loading…' : bttsPlainEnglish(bttsPred)}
            conf={btsConf}
            delay={200}
            pending={aiPending}
            explainer={bttsExplainer}
            hit={isPast ? !!result.bttsHit : null}
          />
        </div>
      )}

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

      {/* Analysis toggle hidden on weak-signal cards — there's nothing
          meaningful to expand to when the AI declined to call it. */}
      {!weakSignal && (
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
      )}

      {/* Share row — both before kickoff (promo) and after (celebrate/honest). */}
      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px solid var(--border-soft)',
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        <ShareButtons fixture={fixture} />
      </div>
    </div>
  );
}

// Single stat block used inside the 2x2 grid above. Icon sits top-left next
// to a muted label; the value renders bold below, and a tiny muted line of
// plain-English context anchors the bottom so casual bettors actually
// understand what they're looking at.
function StatBlock({ icon, label, value, explanation }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--border-soft)',
        background: 'var(--bg-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minHeight: 78,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ fontSize: 13, lineHeight: 1 }} aria-hidden="true">
          {icon}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: 'var(--text-3)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </span>
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text)',
          lineHeight: 1.3,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-3)',
          lineHeight: 1.4,
          marginTop: 'auto',
        }}
      >
        {explanation}
      </div>
    </div>
  );
}
