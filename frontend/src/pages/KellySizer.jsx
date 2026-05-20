import { useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { calculateEV, calculateKelly } from '../lib/ev';

// Full-page Kelly stake sizer. Same math as the dashboard match cards.
export default function KellySizer() {
  const [confidence, setConfidence] = useState('65');
  const [odds, setOdds] = useState('1.85');
  const [bankroll, setBankroll] = useState('1000');
  const [fraction, setFraction] = useState('0.5'); // half-Kelly default

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
      <Navbar />
      <div className="container" style={{ paddingTop: 20, maxWidth: 640 }}>
        <Link to="/dashboard" className="muted small" style={{ display: 'inline-block', marginBottom: 12 }}>
          ← Back to dashboard
        </Link>
        <h2>Kelly Sizer</h2>
        <p className="muted">
          Compute the optimal stake from your bankroll. Half-Kelly (0.5) is the
          common safe default — it sacrifices ~25% of growth for materially less
          variance.
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
            <div>
              <label className="label">Bankroll ($)</label>
              <input
                className="input"
                type="number"
                min="0"
                step="1"
                value={bankroll}
                onChange={(e) => setBankroll(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Kelly fraction</label>
              <select
                className="input"
                value={fraction}
                onChange={(e) => setFraction(e.target.value)}
              >
                <option value="1">Full Kelly (1.0) — aggressive</option>
                <option value="0.5">Half Kelly (0.5) — recommended</option>
                <option value="0.25">Quarter Kelly (0.25) — conservative</option>
              </select>
            </div>
          </div>

          {valid ? (
            <div className="stack" style={{ marginTop: 18 }}>
              <ResultRow
                label="Edge"
                value={`${ev.edge >= 0 ? '+' : ''}${ev.edge}%`}
                positive={ev.edge > 0}
                negative={ev.edge < 0}
              />
              <ResultRow label="Full Kelly %" value={`${(fullKelly * 100).toFixed(2)}%`} />
              <ResultRow
                label={`${f === 1 ? 'Full' : f === 0.5 ? 'Half' : 'Quarter'} Kelly stake`}
                value={`$${stake}`}
                positive={parseFloat(stake) > 0}
              />
              {parseFloat(stake) <= 0 && (
                <div className="muted small" style={{ color: '#f87171' }}>
                  No positive edge — Kelly says don't bet.
                </div>
              )}
            </div>
          ) : (
            <div className="muted small" style={{ marginTop: 18 }}>
              Fill every field with valid numbers.
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
