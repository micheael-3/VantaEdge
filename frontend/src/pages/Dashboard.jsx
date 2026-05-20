import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { predictions as predictionsApi } from '../api/client';
import { bestBet as bestBetApi } from '../api/blog';
import { bankroll as bankrollApi } from '../api/bankroll';
import { LEAGUES } from '../config/leagues';
import { calculateEV, calculateKelly } from '../lib/ev';
import OnboardingOverlay from '../components/OnboardingOverlay';
import './Dashboard.css';
// Tools live at /tools/ev and /tools/kelly. The old ToolsModal is kept on
// disk in case we want to revive the modal UX, but we no longer mount it.

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
        <NavLink to="/tools/ev" className={({ isActive }) => `dp-side-link ${isActive ? 'active' : ''}`} title="EV Calculator">
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <path d="M9 9h6M9 13h6M9 17h3" />
          </svg>
          EV Calculator
        </NavLink>
        <NavLink to="/tools/kelly" className={({ isActive }) => `dp-side-link ${isActive ? 'active' : ''}`} title="Kelly Sizer">
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M12 2v20M2 12h20" />
          </svg>
          Kelly Sizer
        </NavLink>
        <NavLink
          to="/bankroll"
          className={({ isActive }) => `dp-side-link ${isActive ? 'active' : ''}`}
          title="Bet Tracker"
        >
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="12" r="9" />
            <path d="M9 12h6" />
          </svg>
          Bet Tracker
        </NavLink>
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

// ============ Match details (xG / weather / referee / injuries) ============
function fmtGpg(g) {
  if (!g || (g.avgFor == null && g.avgAgainst == null)) return '—';
  const f = g.avgFor != null ? Number(g.avgFor).toFixed(2) : '—';
  const a = g.avgAgainst != null ? Number(g.avgAgainst).toFixed(2) : '—';
  return `${f} / ${a}`;
}

const WEATHER_ICON = {
  Clear: '☀',
  Clouds: '☁',
  Rain: '🌧',
  Drizzle: '🌦',
  Thunderstorm: '⛈',
  Snow: '❄',
  Mist: '🌫',
  Fog: '🌫',
  Haze: '🌫',
};

const WEATHER_WARN_TEXT = {
  HEAVY_RAIN: '⚠ Heavy rain forecast — may suppress scoring',
  STRONG_WIND: '⚠ Strong wind — long-range shooting suffers',
  EXTREME_HEAT: '⚠ Extreme heat — fatigue impact on second half',
  COLD: '❄ Cold — minor factor for travelling sides',
};

function MatchDetails({ m }) {
  const homeInj = (m.home && Array.isArray(m.home.injuries)) ? m.home.injuries : [];
  const awayInj = (m.away && Array.isArray(m.away.injuries)) ? m.away.injuries : [];
  const ref = m.referee;
  const weather = m.weather;
  const showXg = (m.home && m.home.goalsPerGame) || (m.away && m.away.goalsPerGame);
  const showAny = showXg || ref || weather || homeInj.length > 0 || awayInj.length > 0;
  if (!showAny) return null;

  const refAvg = ref && ref.avgGoalsPerGame;
  const refAbove = refAvg != null && refAvg > 2.6;

  return (
    <div className="dp-details">
      <div className="dp-details-grid">
        {showXg && (
          <div className="dp-detail-block">
            <div className="dp-detail-head">Goals per game (For / Against)</div>
            <div className="dp-detail-row">
              <span className="lbl">{m.home && m.home.name}</span>
              <span>{fmtGpg(m.home && m.home.goalsPerGame)}</span>
            </div>
            <div className="dp-detail-row">
              <span className="lbl">{m.away && m.away.name}</span>
              <span>{fmtGpg(m.away && m.away.goalsPerGame)}</span>
            </div>
          </div>
        )}

        {weather && (
          <div className="dp-detail-block">
            <div className="dp-detail-head">Weather at kickoff {weather.city ? `· ${weather.city}` : ''}</div>
            <div className="dp-weather-chip">
              <span style={{ fontSize: 18 }}>{WEATHER_ICON[weather.condition] || '🌡'}</span>
              <span>{weather.condition || '—'}</span>
              {weather.temp != null && <span>· {weather.temp}°C</span>}
              {weather.windSpeed != null && <span>· wind {weather.windSpeed} km/h</span>}
              {weather.precipitation > 0 && <span>· {weather.precipitation}mm precip</span>}
            </div>
            {Array.isArray(weather.warnings) && weather.warnings.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {weather.warnings.map((w) => (
                  <div key={w} className="dp-weather-warn">{WEATHER_WARN_TEXT[w] || w}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {ref && ref.name && (
          <div className="dp-detail-block">
            <div className="dp-detail-head">Referee</div>
            <div className="dp-detail-row">
              <span className="lbl">Name</span>
              <span>{ref.name}</span>
            </div>
            {ref.matchesAnalysed > 0 ? (
              <>
                <div className="dp-detail-row">
                  <span className="lbl">Avg goals/game</span>
                  <span>
                    {ref.avgGoalsPerGame}
                    {refAbove && <span className="dp-ref-arrow" title="Above the ~2.6 league baseline">↑</span>}
                  </span>
                </div>
                <div className="dp-detail-row">
                  <span className="lbl">BTTS rate</span>
                  <span>{ref.bttsRate}%</span>
                </div>
                <div className="dp-detail-row">
                  <span className="lbl">Over 2.5 rate</span>
                  <span>{ref.over25Rate}%</span>
                </div>
                <div className="dp-injury-empty" style={{ marginTop: 4 }}>
                  Sample: last {ref.matchesAnalysed} matches officiated
                </div>
              </>
            ) : (
              <div className="dp-injury-empty">No prior matches officiated in our window.</div>
            )}
          </div>
        )}

        {(homeInj.length > 0 || awayInj.length > 0) && (
          <div className="dp-detail-block">
            <div className="dp-detail-head">Injuries / suspensions</div>
            <div className="dp-detail-row" style={{ marginTop: 2 }}>
              <span className="lbl">{m.home && m.home.name}</span>
              <span>{homeInj.length} out</span>
            </div>
            <div className="dp-injury-list" style={{ marginBottom: homeInj.length ? 8 : 0 }}>
              {homeInj.length === 0 ? (
                <div className="dp-injury-empty">No reported absences</div>
              ) : (
                homeInj.slice(0, 5).map((i, idx) => (
                  <div key={`h-${idx}`} className="dp-injury-row">
                    <span className="name">
                      {i.player || 'Unknown'}
                      {i.key && <span className="key-flag" title="Key player">⚠</span>}
                    </span>
                    <span className="reason">{i.reason || i.type || ''}</span>
                  </div>
                ))
              )}
            </div>
            <div className="dp-detail-row" style={{ marginTop: 6 }}>
              <span className="lbl">{m.away && m.away.name}</span>
              <span>{awayInj.length} out</span>
            </div>
            <div className="dp-injury-list">
              {awayInj.length === 0 ? (
                <div className="dp-injury-empty">No reported absences</div>
              ) : (
                awayInj.slice(0, 5).map((i, idx) => (
                  <div key={`a-${idx}`} className="dp-injury-row">
                    <span className="name">
                      {i.player || 'Unknown'}
                      {i.key && <span className="key-flag" title="Key player">⚠</span>}
                    </span>
                    <span className="reason">{i.reason || i.type || ''}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
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
function MatchCard({ m, userTier, onLogBet }) {
  const [overOdds, setOverOdds] = useState('');
  const [bttsOdds, setBttsOdds] = useState('');
  const [showAnalysis, setShowAnalysis] = useState(false);

  const over = m.predictions && m.predictions.over;
  const btts = m.predictions && m.predictions.btts;
  const isStrong = isStrongValue(m);

  // EV/Kelly are gated on user-entered odds. We only show the badges once
  // an odds value is present — no placeholder "enter odds" UI.
  const overEV = useMemo(() => (overOdds && over ? calculateEV(over.confidence, overOdds) : null), [overOdds, over]);
  const bttsEV = useMemo(() => (bttsOdds && btts ? calculateEV(btts.confidence, bttsOdds) : null), [bttsOdds, btts]);
  const overKelly = useMemo(() => (overOdds && over ? calculateKelly(over.confidence, overOdds) : 0), [overOdds, over]);
  const bttsKelly = useMemo(() => (bttsOdds && btts ? calculateKelly(btts.confidence, bttsOdds) : 0), [bttsOdds, btts]);

  const canSeeEV = userTier === 'ANALYST' || userTier === 'EDGE';
  const canLogBet = canSeeEV;

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

  // ---- Past-result + upcoming pill helpers ----
  const ar = m.actualResult;
  const isPastCard = !!ar;
  let pastBorderClass = '';
  if (isPastCard) {
    if (ar.overHit && ar.bttsHit) pastBorderClass = 'past-result both-hit';
    else if (!ar.overHit && !ar.bttsHit) pastBorderClass = 'past-result both-miss';
    else pastBorderClass = 'past-result split';
  }
  const daysUntilKickoff = (() => {
    if (!m.kickoff) return null;
    try {
      const ko = new Date(m.kickoff);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const koDay = new Date(ko);
      koDay.setHours(0, 0, 0, 0);
      const ms = koDay.getTime() - today.getTime();
      return Math.round(ms / (1000 * 60 * 60 * 24));
    } catch { return null; }
  })();
  const whenPill = (() => {
    if (isPastCard) return null;
    if (daysUntilKickoff == null || daysUntilKickoff <= 0) return null;
    if (daysUntilKickoff === 1) return 'in 1 day';
    if (daysUntilKickoff <= 6) return `in ${daysUntilKickoff} days`;
    return null;
  })();

  const sharpMove = !!m.isSharpMove;

  // Goals-per-game line (cheap, still useful). Shown inline below the form row.
  const gpgLine = (() => {
    const h = m.home && m.home.goalsPerGame;
    const a = m.away && m.away.goalsPerGame;
    if (!h && !a) return null;
    return (
      <div className="dp-metric" style={{ flex: '1 1 100%' }}>
        <span className="lbl">Goals/game (for/against)</span>
        <span className="val">{fmtGpg(h)} · {fmtGpg(a)}</span>
      </div>
    );
  })();

  // Decide which market the user is most likely interested in logging.
  const overEdgeNum = overEV ? overEV.edge : null;
  const bttsEdgeNum = bttsEV ? bttsEV.edge : null;
  const useOverForLog = (overEdgeNum != null && (bttsEdgeNum == null || overEdgeNum >= bttsEdgeNum));

  return (
    <div className={`dp-match ${isStrong ? 'glow' : ''} ${pastBorderClass} ${sharpMove ? 'sharp-move' : ''}`}>
      <div className="dp-match-main">
        {isPastCard && <div className="dp-past-label">Final Result</div>}
        <div className="dp-match-league">
          <span>{m.league}</span>
          <span className="sep">·</span>
          <span>{kickoffStr(m.kickoff)}</span>
          {whenPill && <span className="dp-when-pill">{whenPill}</span>}
          {sharpMove && (
            <span className="dp-sharp-badge" title="Professional money has moved this line significantly.">
              ⚡ Sharp money
            </span>
          )}
          {m.aiStatus === 'fallback' && (
            <span
              className="dp-ai-warn-badge"
              title={`AI model unavailable: ${m.aiReason || 'unknown reason'}. Confidence values are placeholder 50% until OpenRouter responds.`}
            >
              ⚠ AI unavailable
            </span>
          )}
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
          {gpgLine}
        </div>
      </div>

      <div className="dp-conf-wrap">
        <div className="dp-bet-badges">
          {over && (
            <span className={`dp-bet-badge on mint`}>
              OVER {over.line} · {Math.round(over.confidence)}%
              {isPastCard && (
                <span className={`dp-hit-icon ${ar.overHit ? 'hit' : 'miss'}`}>
                  {ar.overHit ? '✓' : '✗'}
                </span>
              )}
            </span>
          )}
          {btts && (
            <span className={`dp-bet-badge on`}>
              BTTS {btts.prediction} · {Math.round(btts.confidence)}%
              {isPastCard && (
                <span className={`dp-hit-icon ${ar.bttsHit ? 'hit' : 'miss'}`}>
                  {ar.bttsHit ? '✓' : '✗'}
                </span>
              )}
            </span>
          )}
        </div>
        {isPastCard && (
          <div className="dp-final-score">
            <span className="ft">FT</span>
            <span>{ar.homeGoals} — {ar.awayGoals}</span>
          </div>
        )}
        <button
          type="button"
          className="dp-compare-toggle"
          style={{ marginTop: 10, width: '100%' }}
          onClick={() => setShowAnalysis((v) => !v)}
        >
          {showAnalysis ? '▲ Hide analysis' : '▼ Show analysis'}
        </button>
        {showAnalysis && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--dp-text-dim)', lineHeight: 1.5 }}>
            {over && over.reasoning && (
              <div style={{ marginBottom: 6 }}>
                <strong>Over:</strong> {over.reasoning}
              </div>
            )}
            {btts && btts.reasoning && (
              <div>
                <strong>BTTS:</strong> {btts.reasoning}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="dp-right">
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

        {/* EV + Kelly only render once odds are typed, and only for paying tiers. */}
        {canSeeEV && overEV && (
          <div className={`dp-ev-pill ${overEV.edge >= 1 ? 'positive' : ''}`}>
            <span className="l">Over edge</span>
            <span className="v">{overEV.edge >= 0 ? '+' : ''}{overEV.edge.toFixed(1)}%</span>
          </div>
        )}
        {canSeeEV && bttsEV && (
          <div className={`dp-ev-pill ${bttsEV.edge >= 1 ? 'positive' : ''}`}>
            <span className="l">BTTS edge</span>
            <span className="v">{bttsEV.edge >= 0 ? '+' : ''}{bttsEV.edge.toFixed(1)}%</span>
          </div>
        )}
        {canSeeEV && (overKelly > 0 || bttsKelly > 0) && (
          <div className="dp-odds-row">
            <span className="l">Kelly stake</span>
            <span className="v">
              {Math.max(overKelly, bttsKelly) > 0
                ? `${(Math.max(overKelly, bttsKelly) * 100).toFixed(1)}% bankroll`
                : '—'}
            </span>
          </div>
        )}

        {canLogBet && onLogBet && (overEV || bttsEV) && (
          <button
            className="dp-compare-toggle"
            style={{ marginTop: 6 }}
            onClick={() => {
              const useOver = useOverForLog;
              const odds = useOver ? parseFloat(overOdds) : parseFloat(bttsOdds);
              const market = useOver ? 'OVER' : 'BTTS';
              const kelly = useOver ? overKelly : bttsKelly;
              const bet = useOver ? `OVER ${over && over.line}` : `BTTS ${btts && btts.prediction}`;
              onLogBet({
                predictionId: m.id,
                odds,
                market,
                kelly,
                bet,
                match: `${m.home && m.home.name} vs ${m.away && m.away.name}`,
              });
            }}
          >
            → Log this bet
          </button>
        )}
      </div>
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
  // Calm-pass: hide entirely when no qualifying Best Bet. The empty
  // explainer was adding noise to the top of the dashboard every day.
  if (!data || !data.bestBet) return null;

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
  const { user, logout, setUser } = useAuth();
  const navigate = useNavigate();

  // Initial active league: first preferred if present, else MLS.
  const initialLeague = (() => {
    const prefs = (user && Array.isArray(user.preferredLeagues) && user.preferredLeagues) || [];
    const first = prefs.find((id) => LEAGUES.some((l) => l.id === id));
    return first || LEAGUES[0].id;
  })();
  const [activeLeague, setActiveLeague] = useState(initialLeague);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  // Legend / chip filter / advanced filters are intentionally removed in
  // the simplification pass. The filter helpers and DEFAULT_FILTERS values
  // remain at module scope in case we want to revive them.
  void loadFilters; void saveFilters; void DEFAULT_FILTERS; void FILTER_KEY;

  // Onboarding + toast state
  const [showOnboarding, setShowOnboarding] = useState(
    !!user && user.onboardingCompleted === false,
  );
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  // ---- Date selector state ----
  const [dateLabel, setDateLabel] = useState('Today');
  const [matchDate, setMatchDate] = useState(null);     // YYYY-MM-DD or null (when 'recent')
  const [isPast, setIsPast] = useState(false);
  // The date pills row was removed from the render; we keep the state and
  // fetch around in case we re-enable it later.
  const [activeDate, setActiveDate] = useState(null);
  const [upcomingDays, setUpcomingDays] = useState([]);
  void upcomingDays; // referenced only by the (currently disabled) pills row.

  // Bankroll metadata (for Kelly stake suggestion + Log This Bet flow).
  // Only fetched for paid tiers; FREE doesn't have access to /api/bankroll.
  const isPaidPlus = user.tier === 'ANALYST' || user.tier === 'EDGE';
  const [bankrollMeta, setBankrollMeta] = useState(null);
  useEffect(() => {
    if (!isPaidPlus) return;
    let cancelled = false;
    bankrollApi
      .get()
      .then((d) => { if (!cancelled) setBankrollMeta(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isPaidPlus]);

  // Log This Bet modal state.
  const [logBetCtx, setLogBetCtx] = useState(null);
  const closeLogBet = () => setLogBetCtx(null);

  const fetchData = useCallback(async (leagueId, initial = false, dateOverride = null) => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const params = {};
      if (initial) params.initial = 1;
      if (dateOverride) params.date = dateOverride;
      const data = await predictionsApi.getByLeague(leagueId, params);
      setMatches(data.fixtures || []);
      setDateLabel(data.dateLabel || 'Today');
      setMatchDate(data.matchDate || null);
      setIsPast(!!data.isPast);
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

  // Unified league switch: clear the pinned date and switch the league in a
  // single render so we don't briefly fetch the new league with the previous
  // league's date. React 18 batches both setStates → single re-render → single fetch.
  const switchLeague = useCallback((id) => {
    setActiveLeague((prev) => {
      if (prev === id) return prev;
      // Only clear the date pin when we're actually changing leagues.
      setActiveDate(null);
      return id;
    });
  }, []);

  // Fetch the 7-day scan for the date pills whenever the league changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await predictionsApi.getUpcoming(activeLeague, { past: 7, future: 7 });
        if (!cancelled) setUpcomingDays(Array.isArray(data.days) ? data.days : []);
      } catch {
        if (!cancelled) setUpcomingDays([]);
      }
    })();
    return () => { cancelled = true; };
  }, [activeLeague]);

  // Single fetch effect. Both league and date are watched; React 18 batches
  // the switchLeague state updates so this fires exactly once per switch.
  useEffect(() => {
    fetchData(activeLeague, !hasLoadedOnce, activeDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeague, activeDate]);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  // Always sort by edge desc; chip filters / min confidence / sort dropdown were removed.
  const filtered = useMemo(() => {
    const list = matches.slice();
    return list.sort((a, b) => {
      const ea = bestEv(a);
      const eb = bestEv(b);
      if (ea == null && eb == null) {
        const ca = a.predictions && a.predictions.over ? a.predictions.over.confidence : 0;
        const cb = b.predictions && b.predictions.over ? b.predictions.over.confidence : 0;
        return cb - ca;
      }
      return (eb ?? -Infinity) - (ea ?? -Infinity);
    });
  }, [matches]);

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
                <div className="dp-sub">AI-scored fixtures across MLS, Bundesliga, and Eredivisie.</div>
              </div>
              <span className="dp-tier-pill dp-mono">{user.tier}</span>
            </div>
            {/* Calm-pass: KPI strip (Today/Strong Value/Avg Conf/Best Edge)
                removed from the header. The counts still surface on the
                league tab badge + date pill counts, and the underlying
                strongCount/avgStrongConf/bestEdge values stay computed in
                state for any future re-use. Refresh moved next to the
                date label so it stays one click away. */}
            <div className="dp-meta" style={{ justifyContent: 'flex-end' }}>
              <button
                className="dp-btn dp-btn-sm"
                onClick={() => fetchData(activeLeague, false)}
                disabled={loading}
              >
                {loading ? 'Loading…' : '↺ Refresh'}
              </button>
            </div>
          </header>

          {/* BestBetCard + LiveActivity were removed from the dashboard render
              in the simplification pass. The BestBetCard function definition
              still lives below in case we want it back. */}

          <div className="dp-league-tabs-wrap" style={{ marginTop: 24 }}>
            <div className="dp-league-tabs">
              {LEAGUES.map((l) => (
                <button
                  key={l.id}
                  className={`dp-league-tab ${activeLeague === l.id ? 'active' : ''}`}
                  onClick={() => switchLeague(l.id)}
                >
                  <span className="flag">{l.flag}</span>
                  <span>{l.name}</span>
                  {activeLeague === l.id && <span className="ct">{matches.length}</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Date label + horizontal scroll of next 7 days */}
          <div className="dp-date-row">
            <div className={`dp-date-label ${isPast ? 'past' : ''}`}>
              {isPast ? 'Recent Results' : dateLabel}
              {matchDate && (
                <span style={{ color: 'var(--dp-text-faint)', marginLeft: 8 }}>· {(() => {
                  try { return new Date(`${matchDate}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }
                  catch { return matchDate; }
                })()}</span>
              )}
            </div>
          </div>
          {/* Date pills, filter bar, chip filter row, and HOW TO READ legend
              were all removed in the simplification pass. State + fetch for
              upcomingDays / activeDate still live above in case we revive
              the pills row. */}

          <div className="dp-matches">
            {loading ? (
              // Skeleton cards keep the layout stable — never "empty" state
              <>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="dp-match" style={{ opacity: 0.55, animation: 'skel 1.4s ease-in-out infinite' }}>
                    <div className="dp-match-main">
                      <div className="skeleton" style={{ height: 12, width: 120, borderRadius: 4 }} />
                      <div className="skeleton" style={{ height: 20, width: '70%', marginTop: 10, borderRadius: 4 }} />
                      <div className="skeleton" style={{ height: 12, width: 200, marginTop: 12, borderRadius: 4 }} />
                    </div>
                    <div className="dp-conf-wrap">
                      <div className="skeleton" style={{ height: 22, width: 60, borderRadius: 4 }} />
                      <div className="skeleton" style={{ height: 6, marginTop: 10, borderRadius: 3 }} />
                    </div>
                    <div className="dp-right">
                      <div className="skeleton" style={{ height: 14, borderRadius: 4 }} />
                      <div className="skeleton" style={{ height: 14, marginTop: 8, borderRadius: 4 }} />
                      <div className="skeleton" style={{ height: 36, marginTop: 8, borderRadius: 8 }} />
                    </div>
                  </div>
                ))}
              </>
            ) : error ? (
              <div className="dp-empty">
                <h3>Something went wrong</h3>
                <p>{error}</p>
                <div className="dp-empty-actions">
                  <button className="dp-btn dp-btn-sm" onClick={() => fetchData(activeLeague, false, activeDate)}>
                    Try again
                  </button>
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="dp-empty">
                <div className="icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-5-5" />
                  </svg>
                </div>
                <h3>Scanning fixtures…</h3>
                <p>
                  No matches found for {dateLabel}{matchDate ? ` (${matchDate})` : ''} in
                  {' '}{activeLeagueObj.name}. Pick a different date above, or jump leagues.
                </p>
                <div className="dp-empty-actions">
                  <button className="dp-btn dp-btn-sm" onClick={() => setActiveDate(null)}>
                    Auto-pick nearest date
                  </button>
                  <button className="dp-btn dp-btn-sm" onClick={() => switchLeague(LEAGUES[0].id)}>
                    Try {LEAGUES[0].name}
                  </button>
                </div>
              </div>
            ) : (
              filtered.map((m) => (
                <MatchCard
                  key={m.fixtureId || m.id}
                  m={m}
                  userTier={user.tier}
                  onLogBet={isPaidPlus ? setLogBetCtx : null}
                />
              ))
            )}

            {!loading && matches.length === 0 && message && (
              <div className="dp-mono" style={{ color: 'var(--dp-text-faint)', textAlign: 'center', paddingTop: 8 }}>
                {message}
              </div>
            )}
          </div>
        </main>
      </div>

      {logBetCtx && (
        <DashboardLogBetModal
          ctx={logBetCtx}
          bankrollMeta={bankrollMeta}
          onClose={closeLogBet}
          onSaved={(updated) => {
            setBankrollMeta(updated);
            closeLogBet();
          }}
        />
      )}

      {/* Mobile-only floating refresh button (replaces the header refresh below 769px) */}
      <button
        type="button"
        className="dp-refresh-fab"
        onClick={() => fetchData(activeLeague, false)}
        disabled={loading}
        aria-label="Refresh predictions"
        title="Refresh"
      >
        ↺
      </button>

      {showOnboarding && (
        <OnboardingOverlay
          onComplete={(updatedUser) => {
            // Merge server values back into AuthContext so the whole app
            // sees the new defaults on this render.
            setUser((u) => (u ? { ...u, ...updatedUser, onboardingCompleted: true } : u));
            // Apply chosen prefs to the current dashboard view.
            const firstLeague = Array.isArray(updatedUser.preferredLeagues) && updatedUser.preferredLeagues.length
              ? updatedUser.preferredLeagues[0]
              : LEAGUES[0].id;
            switchLeague(firstLeague);
            setShowOnboarding(false);
            setToast('Dashboard personalised. You can update preferences anytime in Settings.');
          }}
        />
      )}

      {toast && (
        <div className="ob-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}

// ============ Log This Bet modal (Dashboard) ============
function DashboardLogBetModal({ ctx, bankrollMeta, onClose, onSaved }) {
  const balance = bankrollMeta && bankrollMeta.bankroll ? Number(bankrollMeta.bankroll.currentAmount) : null;
  const currency = bankrollMeta && bankrollMeta.bankroll ? bankrollMeta.bankroll.currency : 'USD';
  const suggested = balance != null && ctx.kelly ? Math.round(balance * ctx.kelly * 100) / 100 : '';
  const [stake, setStake] = useState(suggested === '' ? '' : String(suggested));
  const [notes, setNotes] = useState(ctx.bet ? `${ctx.match} — ${ctx.bet}` : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const noBankroll = bankrollMeta && bankrollMeta.bankroll == null;
  const sym = { USD: '$', GBP: '£', EUR: '€' }[currency] || '$';

  const submit = async (e) => {
    e.preventDefault();
    if (noBankroll) return;
    setError('');
    const s = Number(stake);
    if (!s || s <= 0) { setError('Enter a stake greater than 0'); return; }
    setBusy(true);
    try {
      await bankrollApi.logBet({
        predictionId: ctx.predictionId,
        stake: s,
        odds: ctx.odds,
        market: ctx.market,
        notes,
      });
      const fresh = await bankrollApi.get();
      onSaved(fresh);
    } catch (err) {
      setError((err.response && err.response.data && err.response.data.error) || 'Failed to log bet');
    } finally {
      setBusy(false);
    }
  };

  // We use inline styles here so the modal renders correctly even without
  // the bankroll-page-scoped CSS being on the dashboard route.
  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 100, padding: 20,
  };
  const box = {
    background: '#111118', border: '1px solid #2a2a38', borderRadius: 14,
    maxWidth: 460, width: '100%', padding: '24px 22px', color: '#e8e8ec',
    fontFamily: 'Inter, system-ui, sans-serif', position: 'relative',
  };
  const label = { fontFamily: 'DM Mono, monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em', color: '#5a5a68', display: 'block', marginBottom: 6 };
  const input = { width: '100%', padding: '10px 12px', background: '#16161f', border: '1px solid #2a2a38', color: '#e8e8ec', borderRadius: 8, fontSize: 14, fontFamily: 'DM Mono, monospace', outline: 'none' };
  const btn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 38, padding: '0 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', border: '1px solid #2a2a38', background: 'transparent', color: '#e8e8ec' };
  const btnPrimary = { ...btn, background: '#6ee7b7', color: '#052e1f', borderColor: '#6ee7b7', fontWeight: 600 };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 10, right: 14, background: 'transparent', border: 'none', color: '#5a5a68', fontSize: 22, cursor: 'pointer' }}>×</button>
        <h3 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 20, margin: '0 0 6px', letterSpacing: '-0.015em' }}>Log this bet</h3>
        <div style={{ color: '#9696a3', fontSize: 13, marginBottom: 18 }}>
          {ctx.match} · <span style={{ color: '#6ee7b7', fontFamily: 'DM Mono, monospace' }}>{ctx.bet}</span> @ {Number(ctx.odds).toFixed(2)}
        </div>

        {noBankroll ? (
          <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.4)', color: '#fbbf24', padding: '12px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
            You haven't set up a bankroll yet. <Link to="/bankroll" style={{ color: '#6ee7b7', textDecoration: 'underline' }}>Set one up</Link> and come back.
          </div>
        ) : (
          <form onSubmit={submit}>
            <div style={{ marginBottom: 12 }}>
              <label style={label}>
                Stake
                {balance != null && (
                  <span style={{ float: 'right', color: '#9696a3', textTransform: 'none', letterSpacing: 0 }}>
                    bankroll {sym}{balance.toFixed(2)}
                  </span>
                )}
              </label>
              <input
                style={input}
                type="number"
                min="0.01"
                step="0.01"
                value={stake}
                onChange={(e) => setStake(e.target.value)}
                autoFocus
              />
              {ctx.kelly > 0 && (
                <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#9696a3', marginTop: 6 }}>
                  Kelly suggests {(ctx.kelly * 100).toFixed(1)}% of bankroll{balance != null ? ` = ${sym}${(balance * ctx.kelly).toFixed(2)}` : ''}
                </div>
              )}
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={label}>Notes</label>
              <input style={input} type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {error && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" style={btn} onClick={onClose}>Cancel</button>
              <button type="submit" style={btnPrimary} disabled={busy}>{busy ? 'Saving…' : 'Log bet'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
