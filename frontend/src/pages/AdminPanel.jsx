import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout.jsx';
import Icon from '../components/Icon.jsx';
import Loading from '../components/Loading.jsx';
import { admin as adminApi, intelligence as intelligenceApi } from '../api/client.js';

// Admin Panel — three tabs: STATS, USERS, PREDICTIONS.
// Mounted at /admin-panel and gated by <AdminOnly> in App.jsx.

const TABS = [
  { key: 'stats', label: 'Stats' },
  { key: 'users', label: 'Users' },
  { key: 'predictions', label: 'Predictions' },
  { key: 'intelligence', label: 'Intelligence' },
];

const TIER_BADGE = {
  FREE: 'badge badge-soft',
  ANALYST: 'badge badge-mint',
  EDGE: 'badge badge-indigo',
};

function formatDateLong(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return String(iso).slice(0, 10);
  }
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' · ' +
      d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    );
  } catch {
    return String(iso);
  }
}

function KpiTile({ label, value, sub, highlight }) {
  return (
    <div
      className="card"
      style={{
        padding: 20,
        borderColor: highlight ? 'rgba(110,231,183,0.3)' : 'var(--border)',
        background: highlight
          ? 'linear-gradient(180deg, rgba(110,231,183,0.04), transparent), var(--card)'
          : 'var(--card)',
      }}
    >
      <div
        className="mono"
        style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.1em', marginBottom: 10 }}
      >
        {label}
      </div>
      <div
        className="display"
        style={{
          fontSize: 38,
          fontWeight: 700,
          letterSpacing: '-0.03em',
          lineHeight: 1,
          color: highlight ? 'var(--mint)' : 'var(--text)',
        }}
      >
        {value}
      </div>
      <div
        className="mono"
        style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, minHeight: 14 }}
      >
        {sub || ''}
      </div>
    </div>
  );
}

function StatsTab() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rescanState, setRescanState] = useState({ busy: false, message: '' });
  // Three pieces of state for the destructive / recovery admin tools.
  // Kept inline with the stats tab so they sit next to "Force Rescan" —
  // same mental model: "do something to the predictions table".
  const [clearState, setClearState] = useState({ busy: false, message: '' });
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [clearAllInput, setClearAllInput] = useState('');
  const [clearBadState, setClearBadState] = useState({ busy: false, message: '' });
  const [resettleState, setResettleState] = useState({ busy: false, message: '' });
  const [refreshFormsState, setRefreshFormsState] = useState({ busy: false, message: '' });
  const [recoverState, setRecoverState] = useState({ busy: false, message: '' });
  const [recoverDays, setRecoverDays] = useState('30');
  const [dedupState, setDedupState] = useState({ busy: false, message: '' });
  const [debugId, setDebugId] = useState('');
  const [debugState, setDebugState] = useState({ busy: false, message: '', result: null });

  const loadStats = (cancelledRef) => {
    setLoading(true);
    adminApi
      .stats()
      .then((r) => {
        if (cancelledRef && cancelledRef.cancelled) return;
        setStats(r);
      })
      .catch((err) => {
        if (cancelledRef && cancelledRef.cancelled) return;
        setError(err?.response?.data?.error || err.message || 'Failed to load stats');
      })
      .finally(() => {
        if (cancelledRef && cancelledRef.cancelled) return;
        setLoading(false);
      });
  };

  useEffect(() => {
    const cancelledRef = { cancelled: false };
    loadStats(cancelledRef);
    return () => {
      cancelledRef.cancelled = true;
    };
  }, []);

  const onForceRescan = async () => {
    if (rescanState.busy) return;
    setRescanState({ busy: true, message: '' });
    try {
      await adminApi.forceRescan(253);
      setRescanState({ busy: true, message: 'Rescan triggered. Predictions will populate over the next few minutes.' });
      // Refresh stats after the scan has had time to finish.
      setTimeout(() => {
        loadStats({ cancelled: false });
        setRescanState({ busy: false, message: 'Stats refreshed.' });
        setTimeout(() => setRescanState((s) => ({ ...s, message: '' })), 4000);
      }, 30000);
    } catch (err) {
      setRescanState({
        busy: false,
        message: err?.response?.data?.error || err.message || 'Rescan failed',
      });
    }
  };

  // Open the typed-confirmation modal. We DON'T run the destructive
  // action until the user types the literal phrase "DELETE ALL" and
  // hits the second button. Window.confirm was too easy to muscle-
  // memory through — we wiped settled accuracy data once that way.
  const onOpenClearAll = () => {
    if (clearState.busy) return;
    setClearAllInput('');
    setClearAllOpen(true);
  };

  const onConfirmClearAll = async () => {
    if (clearState.busy) return;
    if (clearAllInput.trim() !== 'DELETE ALL') return;
    setClearAllOpen(false);
    setClearState({ busy: true, message: 'Wiping tables & triggering rescan…' });
    try {
      const r = await adminApi.clearAll('DELETE ALL');
      setClearState({
        busy: false,
        message: `Wiped ${r.totalDeleted ?? 0} rows across ${(r.results || []).length} tables. Scan ${r.scanTriggered ? 'triggered' : 'NOT triggered'} — refresh dashboard in ~1 min.`,
      });
      setClearAllInput('');
      setTimeout(() => loadStats({ cancelled: false }), 5000);
    } catch (err) {
      setClearState({
        busy: false,
        message: err?.response?.data?.error || err.message || 'Clear failed',
      });
    }
  };

  // Clear ONLY synthetic 50/50 placeholders. Safe — never touches
  // settled rows. Single button-press, no typed confirmation.
  const onClearBad = async () => {
    if (clearBadState.busy) return;
    if (!window.confirm('Delete synthetic 50%/50% placeholder rows (legacy fallback)? Settled rows are untouched.')) return;
    setClearBadState({ busy: true, message: 'Cleaning placeholders…' });
    try {
      const r = await adminApi.clearBad();
      setClearBadState({
        busy: false,
        message: `Removed ${r.deletedRows ?? 0} placeholder rows. Settled rows preserved.`,
      });
      setTimeout(() => loadStats({ cancelled: false }), 1500);
    } catch (err) {
      setClearBadState({
        busy: false,
        message: err?.response?.data?.error || err.message || 'Clear-bad failed',
      });
    }
  };

  // Refresh the form arrays inside match_data on every UPCOMING row.
  // Non-destructive — UPDATEs match_data only. Fixes the case where
  // the form dots on today's cards show 2-3 letters + grey squares
  // because the row was inserted before the topUpForm fix shipped.
  const onRefreshForms = async () => {
    if (refreshFormsState.busy) return;
    setRefreshFormsState({ busy: true, message: 'Re-fetching team form from API-Football…' });
    try {
      const r = await adminApi.refreshForms();
      const rep = (r && r.report) || {};
      setRefreshFormsState({
        busy: false,
        message: `Refreshed ${rep.rowsUpdated ?? 0} of ${rep.rowsScanned ?? 0} upcoming rows in ${rep.durationMs ?? 0}ms. Dashboard cards will refresh on next load.`,
      });
    } catch (err) {
      setRefreshFormsState({
        busy: false,
        message: err?.response?.data?.error || err.message || 'Refresh forms failed',
      });
    }
  };

  // Remove ghost rows (0% confidence) and duplicate fixture rows.
  // Pre-migration cleanup; safe to call repeatedly. Requires the user
  // to confirm because deletions are not reversible.
  const onDedup = async () => {
    if (dedupState.busy) return;
    if (!window.confirm(
      'Remove duplicate and 0% confidence (recovered/ghost) records?\n\n' +
      'This deletes:\n' +
      '  • Every prediction where over_confidence is 0 or NULL\n' +
      '  • Every duplicate row for the same fixture (keeping the highest confidence)\n\n' +
      'Settled match scores are unaffected. Cannot be undone.',
    )) return;
    setDedupState({ busy: true, message: 'Removing ghost + duplicate rows…' });
    try {
      const r = await adminApi.deduplicate();
      const rep = (r && r.report) || {};
      setDedupState({
        busy: false,
        message: `Removed ${rep.zeroRowsDeleted ?? 0} ghost rows + ${rep.duplicateRowsDeleted ?? 0} duplicates (${r.totalDeleted ?? 0} total). Refresh dashboard to see clean data.`,
      });
      setTimeout(() => loadStats({ cancelled: false }), 1500);
    } catch (err) {
      setDedupState({
        busy: false,
        message: err?.response?.data?.error || err.message || 'Deduplicate failed',
      });
    }
  };

  // Score-only history recovery from API-Football. Inserts placeholder
  // rows for finished fixtures missing from the DB. No fabricated AI
  // predictions — recovered rows are clearly flagged. Use when you've
  // lost match history and just want the scores back on Results.
  const onRecover = async () => {
    if (recoverState.busy) return;
    const n = parseInt(recoverDays, 10);
    const days = Number.isFinite(n) && n > 0 ? Math.min(n, 90) : 30;
    setRecoverState({ busy: true, message: `Pulling last ${days} days of MLS fixtures from API-Football…` });
    try {
      const r = await adminApi.recoverHistory(days);
      const rep = (r && r.report) || {};
      setRecoverState({
        busy: false,
        message: `Recovered ${rep.rowsInserted ?? 0} matches (of ${rep.fixturesFinished ?? 0} finished; ${rep.fixturesAlreadyInDb ?? 0} already existed). Refresh Results page to see them.`,
      });
      setTimeout(() => loadStats({ cancelled: false }), 1500);
    } catch (err) {
      setRecoverState({
        busy: false,
        message: err?.response?.data?.error || err.message || 'Recovery failed',
      });
    }
  };

  // Re-run agent-results settle logic for any past prediction missing
  // hit columns. Recovery action — safe to call repeatedly.
  const onResettle = async () => {
    if (resettleState.busy) return;
    setResettleState({ busy: true, message: 'Re-fetching scores from API-Football and settling…' });
    try {
      const r = await adminApi.resettle();
      const rep = r && r.report ? r.report : {};
      setResettleState({
        busy: false,
        message: `Resettle: queried ${rep.fixturesQueried ?? 0} fixtures, settled ${rep.fixturesSettled ?? 0}, updated ${rep.predictionsUpdated ?? 0} predictions${rep.fixturesPendingFt ? `, ${rep.fixturesPendingFt} still pending FT` : ''}.`,
      });
      setTimeout(() => loadStats({ cancelled: false }), 1500);
    } catch (err) {
      setResettleState({
        busy: false,
        message: err?.response?.data?.error || err.message || 'Resettle failed',
      });
    }
  };

  // Inspect a single fixture's raw data. Opens nothing — we render the
  // result inline as JSON so the admin can scan it and confirm the
  // form/stats/standings match what the dashboard shows.
  const onDebug = async () => {
    if (debugState.busy) return;
    const id = parseInt(String(debugId).trim(), 10);
    if (!Number.isFinite(id) || id <= 0) {
      setDebugState({ busy: false, message: 'Enter a numeric fixture id', result: null });
      return;
    }
    setDebugState({ busy: true, message: 'Fetching raw fixture data…', result: null });
    try {
      const r = await adminApi.debugFixture(id);
      setDebugState({ busy: false, message: '', result: r });
    } catch (err) {
      setDebugState({
        busy: false,
        message: err?.response?.data?.error || err.message || 'Debug failed',
        result: null,
      });
    }
  };

  if (loading) return <Loading label="Loading stats…" />;
  if (error) {
    return (
      <div className="empty-state">
        <h3>Couldn't load stats</h3>
        <p>{error}</p>
      </div>
    );
  }
  if (!stats) return null;

  const byTier = stats.byTier || {};
  return (
    <>
      <div
        className="history-kpi-grid"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}
      >
        <KpiTile label="TOTAL USERS" value={stats.totalUsers ?? 0} highlight />
        <KpiTile label="FREE USERS" value={byTier.FREE ?? 0} />
        <KpiTile label="ANALYST USERS" value={byTier.ANALYST ?? 0} />
        <KpiTile label="NEW USERS TODAY" value={stats.newUsersToday ?? 0} />
        <KpiTile label="PREDICTIONS TODAY" value={stats.predictionsToday ?? 0} />
      </div>
      <div
        className="card"
        style={{
          padding: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.1em' }}
        >
          TOTAL PREDICTIONS ALL TIME
        </div>
        <div className="display" style={{ fontSize: 24, fontWeight: 700 }}>
          {stats.predictionsAllTime ?? 0}
        </div>
      </div>
      <div
        className="card"
        style={{
          marginTop: 16,
          padding: 16,
          display: 'flex',
          gap: 18,
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
          EDGE USERS
        </div>
        <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>
          {byTier.EDGE ?? 0}
        </div>
      </div>
      <div
        className="card"
        style={{
          marginTop: 16,
          padding: 16,
          display: 'flex',
          gap: 18,
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.1em' }}>
            WEEKLY SCAN
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
            Wipe this week's MLS predictions and trigger a fresh background scan.
          </div>
          {rescanState.message && (
            <div
              className="mono"
              style={{ marginTop: 8, fontSize: 11, color: rescanState.busy ? 'var(--mint)' : 'var(--text-3)' }}
            >
              {rescanState.message}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onForceRescan}
          disabled={rescanState.busy}
        >
          {rescanState.busy ? 'Rescanning…' : 'Force Rescan'}
        </button>
      </div>

      {/* Destructive: wipe every prediction-related table + trigger scan.
          Lives next to "Force Rescan" but does much more — wipes 10
          tables (predictions, accuracy_model, best_bet, agent_alerts,
          odds snapshots, etc.) before kicking the background scanner. */}
      <div
        className="card"
        style={{
          marginTop: 16,
          padding: 16,
          display: 'flex',
          gap: 18,
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          borderColor: 'rgba(239,68,68,0.3)',
        }}
      >
        <div>
          <div
            className="mono"
            style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.1em' }}
          >
            CLEAR ALL & RESCAN
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
            Wipe every prediction-related table (10 tables) and force a fresh scan with the latest pipeline. Use after a model or prompt change.
          </div>
          {clearState.message && (
            <div
              className="mono"
              style={{ marginTop: 8, fontSize: 11, color: clearState.busy ? 'var(--mint)' : 'var(--text-3)' }}
            >
              {clearState.message}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onOpenClearAll}
          disabled={clearState.busy}
          style={{ borderColor: 'rgba(239,68,68,0.4)', color: 'var(--red)' }}
        >
          {clearState.busy ? 'Wiping…' : 'Clear All & Rescan'}
        </button>
      </div>

      {/* Resettle past predictions — recovery action. Walks every past
          prediction missing hit columns, re-fetches the real score
          from API-Football, writes hit/miss + accuracy_score. */}
      <div
        className="card"
        style={{
          marginTop: 16,
          padding: 16,
          display: 'flex',
          gap: 18,
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          borderColor: 'rgba(110,231,183,0.3)',
        }}
      >
        <div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.1em' }}>
            RE-SETTLE PAST PREDICTIONS
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
            Re-fetch results from API-Football for every past prediction missing hit/miss. Use to recover settled data after an accidental wipe.
          </div>
          {resettleState.message && (
            <div
              className="mono"
              style={{ marginTop: 8, fontSize: 11, color: resettleState.busy ? 'var(--mint)' : 'var(--text-3)' }}
            >
              {resettleState.message}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onResettle}
          disabled={resettleState.busy}
          style={{
            // Amber — not destructive (no DELETE) but not primary
            // either; it's a recovery action so we want the user to
            // notice it without it competing with Force Rescan.
            borderColor: 'rgba(251,191,36,0.45)',
            color: 'var(--amber)',
          }}
        >
          {resettleState.busy ? 'Re-settling…' : 'Re-settle Past Predictions'}
        </button>
      </div>

      {/* Deduplicate — strip ghost rows (0% confidence) and collapse
          duplicate (fixture_id) rows. Must run BEFORE the UNIQUE
          constraint in run-migration.sql can be added; safe to run
          repeatedly afterwards. */}
      <div
        className="card"
        style={{
          marginTop: 16,
          padding: 16,
          display: 'flex',
          gap: 18,
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          borderColor: 'rgba(251,191,36,0.4)',
        }}
      >
        <div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.1em' }}>
            REMOVE DUPLICATE PREDICTIONS
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
            Drop 0% confidence ghost rows AND collapse duplicate-fixture rows to the highest-confidence row. Required before the new UNIQUE constraint in run-migration.sql can apply.
          </div>
          {dedupState.message && (
            <div
              className="mono"
              style={{ marginTop: 8, fontSize: 11, color: dedupState.busy ? 'var(--mint)' : 'var(--text-3)' }}
            >
              {dedupState.message}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onDedup}
          disabled={dedupState.busy}
          style={{ borderColor: 'rgba(251,191,36,0.5)', color: 'var(--amber)' }}
        >
          {dedupState.busy ? 'Cleaning…' : 'Remove Duplicate Predictions'}
        </button>
      </div>

      {/* Recover match history from API-Football. Score-only — no
          fabricated AI predictions. Brings the Results page back to
          life when settled rows have been DELETEd, not just nulled. */}
      <div
        className="card"
        style={{
          marginTop: 16,
          padding: 16,
          display: 'flex',
          gap: 12,
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          borderColor: 'rgba(110,231,183,0.3)',
        }}
      >
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.1em' }}>
            RECOVER MATCH HISTORY
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
            Pull the last N days of MLS fixtures from API-Football and insert any that aren't already in the DB. Score-only — does NOT fabricate AI predictions. Recovered rows are flagged and won't pollute Accuracy stats.
          </div>
          {recoverState.message && (
            <div
              className="mono"
              style={{ marginTop: 8, fontSize: 11, color: recoverState.busy ? 'var(--mint)' : 'var(--text-3)' }}
            >
              {recoverState.message}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="input"
            type="number"
            value={recoverDays}
            onChange={(e) => setRecoverDays(e.target.value)}
            min="1"
            max="90"
            step="1"
            style={{ width: 70, minHeight: 36 }}
            aria-label="Days to recover"
          />
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>DAYS</span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onRecover}
            disabled={recoverState.busy}
          >
            {recoverState.busy ? 'Recovering…' : 'Recover History'}
          </button>
        </div>
      </div>

      {/* Refresh form arrays in match_data on upcoming rows. UPDATEs
          only — never DELETEs. Use when form dots look thin/empty. */}
      <div
        className="card"
        style={{
          marginTop: 16,
          padding: 16,
          display: 'flex',
          gap: 18,
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.1em' }}>
            REFRESH FORM DATA
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
            Re-fetch team form from API-Football for every upcoming row and update match_data in place. Non-destructive — no DELETE, no settle changes.
          </div>
          {refreshFormsState.message && (
            <div
              className="mono"
              style={{ marginTop: 8, fontSize: 11, color: refreshFormsState.busy ? 'var(--mint)' : 'var(--text-3)' }}
            >
              {refreshFormsState.message}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onRefreshForms}
          disabled={refreshFormsState.busy}
        >
          {refreshFormsState.busy ? 'Refreshing…' : 'Refresh Form Data'}
        </button>
      </div>

      {/* Clear synthetic 50/50 placeholders — safe, settled rows
          untouched. Cleans up legacy "Analysis unavailable" rows. */}
      <div
        className="card"
        style={{
          marginTop: 16,
          padding: 16,
          display: 'flex',
          gap: 18,
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.1em' }}>
            CLEAR BAD PREDICTIONS
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
            Delete synthetic 50/50 placeholder rows (legacy fallback path). Settled rows are never touched.
          </div>
          {clearBadState.message && (
            <div
              className="mono"
              style={{ marginTop: 8, fontSize: 11, color: clearBadState.busy ? 'var(--mint)' : 'var(--text-3)' }}
            >
              {clearBadState.message}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onClearBad}
          disabled={clearBadState.busy}
        >
          {clearBadState.busy ? 'Clearing…' : 'Clear Bad Predictions'}
        </button>
      </div>

      {/* Typed-confirmation modal for Clear All. Requires the user to
          type the literal string "DELETE ALL" before the button enables.
          Backed up by the same check on the backend so a forged client
          can't bypass it. */}
      {clearAllOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            background: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setClearAllOpen(false); }}
        >
          <div
            className="card"
            style={{
              maxWidth: 460,
              width: '100%',
              padding: 22,
              borderColor: 'rgba(239,68,68,0.45)',
              background: 'linear-gradient(180deg, rgba(239,68,68,0.06), transparent), var(--card)',
            }}
          >
            <div
              className="mono"
              style={{ fontSize: 10, color: 'var(--red)', letterSpacing: '0.12em', marginBottom: 8 }}
            >
              IRREVERSIBLE
            </div>
            <h3
              className="display"
              style={{ fontSize: 22, fontWeight: 700, margin: '0 0 10px', letterSpacing: '-0.02em' }}
            >
              Wipe ALL prediction data?
            </h3>
            <p style={{ margin: '0 0 14px', color: 'var(--text-2)', fontSize: 14, lineHeight: 1.5 }}>
              This deletes <strong>every settled result</strong> across 10 tables —
              accuracy history, best-bet, agent alerts, odds snapshots, bankroll
              links. You'll lose everything the AI has learned from settled
              matches. There is no undo.
            </p>
            <p style={{ margin: '0 0 10px', color: 'var(--text-3)', fontSize: 12 }}>
              For a non-destructive refresh of upcoming-only predictions, use
              "Force Rescan" instead. To recover lost settled data, use
              "Re-settle Past Predictions".
            </p>
            <label
              className="mono"
              style={{
                display: 'block',
                fontSize: 10,
                letterSpacing: '0.1em',
                color: 'var(--text-3)',
                marginBottom: 6,
              }}
            >
              TYPE <span style={{ color: 'var(--red)' }}>DELETE ALL</span> TO CONFIRM
            </label>
            <input
              className="input"
              type="text"
              autoFocus
              value={clearAllInput}
              onChange={(e) => setClearAllInput(e.target.value)}
              placeholder="DELETE ALL"
              style={{ marginBottom: 14 }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setClearAllOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={onConfirmClearAll}
                disabled={clearAllInput.trim() !== 'DELETE ALL'}
                style={{
                  background: clearAllInput.trim() === 'DELETE ALL' ? 'var(--red)' : 'var(--card-2)',
                  color: clearAllInput.trim() === 'DELETE ALL' ? '#fff' : 'var(--text-faint)',
                  borderColor: 'rgba(239,68,68,0.45)',
                  cursor: clearAllInput.trim() === 'DELETE ALL' ? 'pointer' : 'not-allowed',
                }}
              >
                Wipe Everything
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Per-fixture inspector. Paste a fixtureId, see exactly what the
          scan would fetch + send to Claude. Renders the JSON inline so
          you can verify form/standings/refs before trusting a card. */}
      <div
        className="card"
        style={{
          marginTop: 16,
          padding: 16,
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.1em' }}
        >
          DEBUG FIXTURE
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
          Inspect the raw API-Football data and the extracted form / stats / standings / referee for a single fixture id.
        </div>
        <div
          style={{
            marginTop: 10,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <input
            className="input"
            type="text"
            inputMode="numeric"
            placeholder="Fixture id (e.g. 1318755)"
            value={debugId}
            onChange={(e) => setDebugId(e.target.value)}
            style={{ flex: '1 1 220px', minHeight: 36 }}
            disabled={debugState.busy}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onDebug}
            disabled={debugState.busy}
          >
            {debugState.busy ? 'Fetching…' : 'Debug'}
          </button>
        </div>
        {debugState.message && (
          <div
            className="mono"
            style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)' }}
          >
            {debugState.message}
          </div>
        )}
        {debugState.result && (
          <pre
            style={{
              marginTop: 12,
              padding: 12,
              background: 'var(--bg-2)',
              border: '1px solid var(--border-soft)',
              borderRadius: 8,
              fontSize: 11,
              lineHeight: 1.5,
              maxHeight: 480,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {JSON.stringify(debugState.result, null, 2)}
          </pre>
        )}
      </div>
    </>
  );
}

function UsersTab() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [updating, setUpdating] = useState({});

  useEffect(() => {
    let cancelled = false;
    adminApi
      .users()
      .then((r) => {
        if (!cancelled) setUsers(r.users || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.data?.error || err.message || 'Failed to load users');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => String(u.email || '').toLowerCase().includes(q));
  }, [users, search]);

  const onTierChange = async (userId, tier) => {
    setUpdating((m) => ({ ...m, [userId]: true }));
    // Optimistic — flip the row immediately, roll back on failure.
    const prev = users;
    setUsers((list) => list.map((u) => (u.id === userId ? { ...u, tier } : u)));
    try {
      await adminApi.setTier(userId, tier);
    } catch (err) {
      console.error('tier change failed:', err);
      setUsers(prev);
      alert(err?.response?.data?.error || 'Failed to change tier');
    } finally {
      setUpdating((m) => {
        const copy = { ...m };
        delete copy[userId];
        return copy;
      });
    }
  };

  if (loading) return <Loading label="Loading users…" />;
  if (error) {
    return (
      <div className="empty-state">
        <h3>Couldn't load users</h3>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by email…"
          style={{
            flex: 1,
            minWidth: 240,
            padding: '8px 12px',
            background: 'var(--bg-2)',
            border: '1px solid var(--border-soft)',
            borderRadius: 8,
            color: 'var(--text)',
            fontSize: 13,
          }}
        />
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
          {filtered.length} ROW{filtered.length === 1 ? '' : 'S'}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th>Email</th>
              <th>Tier</th>
              <th>Joined</th>
              <th>Predictions</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan="5" className="muted">No users match this filter.</td>
              </tr>
            ) : (
              filtered.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.email}
                    {u.isAdmin && (
                      <span
                        className="badge badge-mint"
                        style={{ fontSize: 9, padding: '2px 6px', marginLeft: 8 }}
                      >
                        ADMIN
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={TIER_BADGE[u.tier] || 'badge badge-soft'} style={{ fontSize: 10 }}>
                      {u.tier || '—'}
                    </span>
                  </td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {formatDateLong(u.createdAt)}
                  </td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>—</td>
                  <td>
                    <select
                      value={u.tier || 'FREE'}
                      disabled={!!updating[u.id]}
                      onChange={(e) => onTierChange(u.id, e.target.value)}
                      style={{
                        background: 'var(--bg-2)',
                        color: 'var(--text)',
                        border: '1px solid var(--border-soft)',
                        borderRadius: 6,
                        padding: '4px 8px',
                        fontSize: 12,
                      }}
                      aria-label={`Change tier for ${u.email}`}
                    >
                      <option value="FREE">FREE</option>
                      <option value="ANALYST">ANALYST</option>
                      <option value="EDGE">EDGE</option>
                    </select>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const PRED_WINDOWS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'all', label: 'All' },
];

function isWithin(rangeKey, iso) {
  if (rangeKey === 'all') return true;
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  if (rangeKey === 'today') {
    return (
      d.getUTCFullYear() === now.getUTCFullYear() &&
      d.getUTCMonth() === now.getUTCMonth() &&
      d.getUTCDate() === now.getUTCDate()
    );
  }
  if (rangeKey === 'week') {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    return now.getTime() - d.getTime() <= weekMs;
  }
  return true;
}

function HitIcon({ value }) {
  if (value === true) return <Icon name="check" size={12} color="var(--mint)" />;
  if (value === false) return <Icon name="x" size={11} color="var(--red)" />;
  return <span style={{ color: 'var(--text-faint)' }}>⏳</span>;
}

function PredictionsTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [windowKey, setWindowKey] = useState('today');

  useEffect(() => {
    let cancelled = false;
    adminApi
      .predictions()
      .then((r) => {
        if (!cancelled) setRows(r.predictions || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.data?.error || err.message || 'Failed to load predictions');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(
    () =>
      rows
        .filter((r) => isWithin(windowKey, r.createdAt))
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [rows, windowKey],
  );

  if (loading) return <Loading label="Loading predictions…" />;
  if (error) {
    return (
      <div className="empty-state">
        <h3>Couldn't load predictions</h3>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: 4,
            background: 'var(--bg-2)',
            borderRadius: 10,
            border: '1px solid var(--border-soft)',
          }}
        >
          {PRED_WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => setWindowKey(w.key)}
              style={{
                padding: '6px 12px',
                border: 'none',
                background: windowKey === w.key ? 'var(--card-2)' : 'transparent',
                color: windowKey === w.key ? 'var(--text)' : 'var(--text-3)',
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 6,
              }}
            >
              {w.label}
            </button>
          ))}
        </div>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)', alignSelf: 'center' }}>
          {filtered.length} ROW{filtered.length === 1 ? '' : 'S'}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ minWidth: 980 }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>User</th>
              <th>Match</th>
              <th>Over</th>
              <th>Conf</th>
              <th>Over hit</th>
              <th>BTTS</th>
              <th>Conf</th>
              <th>BTTS hit</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan="9" className="muted">No predictions in this window.</td>
              </tr>
            ) : (
              filtered.map((r, i) => (
                <tr key={`${r.createdAt}-${i}`}>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {formatDateTime(r.createdAt)}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{r.userEmail || '—'}</td>
                  <td>{r.homeTeam} vs {r.awayTeam}</td>
                  <td>O {r.overLine ?? '—'}</td>
                  <td className="mono">{r.overConfidence != null ? `${r.overConfidence}%` : '—'}</td>
                  <td><HitIcon value={r.overHit} /></td>
                  <td>{r.btts || '—'}</td>
                  <td className="mono">{r.bttsConfidence != null ? `${r.bttsConfidence}%` : '—'}</td>
                  <td><HitIcon value={r.bttsHit} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminPanel() {
  const [tab, setTab] = useState('stats');

  return (
    <Layout>
      {() => (
        <div>
          <div style={{ marginBottom: 24 }}>
            <h1
              className="display"
              style={{ fontSize: 36, fontWeight: 700, margin: 0, letterSpacing: '-0.025em' }}
            >
              Admin Panel
            </h1>
            <p
              className="mono"
              style={{ margin: '4px 0 0', color: 'var(--text-3)', fontSize: 12, letterSpacing: '0.04em' }}
            >
              FOUNDER TOOLS · USERS · STATS · PREDICTIONS
            </p>
          </div>
          <div
            style={{
              display: 'inline-flex',
              gap: 4,
              padding: 4,
              background: 'var(--card)',
              borderRadius: 10,
              border: '1px solid var(--border-soft)',
              marginBottom: 16,
            }}
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                style={{
                  padding: '6px 14px',
                  border: 'none',
                  background: tab === t.key ? 'var(--card-2)' : 'transparent',
                  color: tab === t.key ? 'var(--text)' : 'var(--text-3)',
                  fontSize: 12,
                  fontWeight: 500,
                  borderRadius: 6,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'stats' && <StatsTab />}
          {tab === 'users' && <UsersTab />}
          {tab === 'predictions' && <PredictionsTab />}
          {tab === 'intelligence' && <IntelligenceTab />}
        </div>
      )}
    </Layout>
  );
}

// Intelligence Evolution dashboard. Shows the composite intelligence
// score (from /api/intelligence), the active learned rules table,
// recent autopsies, and recent pattern insights. Read-only for now —
// the rule-toggle and "Run Pattern Mining" controls are stubs that
// just show what would be wired (they'd POST to admin endpoints that
// don't exist yet). Each section lazily fetches its data on tab open.
function IntelligenceTab() {
  const [intel, setIntel] = useState(null);
  const [intelError, setIntelError] = useState('');

  useEffect(() => {
    let cancelled = false;
    intelligenceApi
      .get()
      .then((r) => { if (!cancelled) setIntel(r); })
      .catch((err) => {
        if (!cancelled) setIntelError(err?.response?.data?.error || err.message || 'Failed to load intelligence');
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      {/* Big score header */}
      <div
        className="card"
        style={{
          padding: 22,
          marginBottom: 16,
          borderColor: 'rgba(110,231,183,0.3)',
          background: 'linear-gradient(180deg, rgba(110,231,183,0.05), transparent), var(--card)',
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.1em', marginBottom: 8 }}
        >
          FASTSCORE INTELLIGENCE SCORE
        </div>
        {intelError ? (
          <div style={{ fontSize: 14, color: 'var(--red)' }}>{intelError}</div>
        ) : !intel ? (
          <div className="muted">Loading…</div>
        ) : (
          <>
            <div
              className="display"
              style={{ fontSize: 56, fontWeight: 700, color: 'var(--mint)', letterSpacing: '-0.03em', lineHeight: 1 }}
            >
              {intel.score}
              <span style={{ fontSize: 18, color: 'var(--text-3)', marginLeft: 8 }}>/ 1150</span>
            </div>
            <div
              style={{
                marginTop: 14,
                height: 4,
                background: 'var(--border-soft)',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, (intel.score / 1150) * 100)}%`,
                  height: '100%',
                  background: 'var(--mint)',
                }}
              />
            </div>
            <div
              className="mono"
              style={{ marginTop: 14, fontSize: 11, color: 'var(--text-2)', letterSpacing: '0.04em' }}
            >
              {intel.settledPredictions} settled · {intel.learnedRules} learned rules ·{' '}
              {intel.calibrationWeeks} weeks of calibration · {intel.overallAccuracy}% accuracy · {intel.trend.toUpperCase()}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)' }}>
              Breakdown: base {intel.breakdown.base} + predictions {intel.breakdown.settledPoints} + rules{' '}
              {intel.breakdown.rulesPoints} + calibration {intel.breakdown.calibrationPoints} + accuracy{' '}
              {intel.breakdown.accuracyBonus}
            </div>
          </>
        )}
      </div>

      {/* Lazy panels — each fetches via its own admin endpoint when wired.
          Today they show a static "comes online after a deploy + first
          run" placeholder so the tab isn't blank pre-migration. */}
      <IntelligencePanel
        title="ACTIVE LEARNED RULES"
        emptyMessage="No rules yet. After agent-autopsy runs daily at 4am (or pattern mining on Monday at 5am), high-confidence rules appear here."
        endpointHint="learned_rules"
      />
      <IntelligencePanel
        title="PATTERN INSIGHTS"
        emptyMessage="No patterns mined yet. Pattern mining runs weekly on Monday at 5am and writes to pattern_insights when a (dimension, value) group beats the average hit rate by >10pts."
        endpointHint="pattern_insights"
      />
      <IntelligencePanel
        title="RECENT AUTOPSIES"
        emptyMessage="Autopsy of the last 24h of settled predictions runs daily at 4am. The first run after a matchday populates this list."
        endpointHint="prediction_autopsy"
      />
    </>
  );
}

function IntelligencePanel({ title, emptyMessage }) {
  return (
    <div className="card" style={{ padding: 16, marginBottom: 12 }}>
      <div
        className="mono"
        style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.1em', marginBottom: 6 }}
      >
        {title}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
        {emptyMessage}
      </div>
    </div>
  );
}
