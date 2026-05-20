import { useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { calculateEV } from '../lib/ev';

// Full-page EV calculator. Uses the same math as frontend/src/lib/ev.js
// so the numbers match what the dashboard match cards compute.
export default function EVCalculator() {
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
      <Navbar />
      <div className="container" style={{ paddingTop: 20, maxWidth: 640 }}>
        <Link to="/dashboard" className="muted small" style={{ display: 'inline-block', marginBottom: 12 }}>
          ← Back to dashboard
        </Link>
        <h2>EV Calculator</h2>
        <p className="muted">
          Type your model's confidence and the bookmaker's odds. We compute the edge
          and expected value on a $100 stake.
        </p>

        <div className="card" style={{ marginTop: 18 }}>
          <div className="stack">
            <div>
              <label className="label">Your confidence (%)</label>
              <input
                className="input"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={confidence}
                onChange={(e) => setConfidence(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Bookmaker odds (decimal)</label>
              <input
                className="input"
                type="number"
                min="1.01"
                step="0.01"
                value={odds}
                onChange={(e) => setOdds(e.target.value)}
              />
            </div>
          </div>

          {valid ? (
            <div className="stack" style={{ marginTop: 18 }}>
              <ResultRow label="Implied probability" value={`${impliedProb}%`} />
              <ResultRow
                label="Edge"
                value={`${ev.edge >= 0 ? '+' : ''}${ev.edge}%`}
                positive={ev.edge > 0}
                negative={ev.edge < 0}
              />
              <ResultRow
                label="EV on $100 stake"
                value={`${parseFloat(evPer100) >= 0 ? '+' : ''}$${evPer100}`}
                positive={parseFloat(evPer100) > 0}
                negative={parseFloat(evPer100) < 0}
              />
              <div className="muted small" style={{ marginTop: 6 }}>{verdictText(ev.valueBadge)}</div>
            </div>
          ) : (
            <div className="muted small" style={{ marginTop: 18 }}>
              Enter a confidence (0–100) and decimal odds &gt; 1.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ResultRow({ label, value, positive, negative }) {
  const color = positive ? 'var(--mint, #6ee7b7)' : negative ? '#f87171' : 'inherit';
  return (
    <div className="spread">
      <span className="muted small">{label}</span>
      <span className="mono" style={{ color, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function verdictText(badge) {
  switch (badge) {
    case 'STRONG_VALUE': return 'Strong value (+15% edge or more).';
    case 'VALUE': return 'Value bet (+8% edge or more).';
    case 'MARGINAL': return 'Marginal value (+1–8% edge).';
    default: return "No value — the price doesn't justify the confidence.";
  }
}
