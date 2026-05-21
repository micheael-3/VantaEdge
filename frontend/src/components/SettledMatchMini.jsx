import Icon from './Icon.jsx';
import { overPlainEnglish } from '../lib/fixture.js';

// Compact settled-match card used by the dashboard empty state
// ("No matches today — here's how the AI did yesterday").
// Shares the visual language of the full MatchCard but strips out the
// form dots, stats row, and analysis toggle. Each row gets one pick
// (the higher-confidence side), the final score, and a HIT/MISS badge.
export default function SettledMatchMini({ row }) {
  if (!row) return null;
  const overConf = row.overConfidence;
  const bttsConf = row.bttsConfidence;
  let pickLabel = '—';
  let pickHit = null;
  if (overConf != null && (bttsConf == null || overConf >= bttsConf)) {
    pickLabel = overPlainEnglish(row.overLine ?? 2.5);
    pickHit = row.overHit;
  } else if (bttsConf != null) {
    pickLabel = String(row.btts).toUpperCase() === 'NO'
      ? 'One team fails to score'
      : 'Both teams score';
    pickHit = row.bttsHit;
  }

  return (
    <div
      className="card"
      style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="display"
          style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2, marginBottom: 4 }}
        >
          {row.match}
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.04em' }}>
          AI: {pickLabel}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {(row.finalScore || (row.homeGoals != null && row.awayGoals != null)) && (
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--text-2)',
              padding: '4px 8px',
              background: 'var(--bg-2)',
              borderRadius: 4,
            }}
          >
            {row.finalScore || `FT ${row.homeGoals}-${row.awayGoals}`}
          </span>
        )}
        {pickHit === true && <Icon name="check" size={14} color="var(--mint)" />}
        {pickHit === false && <Icon name="x" size={14} color="var(--red)" />}
      </div>
    </div>
  );
}
