import { useEffect, useMemo, useState } from 'react';
import { user as userApi } from '../api/client';
import { LEAGUES } from '../config/leagues';
import './OnboardingOverlay.css';

// League stats matching the spec.
const LEAGUE_STATS = {
  253: '3.1 goals/game avg',
  78: '2.9 goals/game avg',
  88: '3.2 goals/game avg',
  40: '2.7 goals/game avg',
  61: '2.6 goals/game avg',
  179: '2.8 goals/game avg',
  140: '2.5 goals/game avg',
  39: '2.7 goals/game avg',
};

const ALL_LEAGUE_IDS = LEAGUES.map((l) => l.id);

function previewLabel(conf) {
  if (conf >= 80) return 'approximately 2-4 picks per matchday';
  if (conf >= 75) return 'approximately 4-7 picks per matchday';
  if (conf >= 60) return 'approximately 8-12 picks per matchday';
  return 'approximately 15-20 picks per matchday';
}

export default function OnboardingOverlay({ onComplete }) {
  const [step, setStep] = useState(1);
  const [exiting, setExiting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [selectedLeagues, setSelectedLeagues] = useState(ALL_LEAGUE_IDS);
  const [minConfidence, setMinConfidence] = useState(65);
  const [market, setMarket] = useState('all');
  const [validation, setValidation] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Lock body scroll while the overlay is mounted.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Helper: transition between steps with a brief exit animation.
  const goToStep = (n) => {
    setValidation('');
    setExiting(true);
    setTimeout(() => {
      setStep(n);
      setExiting(false);
    }, 200);
  };

  const handleNext = () => {
    if (step === 2 && selectedLeagues.length === 0) {
      setValidation('Pick at least one league to follow.');
      return;
    }
    goToStep(step + 1);
  };
  const handleBack = () => {
    if (step <= 1) return;
    goToStep(step - 1);
  };

  const finish = async ({ defaults = false } = {}) => {
    if (submitting) return;
    setSubmitting(true);
    const payload = defaults
      ? { preferredLeagues: ALL_LEAGUE_IDS, minConfidence: 65, defaultMarket: 'all' }
      : { preferredLeagues: selectedLeagues, minConfidence, defaultMarket: market };
    try {
      const { user: updated } = await userApi.completeOnboarding(payload);
      setClosing(true);
      setTimeout(() => onComplete(updated), 400);
    } catch (err) {
      setValidation(
        (err.response && err.response.data && err.response.data.error) || 'Could not save preferences. Try again.',
      );
      setSubmitting(false);
    }
  };

  const toggleLeague = (id) => {
    setSelectedLeagues((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  // Fill the slider's left side using a CSS variable.
  const sliderPct = useMemo(() => {
    return ((minConfidence - 50) / (85 - 50)) * 100;
  }, [minConfidence]);

  return (
    <div
      className={`ob-overlay ${closing ? 'closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to FastScore"
    >
      <div className="ob-top">
        <button
          type="button"
          className="ob-back"
          onClick={handleBack}
          disabled={step === 1}
          aria-label="Back"
        >
          ← Back
        </button>
        <button type="button" className="ob-skip" onClick={() => finish({ defaults: true })}>
          Skip
        </button>
      </div>

      <div className="ob-progress" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={`ob-dot ${n === step ? 'active' : ''}`} />
        ))}
      </div>

      <div className={`ob-step ${exiting ? 'exiting' : ''}`} key={step}>
        {step === 1 && (
          <>
            <div className="ob-logo">
              FastScore
            </div>
            <h2 className="ob-headline">Welcome to FastScore</h2>
            <p className="ob-sub">
              You now have access to the same statistical tools professional bettors use.
              Here's how to get the most out of them in 60 seconds.
            </p>
            <div className="ob-pills">
              <span className="ob-pill">⚡ AI Analysis</span>
              <span className="ob-pill">📊 +EV Calculator</span>
              <span className="ob-pill">🎯 8 Leagues</span>
            </div>
            <button type="button" className="ob-cta" onClick={() => goToStep(2)}>
              Let's Go →
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Which leagues do you want to follow?</h2>
            <p className="ob-sub-static">
              We'll load these by default. You can change this anytime in Settings.
            </p>
            <div className="ob-leagues">
              {LEAGUES.map((l) => {
                const sel = selectedLeagues.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    className={`ob-league ${sel ? 'selected' : ''}`}
                    onClick={() => toggleLeague(l.id)}
                    aria-pressed={sel}
                  >
                    <span className="flag">{l.flag}</span>
                    <span className="name">{l.name}</span>
                    <span className="stat">{LEAGUE_STATS[l.id]}</span>
                    <span className="check">✓</span>
                  </button>
                );
              })}
            </div>
            {validation && <div className="ob-validation">{validation}</div>}
            <button type="button" className="ob-cta" onClick={handleNext}>
              Continue →
            </button>
          </>
        )}

        {step === 3 && (
          <>
            <h2>How selective do you want to be?</h2>
            <p className="ob-sub-static">
              This sets the minimum AI confidence for picks shown on your dashboard.
              Higher = fewer but stronger picks.
            </p>
            <div className="ob-slider-wrap">
              <input
                type="range"
                min="50"
                max="85"
                step="1"
                value={minConfidence}
                onChange={(e) => setMinConfidence(parseInt(e.target.value, 10))}
                className="ob-slider"
                aria-label="Minimum confidence"
                style={{ '--ob-fill': `${sliderPct}%` }}
              />
              <div className="ob-slider-value">{minConfidence}%</div>
            </div>
            <div className="ob-presets">
              <button
                type="button"
                className={`ob-preset ${minConfidence === 50 ? 'active' : ''}`}
                onClick={() => setMinConfidence(50)}
              >
                <div className="label">Show Everything</div>
                <div className="hint">More picks, lower average accuracy</div>
              </button>
              <button
                type="button"
                className={`ob-preset ${minConfidence === 65 ? 'active' : ''}`}
                onClick={() => setMinConfidence(65)}
              >
                <div className="label">Balanced · Recommended</div>
                <div className="hint">Quality and quantity</div>
              </button>
              <button
                type="button"
                className={`ob-preset ${minConfidence === 80 ? 'active' : ''}`}
                onClick={() => setMinConfidence(80)}
              >
                <div className="label">High Confidence</div>
                <div className="hint">Fewer picks, higher accuracy</div>
              </button>
            </div>
            <div className="ob-preview">
              At <strong>{minConfidence}%</strong> confidence — you'll see {previewLabel(minConfidence)}
            </div>
            <div className="ob-markets">
              {[
                ['all', 'All Markets'],
                ['over', 'Over / Under'],
                ['btts', 'BTTS Only'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`ob-market ${market === id ? 'active' : ''}`}
                  onClick={() => setMarket(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {validation && <div className="ob-validation">{validation}</div>}
            <button
              type="button"
              className="ob-cta block"
              onClick={() => finish()}
              disabled={submitting}
            >
              {submitting ? 'Saving…' : 'Start Analysing →'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
