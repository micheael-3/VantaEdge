import { useEffect, useRef, useState } from 'react';
import ConfBar from './ConfBar.jsx';
import Icon from './Icon.jsx';
import { confidenceLabel } from '../lib/fixture.js';

// localStorage key — once we've shown the "?" explainer one time, hide
// the icon for that user forever. The text never changes, so educating
// someone twice is just noise.
const SEEN_KEY = 'fastscore_seen_explainers';

function hasSeenExplainers() {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

function markSeen() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* quota */
  }
}

// One prediction row — plain-English headline, confidence + label chip,
// confidence bar. Optional ✓/✗ hit/miss badge on settled cards.
//
// Props:
//   plainLabel  — large headline e.g. "More than 2 goals"
//   conf        — 0-100 calibrated confidence
//   explainer   — body text for the "?" tooltip
//   hit         — true/false/null/undefined. true = ✓ mint, false = ✗ red,
//                 nullish = no badge. The ✓ replays a bounce animation
//                 once per fixture id (parent re-mounts via `key`).
//   pending     — shimmering skeleton while Claude analysis loads.
export default function PredictionRow({
  plainLabel,
  conf,
  delay = 0,
  pending = false,
  explainer = '',
  hit = null,
}) {
  const [showHelp, setShowHelp] = useState(false);
  const [helpHidden, setHelpHidden] = useState(true); // start hidden to avoid SSR flicker
  const popoverRef = useRef(null);

  // Read localStorage once on mount.
  useEffect(() => {
    setHelpHidden(hasSeenExplainers());
  }, []);

  // Click-outside to close popover.
  useEffect(() => {
    if (!showHelp) return undefined;
    function onDocClick(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setShowHelp(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showHelp]);

  if (pending) {
    return (
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 6,
          }}
        >
          <span
            className="shimmer"
            style={{ height: 22, width: 180, borderRadius: 4 }}
          />
          <span
            className="mono"
            style={{ fontSize: 11, color: 'var(--text-3)' }}
          >
            Confidence
          </span>
        </div>
        <div
          className="shimmer"
          style={{ height: 8, borderRadius: 4, marginBottom: 4 }}
        />
      </div>
    );
  }

  const pct = conf || 0;
  const label = confidenceLabel(pct);

  // Color treatment for the label chip.
  let chipBg = 'transparent';
  let chipColor = 'var(--text-2)';
  if (pct >= 70) {
    chipBg = 'rgba(110,231,183,0.15)';
    chipColor = 'var(--mint)';
  } else if (pct >= 60) {
    chipBg = 'rgba(251,191,36,0.15)';
    chipColor = 'var(--amber)';
  }

  const onHelpClick = () => {
    setShowHelp((v) => !v);
    if (!helpHidden) {
      // First-time view ends here — mark seen so the icon never renders again.
      markSeen();
      setHelpHidden(true);
    }
  };

  const a11y = `The AI predicts ${plainLabel} with ${pct}% confidence based on form, head-to-head, and the referee's history.`;

  return (
    <div title={a11y} aria-label={a11y}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
          {/* Top line: plain-English headline + optional "?" icon */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
            <span
              className="display"
              style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', lineHeight: 1.2 }}
            >
              AI says: {plainLabel}
            </span>
            {!helpHidden && explainer && (
              <button
                ref={popoverRef}
                type="button"
                onClick={onHelpClick}
                aria-label="What does this mean?"
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 8,
                  margin: -8,
                  minWidth: 32,
                  minHeight: 32,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-3)',
                  cursor: 'pointer',
                  position: 'relative',
                }}
              >
                <Icon name="help" size={16} />
                {showHelp && (
                  <span
                    role="tooltip"
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      left: 0,
                      zIndex: 20,
                      width: 240,
                      padding: '10px 12px',
                      background: 'var(--card-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      color: 'var(--text)',
                      fontSize: 12,
                      lineHeight: 1.5,
                      textAlign: 'left',
                      fontWeight: 400,
                      boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
                    }}
                  >
                    {explainer}
                  </span>
                )}
              </button>
            )}
            {hit === true && (
              <span
                className={`result-hit`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  marginLeft: 4,
                  color: 'var(--mint)',
                  fontSize: 12,
                }}
              >
                <Icon name="check" size={14} color="var(--mint)" />
              </span>
            )}
            {hit === false && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  marginLeft: 4,
                  color: 'var(--red)',
                  fontSize: 12,
                }}
              >
                <Icon name="x" size={14} color="var(--red)" />
              </span>
            )}
          </div>
          {/* Middle line: % + label chip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>
              {pct}%
            </span>
            {label && (
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  padding: '3px 8px',
                  borderRadius: 4,
                  background: chipBg,
                  color: chipColor,
                }}
              >
                {label}
              </span>
            )}
          </div>
        </div>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
          Confidence
        </span>
      </div>
      <ConfBar pct={pct} color="mint" delay={delay} />
    </div>
  );
}
