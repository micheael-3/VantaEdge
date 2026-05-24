import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import FormDots from './FormDots.jsx';
import Icon from './Icon.jsx';
import PredictionRow from './PredictionRow.jsx';
import ShareButtons from './ShareButtons.jsx';
import { feedback as feedbackApi } from '../api/client.js';
import { fairOddsFromConfidence } from '../lib/stakeCalculator.js';
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
// localStorage key for "we already collected feedback on this fixture".
// Lets the user rate once per pick without us re-rendering the row after
// a refresh.
const FEEDBACK_LS_KEY = 'fastscore_rated_predictions';

function readRatedSet() {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(FEEDBACK_LS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function markRated(predictionId) {
  if (typeof window === 'undefined' || !predictionId) return;
  try {
    const set = readRatedSet();
    set.add(predictionId);
    window.localStorage.setItem(FEEDBACK_LS_KEY, JSON.stringify([...set]));
  } catch {
    /* quota — silent */
  }
}

export default function MatchCard({ fixture, isSharp, onUpgrade }) {
  const [showAnalysis, setShowAnalysis] = useState(false);
  // Three tabs in the analysis card when debateJson exists. Default to
  // verdict (the conservative summary) — analysis = analyst's free-text
  // report, risks = devil's advocate critique.
  const [analysisTab, setAnalysisTab] = useState('verdict');
  // Feedback row state. `submitted` flips when we either receive a
  // successful POST or detect the id in localStorage on mount.
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState(false);

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

  // Debug log: surfaces the actual form arrays we received from the
  // backend, only when one of them is shorter than 5 — keeps the
  // console quiet in normal operation. The user reported the away
  // team showing 3 dots; this lets us inspect whether the issue is
  // upstream (backend) or downstream (FormDots rendering).
  if (
    typeof console !== 'undefined' &&
    ((Array.isArray(home.form) && home.form.length < 5) ||
      (Array.isArray(away.form) && away.form.length < 5))
  ) {
    console.log(
      `[MatchCard form] ${home.name} home.form=${JSON.stringify(home.form)} ` +
        `${away.name} away.form=${JSON.stringify(away.form)}`,
    );
  }
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
  const predictionId = fixture.id || fixture.fixtureId;

  // On mount, check whether we've already collected feedback on this
  // prediction id. If so, we render the "thanks" line instead of the
  // star row.
  useEffect(() => {
    if (!predictionId) return;
    const set = readRatedSet();
    if (set.has(String(predictionId))) setFeedbackSubmitted(true);
  }, [predictionId]);

  const submitFeedback = async (rating) => {
    if (!predictionId || feedbackBusy || feedbackSubmitted) return;
    setFeedbackBusy(true);
    setFeedbackRating(rating);
    try {
      await feedbackApi.rate(String(predictionId), rating);
      markRated(String(predictionId));
      setFeedbackSubmitted(true);
    } catch {
      // Surface as a transient busy=false so the user can retry.
      setFeedbackRating(0);
    } finally {
      setFeedbackBusy(false);
    }
  };

  // Hide weak cards entirely: when BOTH calibrated confidences are below
  // 55, the AI doesn't have a real edge — surfacing the row at all just
  // pollutes the dashboard. We return null here so the parent grid
  // collapses cleanly. (Settled cards bypass this so accuracy history
  // remains complete.)
  const weakSignal = !aiPending && !isPast && ouConf < 55 && btsConf < 55;
  if (weakSignal) return null;

  // Mint tint on high-confidence cards (≥75% on either market). Spec is
  // "barely visible but premium feel" — the .card-strong class adds a
  // subtle 4%-alpha mint gradient at the top of the card background.
  const strongCard = !isPast && (ouConf >= 75 || btsConf >= 75);

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
      className={`card mc-card${strongCard ? ' card-strong' : ''}`}
      data-fixture-id={fixture.id || fixture.fixtureId}
      style={{
        // padding is set via .mc-card CSS so the mobile media query can
        // tighten it. Inline padding here would override the rule.
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
          alignItems: 'flex-start',
          marginBottom: 14,
        }}
      >
        <div>
          <div
            className="display"
            style={{
              fontSize: 17,
              fontWeight: 600,
              lineHeight: 1.25,
              wordBreak: 'break-word',
              // 2-line clamp via standard `line-clamp` (Safari/Chrome modern).
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {home.name || 'Home'}
          </div>
          <div style={{ marginTop: 8 }}>
            <FormDots form={home.form} delay={100} />
          </div>
        </div>
        <div
          className="mono"
          style={{ fontSize: 11, color: 'var(--text-3)', padding: '4px 4px 0' }}
        >
          VS
        </div>
        <div style={{ textAlign: 'right' }}>
          <div
            className="display"
            style={{
              fontSize: 17,
              fontWeight: 600,
              lineHeight: 1.25,
              wordBreak: 'break-word',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
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

      {/* Result chip only renders when the match actually has a final
          score (both goals known + status FT). Previously the chip
          rendered "FT –" on upcoming/null cases because result was
          truthy from the hit flags alone. */}
      {isPast && result && result.homeGoals != null && result.awayGoals != null && (
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

      {/* 2x2 stats grid — tight per spec: 64px max block height, 10px
          padding, label+icon on one line, value, then a single-line
          plain-English explanation. Mobile keeps 2 columns so the card
          stays compact. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <StatBlock
          icon="⚽"
          label="Goals avg"
          value={`${avgScored(fixture)} scored · ${avgConceded(fixture)} conceded`}
          explanation="Per game this season"
        />
        <StatBlock
          icon="⚔"
          label="Last meetings"
          value={h2hDisplay(fixture)}
          explanation="Historical average"
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
              ? 'Announced 24–48h pre-kickoff'
              : refereeGoalsPerGame(fixture) != null
                ? `${refereeGoalsPerGame(fixture).toFixed(1)} avg goals/game`
                : 'No data'
          }
        />
        <StatBlock
          icon="😴"
          label="Rest"
          value={restDaysDisplay(fixture)}
          explanation="Since last match"
        />
      </div>

      <div style={{ display: 'grid', gap: 12, marginBottom: 12 }}>
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
          // BTTS NO is a valid strong pick — render the row in red
          // (chip + conf bar) so the directional signal is obvious.
          tone={String(bttsPred).toUpperCase() === 'NO' ? 'red' : 'mint'}
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
                maxHeight: showAnalysis ? 600 : 0,
                overflow: 'hidden',
                transition: 'max-height 0.35s ease, opacity 0.25s',
                opacity: showAnalysis ? 1 : 0,
              }}
            >
              <DebateView fixture={fixture} tab={analysisTab} onTab={setAnalysisTab} />
            </div>
          )}
        </div>

        {/* 5-star feedback row — settled predictions only (so the user
            actually knows whether the AI was right) and PRO users only
            (FREE doesn't see the analysis section anyway). Once rated,
            we replace the stars with a "Thanks for the feedback" line. */}
        {isPast && isSharp && predictionId && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid var(--border-soft)',
            }}
          >
            {feedbackSubmitted ? (
              <div
                className="mono"
                style={{ fontSize: 11, color: 'var(--mint)', letterSpacing: '0.04em' }}
              >
                Thanks for the feedback
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: 'var(--text-3)',
                    letterSpacing: '0.08em',
                  }}
                >
                  RATE THIS PICK
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[1, 2, 3, 4, 5].map((n) => {
                    const active = n <= feedbackRating;
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => submitFeedback(n)}
                        disabled={feedbackBusy}
                        aria-label={`Rate ${n} star${n === 1 ? '' : 's'}`}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 2,
                          cursor: feedbackBusy ? 'default' : 'pointer',
                          color: active ? 'var(--amber)' : 'var(--text-faint)',
                          fontSize: 18,
                          lineHeight: 1,
                        }}
                      >
                        ★
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

      {/* Share row + Calculate Stake link.
          The "Calculate Stake →" link deep-links to /calculator with the
          AI confidence converted to fair odds (1 / probability). We
          don't surface bookmaker odds on cards yet, so fair odds are the
          best honest seed — the user adjusts to their real bookmaker
          number once they land on the calculator. Only shown on upcoming
          matches; on settled cards the bet is in the past so there's
          nothing left to size. */}
      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px solid var(--border-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        {!isPast ? (
          <Link
            to={(() => {
              const seed = fairOddsFromConfidence(ouConf);
              return seed ? `/calculator?odds=${seed}` : '/calculator';
            })()}
            className="mono"
            style={{
              fontSize: 12,
              color: 'var(--mint)',
              letterSpacing: '0.04em',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
            aria-label="Open the stake calculator with these odds pre-filled"
          >
            Calculate Stake →
          </Link>
        ) : (
          <span />
        )}
        <ShareButtons fixture={fixture} />
      </div>
    </div>
  );
}

// Single stat block used inside the 2x2 grid above. Icon sits top-left next
// to a muted label; the value renders bold below, and a tiny muted line of
// plain-English context anchors the bottom so casual bettors actually
// understand what they're looking at.
// Three-tab analysis view: Verdict / Analysis / Risks. When the row was
// produced by the 3-agent ensemble (debateJson present), we render real
// transcripts. On legacy rows we render only the Verdict tab from
// analysisText() so the toggle still does something sensible.
function DebateView({ fixture, tab, onTab }) {
  const debate = fixture && fixture.debateJson;
  const hasDebate = !!(debate && (debate.analyst || debate.devilsAdvocate));
  const verdict = analysisText(fixture);
  let body = '';
  if (tab === 'analysis') body = (debate && debate.analyst) || verdict;
  else if (tab === 'risks') body = (debate && debate.devilsAdvocate) || 'No risk analysis on this pick.';
  else body = verdict;

  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        background: 'var(--bg-2)',
        borderRadius: 8,
        border: '1px solid var(--border-soft)',
      }}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <Icon name="brain" size={14} color="var(--indigo)" />
        <span
          className="mono"
          style={{ fontSize: 10, color: 'var(--indigo)', letterSpacing: '0.08em' }}
        >
          THE AI THINKS
        </span>
      </div>
      {/* Tab switcher — only render when we have a real debate to switch
          between. Legacy rows just show the verdict block. */}
      {hasDebate && (
        <div
          style={{
            display: 'flex',
            gap: 4,
            marginBottom: 10,
            padding: 2,
            background: 'var(--card-2)',
            border: '1px solid var(--border-soft)',
            borderRadius: 6,
          }}
        >
          {[
            { key: 'verdict', label: 'Verdict' },
            { key: 'analysis', label: 'Analysis' },
            { key: 'risks', label: 'Risks' },
          ].map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => onTab(t.key)}
                style={{
                  flex: 1,
                  background: active ? 'var(--card)' : 'transparent',
                  border: 'none',
                  color: active ? 'var(--text)' : 'var(--text-3)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  letterSpacing: '0.04em',
                  padding: '6px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}
      <p
        style={{
          margin: 0,
          fontSize: 13,
          lineHeight: 1.55,
          color: 'var(--text-2)',
          whiteSpace: 'pre-line',
        }}
      >
        {body}
      </p>
      {/* Risk score chip — only on the Risks tab when present. Visual
          signal that this pick has higher-than-usual uncertainty. */}
      {hasDebate && tab === 'risks' && typeof debate.riskScore === 'number' && (
        <div
          className="mono"
          style={{
            marginTop: 10,
            fontSize: 11,
            color: debate.riskScore > 7 ? 'var(--red)' : 'var(--text-3)',
            letterSpacing: '0.04em',
          }}
        >
          RISK SCORE: {debate.riskScore}/10
          {debate.riskScore > 7 ? ' · CONFIDENCE AUTO-REDUCED' : ''}
        </div>
      )}
    </div>
  );
}

function StatBlock({ icon, label, value, explanation }) {
  return (
    <div
      style={{
        padding: 8,
        borderRadius: 8,
        border: '1px solid var(--border-soft)',
        background: 'var(--bg-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        // No max-height clamp — the value line can wrap to 2 lines when
        // the string is long (e.g. "1.8 scored · 2.6 conceded" overflows
        // a 44%-wide grid cell on iPhone-mini). We trade a few px of
        // height for never truncating.
        overflow: 'visible',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ fontSize: 11, lineHeight: 1 }} aria-hidden="true">
          {icon}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 9,
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
          lineHeight: 1.2,
          // Allow wrap (no nowrap, no ellipsis). Long values like
          // "1.8 scored · 2.6 conceded" use 2 lines on narrow screens.
          wordBreak: 'break-word',
        }}
        title={String(value)}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-3)',
          lineHeight: 1.25,
          // 1 line max with truncation — explanatory text is fine to
          // cap because the title attr exposes the full string.
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={String(explanation)}
      >
        {explanation}
      </div>
    </div>
  );
}
