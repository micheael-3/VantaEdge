import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { predictions as predictionsApi } from '../api/client';
import { bestBet as bestBetApi } from '../api/blog';
import { LEAGUES } from '../config/leagues';
import { calculateEV, calculateKelly } from '../lib/ev';
import './Dashboard.css';

const FILTER_KEY = 'vantaedge_dash_filters_v1';
const DEFAULT_FILTERS = {
  minConfidence: 60,
  market: 'all', // 'all' | 'over' | 'btts'
  valueOnly: false,
  sort: 'edge', // 'edge' | 'confidence' | 'kickoff'
};

function loadFilters() {
  try {
    const raw = window.localStorage.getItem(FILTER_KEY);
    if (!raw) return DEFAULT_FILTERS;
    return { ...DEFAULT_FILTERS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function saveFilters(f) {
  try {
    window.localStorage.setItem(FILTER_KEY, JSON.stringify(f));
  } catch {
    // ignore
  }
}

// ============ Helpers ============
function kickoffStr(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function confidenceBand(c) {
  if (c >= 70) return 'high';
  if (c >= 55) return 'med';
  return 'low';
}

function bestEv(m) {
  const overEdge = m.ev && m.ev.over ? m.ev.over.edge : null;
  const bttsEdge = m.ev && m.ev.btts ? m.ev.btts.edge : null;
  if (overEdge == null && bttsEdge == null) return null;
  if (overEdge == null) return bttsEdge;
  if (bttsEdge == null) return overEdge;
  return Math.max(overEdge, bttsEdge);
}

function isStrongValue(m) {
  // Treat as Strong Value when confidence is high — EV may not be present
  // until the user enters odds, so confidence alone drives the glow treatment.
  const overConf = m.predictions && m.predictions.over ? m.predictions.over.confidence : 0;
  const bttsConf = m.predictions && m.predictions.btts ? m.predictions.btts.confidence : 0;
  return Math.max(overConf, bttsConf) >= 70;
}

// ============ Sidebar ============
function Sidebar({ user, onLogout }) {
  return (
    <aside className="dp-sidebar">
      <Link to="/" className="dp-brand">
        Vanta<span className="accent-dot">·</span>Edge
      </Link>

      <div className="dp-side-section">
        <div className="dp-side-label">Workspace</div>
        <NavLink to="/dashboard" className={({ isActive }) => `dp-side-link ${isActive ? 'active' : ''}`} end>
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="3" y="3" width="7" height="9" rx="1" />
            <rect x="14" y="3" width="7" height="5" rx="1" />
            <rect x="14" y="12" width="7" height="9" rx="1" />
            <rect x="3" y="16" width="7" height="5" rx="1" />
          </svg>
          Today's Edge
        </NavLink>
        <NavLink to="/history" className={({ isActive }) => `dp-side-link ${isActive ? 'active' : ''}`}>
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M3 17l5-5 4 4 8-8" />
            <path d="M14 8h6v6" />
          </svg>
          ROI / History
        </NavLink>
        <NavLink to="/affiliate/dashboard" className={({ isActive }) => `dp-side-link ${isActive ? 'active' : ''}`}>
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" />
          </svg>
          Affiliates
        </NavLink>
      </div>

      <div className="dp-side-section">
        <div className="dp-side-label">Tools</div>
        <div className="dp-side-link disabled" title="Coming soon">
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <path d="M9 9h6M9 13h6M9 17h3" />
          </svg>
          EV Calculator
        </div>
        <div className="dp-side-link disabled" title="Coming soon">
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M12 2v20M2 12h20" />
          </svg>
          Kelly Sizer
        </div>
        <div className="dp-side-link disabled" title="Coming soon">
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="12" r="9" />
            <path d="M9 12h6" />
          </svg>
          Bet Tracker
        </div>
      </div>

      <div className="dp-side-section">
        <div className="dp-side-label">Account</div>
        <NavLink to="/settings" className={({ isActive }) => `dp-side-link ${isActive ? 'active' : ''}`}>
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21v-1a6 6 0 0112 0v1" />
          </svg>
          Profile · {user.email}
        </NavLink>
        <button className="dp-side-link" onClick={onLogout}>
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
            <path d="M9 21H4V3h5" />
          </svg>
          Logout
        </button>
      </div>

      <div style={{ marginTop: 'auto', paddingTop: 28 }}>
        <div className="dp-upgrade">
          <div className="dp-upgrade-eyebrow">AFFILIATE PROGRAM</div>
          <div className="dp-upgrade-title">Earn 40% recurring</div>
          <div className="dp-upgrade-sub">Refer bettors. Get paid every month they stay subscribed.</div>
          <Link className="dp-btn dp-btn-primary dp-btn-sm" style={{ marginTop: 14, width: '100%' }} to="/affiliate/dashboard">
            Open dashboard
          </Link>
        </div>
      </div>
    </aside>
  );
}

// ============ Mobile top bar (sidebar is hidden on small screens) ============
function MobileTop({ user, onLogout }) {
  return (
    <div className="dp-mobile-top">
      <Link to="/" className="dp-brand">
        Vanta<span className="accent-dot">·</span>Edge
      </Link>
      <nav className="dp-mobile-nav">
        <NavLink to="/dashboard" className={({ isActive }) => (isActive ? 'active' : '')} end>
          Dashboard
        </NavLink>
        <NavLink to="/history" className={({ isActive }) => (isActive ? 'active' : '')}>
          History
        </NavLink>
        <NavLink to="/affiliate/dashboard" className={({ isActive }) => (isActive ? 'active' : '')}>
          Affiliates
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
          Settings
        </NavLink>
        <button onClick={onLogout} className="dp-btn dp-btn-ghost dp-btn-sm" style={{ height: 30 }}>
          Logout
        </button>
      </nav>
    </div>
  );
}

// ============ Conf bar ============
function ConfBar({ value }) {
  const band = confidenceBand(value);
  return (
    <div className="dp-conf-block">
      <div className="dp-conf-head">
        <span className="dp-conf-label">AI Confidence</span>
        <span className={`dp-conf-val ${band}`}>{Math.round(value)}%</span>
      </div>
      <div className="dp-conf-bar">
        <div className={`dp-conf-bar-fill ${band}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

// ============ Form dots ============
function FormDots({ form }) {
  const items = Array.isArray(form) ? form.slice(-5) : [];
  if (items.length === 0) return <span className="dp-mono" style={{ fontSize: 10, color: 'var(--dp-text-faint)' }}>—</span>;
  return (
    <span className="dp-form-dots">
      {items.map((r, i) => (
        <span key={i} className={`dp-dot-form ${r === 'W' ? 'W' : r === 'L' ? 'L' : 'D'}`} title={r} />
      ))}
    </span>
  );
}

// ============ Compare Odds (per-bookmaker table) ============
function CompareOdds({ oddsData, overLineFromAi }) {
  const totals = (oddsData && oddsData.allBookmakers && oddsData.allBookmakers.totals) || [];
  const btts = (oddsData && oddsData.allBookmakers && oddsData.allBookmakers.btts) || [];

  // Build one row per bookmaker, merging totals + btts entries.
  const byBookie = new Map();
  for (const t of totals) {
    if (!byBookie.has(t.bookmaker)) byBookie.set(t.bookmaker, { bookmaker: t.bookmaker });
    const row = byBookie.get(t.bookmaker);
    // Prefer the row matching the AI's predicted line; fall back to closest.
    const dist = Math.abs(t.line - overLineFromAi);
    if (row.totalsDist == null || dist < row.totalsDist) {
      row.totalsDist = dist;
      row.totalsLine = t.line;
      row.over = t.overOdds;
      row.under = t.underOdds;
    }
  }
  for (const b of btts) {
    if (!byBookie.has(b.bookmaker)) byBookie.set(b.bookmaker, { bookmaker: b.bookmaker });
    const row = byBookie.get(b.bookmaker);
    row.bttsYes = b.yesOdds;
    row.bttsNo = b.noOdds;
  }

  const rows = Array.from(byBookie.values());
  if (rows.length === 0) {
    return (
      <div className="dp-mono" style={{ fontSize: 11, color: 'var(--dp-text-faint)', padding: 8 }}>
        No per-bookmaker breakdown available.
      </div>
    );
  }

  // Identify best (max) odds per column.
  const max = (key) => Math.max(...rows.map((r) => r[key] || 0));
  const bestOver = max('over');
  const bestUnder = max('under');
  const bestYes = max('bttsYes');
  const bestNo = max('bttsNo');

  // Use the most common totals line across rows for the column header.
  const lineCounts = new Map();
  for (const r of rows) if (r.totalsLine != null) lineCounts.set(r.totalsLine, (lineCounts.get(r.totalsLine) || 0) + 1);
  let headerLine = overLineFromAi;
  if (lineCounts.size) {
    headerLine = Array.from(lineCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];
  }

  const fmt = (n) => (n == null || !Number.isFinite(n) ? '—' : Number(n).toFixed(2));

  return (
    <table className="dp-compare-table">
      <thead>
        <tr>
          <th>Bookmaker</th>
          <th>Over {headerLine}</th>
          <th>Under {headerLine}</th>
          <th>BTTS Yes</th>
          <th>BTTS No</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.bookmaker}>
            <td style={{ color: 'var(--dp-text-dim)' }}>{r.bookmaker}</td>
            <td className={r.over === bestOver && bestOver > 0 ? 'best' : ''}>{fmt(r.over)}</td>
            <td className={r.under === bestUnder && bestUnder > 0 ? 'best' : ''}>{fmt(r.under)}</td>
            <td className={r.bttsYes === bestYes && bestYes > 0 ? 'best' : ''}>{fmt(r.bttsYes)}</td>
            <td className={r.bttsNo === bestNo && bestNo > 0 ? 'best' : ''}>{fmt(r.bttsNo)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ============ Match card ============
function MatchCard({ m, userTier }) {
  const [overOdds, setOverOdds] = useState('');
  const [bttsOdds, setBttsOdds] = useState('');
  const [compareOpen, setCompareOpen] = useState(false);

  const over = m.predictions && m.predictions.over;
  const btts = m.predictions && m.predictions.btts;
  const headline = over || { confidence: 50, line: 2.5 };
  const headlineConfidence = over && btts && btts.confidence > over.confidence ? btts.confidence : headline.confidence;
  const isStrong = isStrongValue(m);

  // Live EV — primary market is OVER unless user has entered BTTS odds only.
  const overEV = useMemo(() => (overOdds && over ? calculateEV(over.confidence, overOdds) : null), [overOdds, over]);
  const bttsEV = useMemo(() => (bttsOdds && btts ? calculateEV(btts.confidence, bttsOdds) : null), [bttsOdds, btts]);
  const overKelly = useMemo(() => (overOdds && over ? calculateKelly(over.confidence, overOdds) : 0), [overOdds, over]);

  const primaryEV = overEV || bttsEV;
  const hasOdds = !!primaryEV;
  const positive = !!primaryEV && primaryEV.edge >= 1;

  if (m.error) {
    return (
      <div className="dp-match">
        <div className="dp-match-main">
          <div className="dp-match-league">
            <span>{m.league}</span>
            <span className="sep">·</span>
            <span>{kickoffStr(m.kickoff)}</span>
          </div>
          <div className="dp-match-teams">
            <span className="dp-team">{m.home && m.home.name}</span>
            <span className="vs">vs</span>
            <span className="dp-team">{m.away && m.away.name}</span>
          </div>
          <div className="dp-mono" style={{ marginTop: 14, fontSize: 12, color: 'var(--dp-text-faint)' }}>{m.error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`dp-match ${isStrong ? 'glow' : ''}`}>
      <div className="dp-match-main">
        <div className="dp-match-league">
          <span>{m.league}</span>
          <span className="sep">·</span>
          <span>{kickoffStr(m.kickoff)}</span>
        </div>
        <div className="dp-match-teams">
          <span className="dp-team">
            <span className="dp-crest">{(m.home.name || '').slice(0, 2).toUpperCase()}</span>
            {m.home.name}
          </span>
          <span className="vs">vs</span>
          <span className="dp-team">
            <span className="dp-crest">{(m.away.name || '').slice(0, 2).toUpperCase()}</span>
            {m.away.name}
          </span>
        </div>
        <div className="dp-metrics">
          <div className="dp-metric">
            <span className="lbl">Home form</span>
            <FormDots form={m.home && m.home.form} />
          </div>
          <div className="dp-metric">
            <span className="lbl">Away form</span>
            <FormDots form={m.away && m.away.form} />
          </div>
          <div className="dp-metric">
            <span className="lbl">Rest days</span>
            <span className="val">
              {m.home && m.home.restDays != null ? `${m.home.restDays}d` : '—'} /{' '}
              {m.away && m.away.restDays != null ? `${m.away.restDays}d` : '—'}
            </span>
          </div>
        </div>
      </div>

      <div className="dp-conf-wrap">
        <ConfBar value={headlineConfidence} />
        <div className="dp-bet-badges">
          {over && (
            <span className={`dp-bet-badge on mint`}>OVER {over.line}</span>
          )}
          {btts && (
            <span className={`dp-bet-badge on`}>BTTS {btts.prediction}</span>
          )}
        </div>
      </div>

      <div className="dp-right">
        {m.oddsData ? (
          <>
            <div className="dp-liveodds">
              <div className="dp-liveodds-head">
                <span>📊 Live Odds</span>
                <span>{m.oddsData.bookmakerCount || 0} bookies</span>
              </div>
              {m.oddsData.bestOverOdds != null && (
                <div className="dp-liveodds-row">
                  <span className="label">Over {m.oddsData.overLine}</span>
                  <span>
                    <span className="odds">{m.oddsData.bestOverOdds.toFixed(2)}</span>{' '}
                    <span className="bookie">@ {m.oddsData.bestOverBookmaker}</span>
                  </span>
                </div>
              )}
              {m.oddsData.bestBttsOdds != null && (
                <div className="dp-liveodds-row">
                  <span className="label">BTTS {m.oddsData.bttsSide || 'YES'}</span>
                  <span>
                    <span className="odds">{m.oddsData.bestBttsOdds.toFixed(2)}</span>{' '}
                    <span className="bookie">@ {m.oddsData.bestBttsBookmaker}</span>
                  </span>
                </div>
              )}
            </div>

            {(() => {
              const auto = m.oddsData.autoEV || {};
              const bestEdge = Math.max(
                auto.overEdge != null ? auto.overEdge : -Infinity,
                auto.bttsEdge != null ? auto.bttsEdge : -Infinity,
              );
              const has = Number.isFinite(bestEdge);
              const pos = has && bestEdge >= 1;
              return (
                <div className={`dp-ev-pill ${!has ? 'empty' : pos ? 'positive' : ''}`}>
                  <span className="l">Your Edge</span>
                  <span className="v">
                    {has ? `${bestEdge >= 0 ? '+' : ''}${bestEdge.toFixed(1)}%` : '—'}
                  </span>
                </div>
              );
            })()}

            {(() => {
              const k = m.oddsData.autoEV && (m.oddsData.autoEV.kellyOver || m.oddsData.autoEV.kellyBtts);
              if (!k || k <= 0) return null;
              return (
                <div className="dp-odds-row">
                  <span className="l">Kelly stake</span>
                  <span className="v">{(k * 100).toFixed(1)}% bankroll</span>
                </div>
              );
            })()}

            <div className="dp-liveodds-foot">odds via the-odds-api · refreshed every 5 min</div>
          </>
        ) : (
          <>
            <div className="dp-liveodds-foot" style={{ marginBottom: 2 }}>
              Auto odds unavailable — enter manually
            </div>
            <div>
              <label className="dp-odds-row" style={{ marginBottom: 4 }}>
                <span className="l">Over odds</span>
                <span />
              </label>
              <input
                className="dp-odds-input"
                type="number"
                step="0.01"
                min="1"
                placeholder="1.85"
                value={overOdds}
                onChange={(e) => setOverOdds(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="dp-odds-row" style={{ marginBottom: 4 }}>
                <span className="l">BTTS odds</span>
                <span />
              </label>
              <input
                className="dp-odds-input"
                type="number"
                step="0.01"
                min="1"
                placeholder="1.90"
                value={bttsOdds}
                onChange={(e) => setBttsOdds(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <div className={`dp-ev-pill ${!hasOdds ? 'empty' : positive ? 'positive' : ''}`}>
              <span className="l">Your Edge</span>
              <span className="v">
                {!hasOdds
                  ? 'enter odds'
                  : `${primaryEV.edge >= 0 ? '+' : ''}${primaryEV.edge.toFixed(1)}%`}
              </span>
            </div>
            {overKelly > 0 && (
              <div className="dp-odds-row">
                <span className="l">Kelly stake</span>
                <span className="v">{(overKelly * 100).toFixed(1)}% bankroll</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Compare Odds — ANALYST/EDGE only, when auto-odds present */}
      {m.oddsData && (userTier === 'ANALYST' || userTier === 'EDGE') && (
        <div className="dp-compare">
          <button
            className="dp-compare-toggle"
            onClick={() => setCompareOpen((v) => !v)}
            style={{ width: '100%' }}
          >
            {compareOpen ? '▲ Hide bookmaker comparison' : `▼ Compare ${m.oddsData.bookmakerCount || ''} bookmakers`}
          </button>
          {compareOpen && (
            <div style={{ marginTop: 12 }}>
              <CompareOdds
                oddsData={m.oddsData}
                overLineFromAi={(m.predictions && m.predictions.over && m.predictions.over.line) || 2.5}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============ Empty state ============
function Empty({ leagueName, onAll }) {
  return (
    <div className="dp-empty">
      <div className="icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-5-5" />
        </svg>
      </div>
      <h3>No matches today in {leagueName}</h3>
      <p>This league has no fixtures in our window. Check back tomorrow or switch league above.</p>
      <div className="dp-empty-actions">
        <button className="dp-btn dp-btn-sm" onClick={onAll}>
          Show first available league
        </button>
      </div>
    </div>
  );
}

// ============ Best Bet card ============
function BestBetCard({ user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await bestBetApi.today();
        if (!cancelled) setData(res);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return null;
  if (!data || !data.bestBet) {
    return (
      <div className="dp-bestbet-empty">
        <strong style={{ color: 'var(--dp-text)', fontFamily: 'Syne, sans-serif', fontSize: 15 }}>
          No qualifying Best Bet yet today.
        </strong>{' '}
        Picks need ≥70% confidence (and ≥8% EV when odds are present). The bar fills as
        predictions are generated through the day.
      </div>
    );
  }

  const bb = data.bestBet;
  const isFree = bb.teaser || user.tier === 'FREE';
  const bet = `${bb.betType} ${bb.line != null ? bb.line : ''}`.trim();
  const kickoffStr2 = bb.kickoff ? kickoffStr(bb.kickoff) : '';

  return (
    <div className="dp-bestbet">
      <span className="dp-bestbet-tag">⭐ Best Bet Today</span>
      <div className="dp-bestbet-row">
        <div className="dp-bestbet-main">
          <div className="dp-bestbet-league">
            {bb.league}
            {kickoffStr2 ? <> · {kickoffStr2}</> : null}
          </div>
          <div className="dp-bestbet-match">
            {bb.homeTeam} vs {bb.awayTeam}
          </div>
          <div className="dp-bestbet-bet">{bet}</div>
        </div>
        {isFree ? (
          <div>
            <div className="dp-bestbet-blur">
              <div className="dp-bestbet-stats">
                <div className="dp-bestbet-stat">
                  <span className="lbl">Confidence</span>
                  <span className="val">88%</span>
                </div>
                <div className="dp-bestbet-stat">
                  <span className="lbl">Edge</span>
                  <span className="val">+22.5%</span>
                </div>
              </div>
            </div>
            <Link to="/register" className="dp-bestbet-blur-overlay">
              🔒 Upgrade to Scout to unlock confidence + edge
            </Link>
          </div>
        ) : (
          <div className="dp-bestbet-stats">
            <div className="dp-bestbet-stat">
              <span className="lbl">Confidence</span>
              <span className="val">{bb.confidence != null ? `${bb.confidence}%` : '—'}</span>
            </div>
            <div className="dp-bestbet-stat">
              <span className="lbl">Edge</span>
              <span className="val">{bb.evEdge != null ? `+${bb.evEdge.toFixed(1)}%` : '—'}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============ Dashboard ============
export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [activeLeague, setActiveLeague] = useState(LEAGUES[0].id);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [filter, setFilter] = useState('all');
  const [showLegend, setShowLegend] = useState(true);
  const [advFilters, setAdvFilters] = useState(loadFilters);

  // Persist filters across sessions.
  useEffect(() => {
    saveFilters(advFilters);
  }, [advFilters]);

  const fetchData = useCallback(async (leagueId, initial = false) => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const data = await predictionsApi.getByLeague(leagueId, initial ? { initial: 1 } : {});
      setMatches(data.fixtures || []);
      if (data.message) setMessage(data.message);
      setHasLoadedOnce(true);
    } catch (err) {
      const status = err.response && err.response.status;
      if (status === 429) setError('Daily refresh limit reached.');
      else if (status === 403) setMatches([]);
      else setError((err.response && err.response.data && err.response.data.error) || 'Failed to load predictions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(activeLeague, !hasLoadedOnce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeague]);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const filtered = useMemo(() => {
    let list = matches.slice();

    // Chip filter (legacy, kept for the 'Strong Value' / market quick buttons)
    if (filter === 'strong') list = list.filter(isStrongValue);
    if (filter === 'value') list = list.filter((m) => {
      const e = bestEv(m);
      return e != null && e >= 5;
    });
    if (filter === 'over') list = list.filter((m) => m.predictions && m.predictions.over);
    if (filter === 'btts') list = list.filter((m) => m.predictions && m.predictions.btts);

    // Advanced filters
    list = list.filter((m) => {
      const overC = m.predictions && m.predictions.over ? m.predictions.over.confidence : 0;
      const bttsC = m.predictions && m.predictions.btts ? m.predictions.btts.confidence : 0;
      const maxC = Math.max(overC, bttsC);
      if (maxC < advFilters.minConfidence) return false;
      if (advFilters.market === 'over' && !(m.predictions && m.predictions.over)) return false;
      if (advFilters.market === 'btts' && !(m.predictions && m.predictions.btts)) return false;
      if (advFilters.valueOnly) {
        const e = bestEv(m);
        if (e == null || e <= 0) return false;
      }
      return true;
    });

    // Sort
    const sortKey = advFilters.sort;
    return list.sort((a, b) => {
      if (sortKey === 'kickoff') {
        return new Date(a.kickoff || 0) - new Date(b.kickoff || 0);
      }
      if (sortKey === 'confidence') {
        const ca = Math.max(
          a.predictions && a.predictions.over ? a.predictions.over.confidence : 0,
          a.predictions && a.predictions.btts ? a.predictions.btts.confidence : 0,
        );
        const cb = Math.max(
          b.predictions && b.predictions.over ? b.predictions.over.confidence : 0,
          b.predictions && b.predictions.btts ? b.predictions.btts.confidence : 0,
        );
        return cb - ca;
      }
      // 'edge' (default)
      const ea = bestEv(a);
      const eb = bestEv(b);
      if (ea == null && eb == null) {
        const ca = a.predictions && a.predictions.over ? a.predictions.over.confidence : 0;
        const cb = b.predictions && b.predictions.over ? b.predictions.over.confidence : 0;
        return cb - ca;
      }
      return (eb ?? -Infinity) - (ea ?? -Infinity);
    });
  }, [matches, filter, advFilters]);

  const strongCount = matches.filter(isStrongValue).length;
  const avgStrongConf = (() => {
    const strong = matches.filter(isStrongValue);
    if (strong.length === 0) return 0;
    const sum = strong.reduce((acc, m) => {
      const c = m.predictions && m.predictions.over ? m.predictions.over.confidence : 0;
      return acc + c;
    }, 0);
    return Math.round(sum / strong.length);
  })();
  const bestEdge = (() => {
    let max = null;
    for (const m of matches) {
      const e = bestEv(m);
      if (e != null && (max == null || e > max)) max = e;
    }
    return max;
  })();

  const activeLeagueObj = LEAGUES.find((l) => l.id === activeLeague) || LEAGUES[0];

  return (
    <div className="dashboard-page">
      <div className="dp-layout">
        <Sidebar user={user} onLogout={handleLogout} />
        <main className="dp-main">
          <MobileTop user={user} onLogout={handleLogout} />

          <header className="dp-header">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div className="dp-eyebrow">
                  <span className="dot" />
                  <span>LIVE · MATCHDAY · {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </div>
                <h1>Today's Edge</h1>
                <div className="dp-sub">AI-scored fixtures across 8 leagues. Strong Value picks first.</div>
              </div>
              <span className="dp-tier-pill dp-mono">{user.tier}</span>
            </div>
            <div className="dp-meta">
              <div className="dp-meta-cell">
                <span className="lbl">Today</span>
                <span className="val">{matches.length}</span>
              </div>
              <div className="dp-meta-cell">
                <span className="lbl">Strong value</span>
                <span className="val mint">{strongCount}</span>
              </div>
              <div className="dp-meta-cell">
                <span className="lbl">Avg conf (strong)</span>
                <span className="val">{avgStrongConf ? `${avgStrongConf}%` : '—'}</span>
              </div>
              <div className="dp-meta-cell">
                <span className="lbl">Best edge</span>
                <span className="val mint">{bestEdge != null ? `+${bestEdge.toFixed(1)}%` : '—'}</span>
              </div>
              <div style={{ marginLeft: 'auto' }}>
                <button
                  className="dp-btn dp-btn-sm"
                  onClick={() => fetchData(activeLeague, false)}
                  disabled={loading}
                >
                  {loading ? 'Loading…' : '↺ Refresh'}
                </button>
              </div>
            </div>
          </header>

          <BestBetCard user={user} />

          <div className="dp-league-tabs-wrap" style={{ marginTop: 24 }}>
            <div className="dp-league-tabs">
              {LEAGUES.map((l) => (
                <button
                  key={l.id}
                  className={`dp-league-tab ${activeLeague === l.id ? 'active' : ''}`}
                  onClick={() => setActiveLeague(l.id)}
                >
                  <span className="flag">{l.flag}</span>
                  <span>{l.name}</span>
                  {activeLeague === l.id && <span className="ct">{matches.length}</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="dp-filter-bar">
            <div className="dp-filter-group">
              <span className="dp-filter-label">Min confidence</span>
              <input
                type="range"
                min="50"
                max="90"
                step="1"
                value={advFilters.minConfidence}
                onChange={(e) => setAdvFilters((f) => ({ ...f, minConfidence: parseInt(e.target.value, 10) }))}
                className="dp-slider"
                aria-label="Minimum confidence"
              />
              <span className="dp-slider-val">{advFilters.minConfidence}%</span>
            </div>
            <div className="dp-filter-group">
              <span className="dp-filter-label">Markets</span>
              <button
                className={`dp-toggle ${advFilters.market === 'all' ? 'on' : ''}`}
                onClick={() => setAdvFilters((f) => ({ ...f, market: 'all' }))}
              >
                All
              </button>
              <button
                className={`dp-toggle ${advFilters.market === 'over' ? 'on' : ''}`}
                onClick={() => setAdvFilters((f) => ({ ...f, market: 'over' }))}
              >
                Over only
              </button>
              <button
                className={`dp-toggle ${advFilters.market === 'btts' ? 'on' : ''}`}
                onClick={() => setAdvFilters((f) => ({ ...f, market: 'btts' }))}
              >
                BTTS only
              </button>
            </div>
            <div className="dp-filter-group">
              <button
                className={`dp-toggle ${advFilters.valueOnly ? 'on' : ''}`}
                onClick={() => setAdvFilters((f) => ({ ...f, valueOnly: !f.valueOnly }))}
                title="Hide cards with no positive EV (needs odds entered to be visible)"
              >
                {advFilters.valueOnly ? '✓ Value only' : 'Value only'}
              </button>
            </div>
            <div className="dp-filter-group" style={{ marginLeft: 'auto' }}>
              <span className="dp-filter-label">Sort</span>
              <select
                className="dp-select"
                value={advFilters.sort}
                onChange={(e) => setAdvFilters((f) => ({ ...f, sort: e.target.value }))}
              >
                <option value="edge">EV edge (high → low)</option>
                <option value="confidence">Confidence (high → low)</option>
                <option value="kickoff">Kickoff time</option>
              </select>
            </div>
          </div>

          <div className="dp-filter-row">
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--dp-text-faint)', textTransform: 'uppercase', letterSpacing: '0.14em', marginRight: 4 }}>
              Filter:
            </span>
            <button className={`dp-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All picks</button>
            <button className={`dp-chip ${filter === 'strong' ? 'mint-active' : ''}`} onClick={() => setFilter('strong')}>Strong Value</button>
            <button className={`dp-chip ${filter === 'value' ? 'active' : ''}`} onClick={() => setFilter('value')}>+EV &gt; 5%</button>
            <button className={`dp-chip ${filter === 'over' ? 'active' : ''}`} onClick={() => setFilter('over')}>Over / Under</button>
            <button className={`dp-chip ${filter === 'btts' ? 'active' : ''}`} onClick={() => setFilter('btts')}>BTTS</button>
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--dp-text-dim)' }}>
              Sorted by edge ↓
            </span>
          </div>

          <div className="dp-matches">
            {showLegend && (
              <div className="dp-legend">
                <div className="dp-legend-head">
                  <span className="dp-mono" style={{ fontSize: 10, color: 'var(--dp-mint)', letterSpacing: '0.16em' }}>
                    HOW TO READ A MATCH
                  </span>
                  <button className="dp-legend-close" onClick={() => setShowLegend(false)} aria-label="Dismiss">
                    ×
                  </button>
                </div>
                <div className="dp-legend-cols">
                  <div>
                    <div className="dp-legend-num">1</div>
                    <div className="dp-legend-title">Match &amp; stats</div>
                    <div className="dp-legend-body">Form dots, rest days — the inputs feeding the model.</div>
                  </div>
                  <div>
                    <div className="dp-legend-num">2</div>
                    <div className="dp-legend-title">AI confidence + market</div>
                    <div className="dp-legend-body">How sure the model is on Over/Under and BTTS for this match.</div>
                  </div>
                  <div>
                    <div className="dp-legend-num">3</div>
                    <div className="dp-legend-title">Your odds &amp; edge</div>
                    <div className="dp-legend-body">
                      Type the bookmaker's odds and we compute your edge live. Green = <strong style={{ color: 'var(--dp-mint)' }}>+EV</strong>.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {loading ? (
              <div className="dp-mono" style={{ color: 'var(--dp-text-dim)', padding: '40px 0', textAlign: 'center' }}>
                Loading fixtures…
              </div>
            ) : error ? (
              <div className="dp-empty">
                <h3>Something went wrong</h3>
                <p>{error}</p>
                <div className="dp-empty-actions">
                  <button className="dp-btn dp-btn-sm" onClick={() => fetchData(activeLeague, false)}>
                    Try again
                  </button>
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <Empty
                leagueName={activeLeagueObj.name}
                onAll={() => setActiveLeague(LEAGUES[0].id)}
              />
            ) : (
              filtered.map((m) => <MatchCard key={m.fixtureId || m.id} m={m} userTier={user.tier} />)
            )}

            {!loading && matches.length === 0 && message && (
              <div className="dp-mono" style={{ color: 'var(--dp-text-faint)', textAlign: 'center', paddingTop: 8 }}>
                {message}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
