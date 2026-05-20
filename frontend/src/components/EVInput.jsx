import { useState } from 'react';
import { calculateEV, calculateKelly } from '../lib/ev.js';
import { useAuth, isSharp } from '../context/AuthContext.jsx';
import UpgradePrompt from './UpgradePrompt.jsx';

// One thin odds input. As the user types, we run EV + Kelly client-side.
// For FREE tier we still accept input but suppress the result and surface an
// upgrade nudge instead.
export default function EVInput({ overConfidence, bttsConfidence }) {
  const { user } = useAuth();
  const sharp = isSharp(user);
  const [odds, setOdds] = useState('');

  const o = parseFloat(odds);
  const valid = o && o > 1;

  // Use the higher-confidence market as the EV reference. (Per the prompt the
  // input is a single field; using the stronger pick is the most user-friendly.)
  const referenceConfidence =
    (overConfidence || 0) >= (bttsConfidence || 0) ? overConfidence : bttsConfidence;

  const { edge } = valid ? calculateEV(referenceConfidence, o) : { edge: 0 };
  const kelly = valid ? calculateKelly(referenceConfidence, o) : 0;

  return (
    <div className="ev-row">
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        min="1.01"
        placeholder="Enter odds for EV"
        value={odds}
        onChange={(e) => setOdds(e.target.value)}
        aria-label="Bookmaker odds"
      />
      {valid && !sharp && <UpgradePrompt />}
      {valid && sharp && (
        <div className="ev-result">
          <div className="ev-line">
            <span className="ev-label">Edge</span>
            <span className={`ev-value ${edge >= 0 ? 'pos' : 'neg'}`}>
              {edge >= 0 ? '+' : ''}
              {edge.toFixed(1)}%
            </span>
          </div>
          <div className="ev-line">
            <span className="ev-label">Kelly</span>
            <span className="ev-value">{(kelly * 100).toFixed(1)}% of bankroll</span>
          </div>
        </div>
      )}
    </div>
  );
}
