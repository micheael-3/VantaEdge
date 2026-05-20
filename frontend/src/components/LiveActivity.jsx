import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import agentApi from '../api/agent';

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const ICONS = {
  SHARP_MOVE: '⚡',
  VALUE_APPEARED: '🟢',
  VALUE_DISAPPEARED: '⚪',
  LINE_CHANGE: '📊',
  RESULT_SETTLED: '✓',
  ACCURACY_UPDATE: '📈',
  BEST_BET_SELECTED: '⭐',
};

export default function LiveActivity() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Try the personalised list first; if that returns nothing (e.g. brand-new
  // user) fall back to the public feed so the panel isn't empty.
  const load = async () => {
    try {
      const myAlerts = await agentApi.alerts();
      if (myAlerts.alerts && myAlerts.alerts.length > 0) {
        setItems(myAlerts.alerts);
        setUnread(myAlerts.unread || 0);
        setError(false);
        return;
      }
      const feed = await agentApi.feed();
      setItems(feed.alerts || []);
      setUnread(0);
      setError(false);
    } catch {
      setError(true);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);

  const body = (
    <>
      <div className="live-activity-head">
        <h3>⚡ Live Activity</h3>
        <div className="row" style={{ gap: 8 }}>
          {unread > 0 && (
            <span className="mono small" style={{ color: 'var(--accent)' }}>
              {unread} new
            </span>
          )}
          <Link to="/alerts" className="mono small" style={{ color: 'var(--text2)' }}>
            all →
          </Link>
        </div>
      </div>
      {error ? (
        <div className="live-activity-empty">Could not load activity.</div>
      ) : items.length === 0 ? (
        <div className="live-activity-empty">No activity yet — the agent is warming up.</div>
      ) : (
        items.slice(0, 10).map((a) => (
          <div key={a.id || a.alertId} className="live-activity-item">
            <span className="live-activity-icon">{ICONS[a.type] || '•'}</span>
            <div className="live-activity-body">
              <div className="live-activity-msg">{a.message}</div>
              <div className="live-activity-meta">
                {a.league ? `${a.league} · ` : ''}{timeAgo(a.createdAt)}
              </div>
            </div>
          </div>
        ))
      )}
    </>
  );

  return (
    <>
      <div className="live-activity nav-mobile-hidden">{body}</div>

      {/* Mobile floating toggle + bottom sheet */}
      <button
        type="button"
        className="live-activity-toggle"
        onClick={() => setSheetOpen(true)}
        aria-label="Live activity"
      >
        ⚡
        {unread > 0 && <span className="live-badge">{unread}</span>}
      </button>
      {sheetOpen && (
        <div className="live-activity-sheet">
          <div className="spread" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontFamily: 'Syne, sans-serif', fontSize: 18 }}>
              ⚡ Live Activity
            </h3>
            <button className="live-activity-sheet-close" onClick={() => setSheetOpen(false)}>✕</button>
          </div>
          {body}
        </div>
      )}
    </>
  );
}
