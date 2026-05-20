import { useEffect, useState } from 'react';
import { calculateEV, calculateKelly } from '../lib/ev';

// One modal, two calculators. `tool` is either 'ev' or 'kelly'. Both
// share the same input UI (confidence + odds), and Kelly adds a bankroll
// field. Outputs are derived from frontend/src/lib/ev.js so the math
// matches what the dashboard match cards compute under the hood.
export default function ToolsModal({ tool, onClose }) {
  // Lock body scroll while modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ESC to close.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!tool) return null;
  return (
    <div className="tools-modal-backdrop" onClick={onClose}>
      <div className="tools-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tools-modal-close" onClick={onClose} aria-label="Close">×</button>
        {tool === 'ev' && <EVCalculator />}
        {tool === 'kelly' && <KellySizer />}
      </div>
    </div>
  );
}

function EVCalculator() {
  const [confidence, setConfidence] = useState('65');
  const [odds, setOdds] = useState('1.85');

  const c = parseFloat(confidence);
  const o = parseFloat(odds);
  const valid = Number.isFinite(c) && c > 0 && c <= 100 && Number.isFinite(o) && o > 1;

  const ev = valid ? calculateEV(c, o) : null;
  const impliedProb = valid ? (100 / o).toFixed(1) : null;
  const evPer100 = valid ? ((c / 100) * (o - 1) * 100 - (1 - c / 100) * 100).toFixed(2) : null;

  return (
    <>
      <h2 className="tools-modal-title">EV Calculator</h2>
      <p className="tools-modal-sub">
        Type your model's confidence and the bookmaker's odds. We compute the edge
        and expected value on a $100 stake.
      </p>

      <div className="tools-form">
        <label className="tools-field">
          <span className="tools-label">Your confidence (%)</span>
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={confidence}
            onChange={(e) => setConfidence(e.target.value)}
            className="tools-input"
          />
        </label>
        <label className="tools-field">
          <span className="tools-label">Bookmaker odds (decimal)</span>
          <input
            type="number"
            min="1.01"
            step="0.01"
            value={odds}
            onChange={(e) => setOdds(e.target.value)}
            className="tools-input"
          />
        </label>
      </div>

      {valid ? (
        <div className="tools-results">
          <ResultRow label="Implied probability" value={`${impliedProb}%`} />
          <ResultRow
            label="Edge"
            value={`${ev.edge >= 0 ? '+' : ''}${ev.edge}%`}
            positive={ev.edge > 0}
            negative={ev.edge < 0}
          />
          <ResultRow
            label="EV on $100 stake"
            value={`${evPer100 >= 0 ? '+' : ''}$${evPer100}`}
            positive={parseFloat(evPer100) > 0}
            negative={parseFloat(evPer100) < 0}
          />
          <div className={`tools-verdict ${verdictClass(ev.valueBadge)}`}>
            {verdictText(ev.valueBadge)}
          </div>
        </div>
      ) : (
        <div className="tools-empty">Enter a confidence (0–100) and decimal odds &gt; 1.</div>
      )}
    </>
  );
}

function KellySizer() {
  const [confidence, setConfidence] = useState('65');
  const [odds, setOdds] = useState('1.85');
  const [bankroll, setBankroll] = useState('1000');
  const [fraction, setFraction] = useState('0.5'); // half-kelly default

  const c = parseFloat(confidence);
  const o = parseFloat(odds);
  const b = parseFloat(bankroll);
  const f = parseFloat(fraction);
  const valid =
    Number.isFinite(c) && c > 0 && c <= 100 &&
    Number.isFinite(o) && o > 1 &&
    Number.isFinite(b) && b > 0 &&
    Number.isFinite(f) && f > 0 && f <= 1;

  const fullKelly = valid ? calculateKelly(c, o) : 0;
  const adjustedKelly = fullKelly * f;
  const stake = valid ? (adjustedKelly * b).toFixed(2) : null;
  const ev = valid ? calculateEV(c, o) : null;

  return (
    <>
      <h2 className="tools-modal-title">Kelly Sizer</h2>
      <p className="tools-modal-sub">
        Compute the optimal stake from your bankroll. Half-Kelly (0.5) is the
        common safe default — it sacrifices ~25% of growth for materially less
        variance.
      </p>

      <div className="tools-form">
        <label className="tools-field">
          <span className="tools-label">Your confidence (%)</span>
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={confidence}
            onChange={(e) => setConfidence(e.target.value)}
            className="tools-input"
          />
        </label>
        <label className="tools-field">
          <span className="tools-label">Bookmaker odds (decimal)</span>
          <input
            type="number"
            min="1.01"
            step="0.01"
            value={odds}
            onChange={(e) => setOdds(e.target.value)}
            className="tools-input"
          />
        </label>
        <label className="tools-field">
          <span className="tools-label">Bankroll ($)</span>
          <input
            type="number"
            min="0"
            step="1"
            value={bankroll}
            onChange={(e) => setBankroll(e.target.value)}
            className="tools-input"
          />
        </label>
        <label className="tools-field">
          <span className="tools-label">Kelly fraction</span>
          <select
            value={fraction}
            onChange={(e) => setFraction(e.target.value)}
            className="tools-input"
          >
            <option value="1">Full Kelly (1.0) — aggressive</option>
            <option value="0.5">Half Kelly (0.5) — recommended</option>
            <option value="0.25">Quarter Kelly (0.25) — conservative</option>
          </select>
        </label>
      </div>

      {valid ? (
        <div className="tools-results">
          <ResultRow
            label="Edge"
            value={`${ev.edge >= 0 ? '+' : ''}${ev.edge}%`}
            positive={ev.edge > 0}
            negative={ev.edge < 0}
          />
          <ResultRow
            label="Full Kelly %"
            value={`${(fullKelly * 100).toFixed(2)}%`}
          />
          <ResultRow
            label={`${f === 1 ? 'Full' : f === 0.5 ? 'Half' : 'Quarter'} Kelly stake`}
            value={`$${stake}`}
            positive={parseFloat(stake) > 0}
          />
          {parseFloat(stake) <= 0 && (
            <div className="tools-verdict negative">
              No positive edge — Kelly says don't bet.
            </div>
          )}
        </div>
      ) : (
        <div className="tools-empty">Fill every field with valid numbers.</div>
      )}
    </>
  );
}

function ResultRow({ label, value, positive, negative }) {
  return (
    <div className="tools-result-row">
      <span className="tools-result-lbl">{label}</span>
      <span className={`tools-result-val ${positive ? 'positive' : ''} ${negative ? 'negative' : ''}`}>
        {value}
      </span>
    </div>
  );
}

function verdictText(badge) {
  switch (badge) {
    case 'STRONG_VALUE': return 'Strong value (+15% edge or more).';
    case 'VALUE': return 'Value bet (+8% edge or more).';
    case 'MARGINAL': return 'Marginal value (+1–8% edge).';
    default: return 'No value — the price doesn\'t justify the confidence.';
  }
}

function verdictClass(badge) {
  if (badge === 'STRONG_VALUE' || badge === 'VALUE') return 'positive';
  if (badge === 'NO_VALUE') return 'negative';
  return 'neutral';
}
