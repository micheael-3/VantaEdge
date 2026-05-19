import { useCallback, useEffect, useMemo, useState } from 'react';
import Navbar from '../components/Navbar';
import LeagueTabs from '../components/LeagueTabs';
import MatchCard from '../components/MatchCard';
import SkeletonCard from '../components/SkeletonCard';
import UpgradeModal from '../components/UpgradeModal';
import { useAuth } from '../context/AuthContext';
import { predictions as predictionsApi } from '../api/client';
import { LEAGUES, REFRESH_LIMITS, canAccessLeague } from '../config/leagues';

function defaultLeague(tier) {
  const accessible = LEAGUES.find((l) => canAccessLeague(tier, l.minTier));
  return accessible ? accessible.id : LEAGUES[0].id;
}

export default function Dashboard() {
  const { user, refresh } = useAuth();
  const [activeLeague, setActiveLeague] = useState(defaultLeague(user.tier));
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [requiredTier, setRequiredTier] = useState(null);
  const [dailyRefreshes, setDailyRefreshes] = useState(0);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const refreshLimit = REFRESH_LIMITS[user.tier] || 0;
  const remaining = refreshLimit === Infinity ? Infinity : Math.max(0, refreshLimit - dailyRefreshes);

  const fetchData = useCallback(
    async (leagueId, initial = false) => {
      setLoading(true);
      setError('');
      setMessage('');
      try {
        const data = await predictionsApi.getByLeague(leagueId, initial ? { initial: 1 } : {});
        setMatches(data.fixtures || []);
        if (data.message) setMessage(data.message);
        if (typeof data.dailyRefreshes === 'number') setDailyRefreshes(data.dailyRefreshes);
        setHasLoadedOnce(true);
      } catch (err) {
        const status = err.response && err.response.status;
        const code = err.response && err.response.data && err.response.data.error;
        if (status === 429) {
          setError('Daily refresh limit reached. Upgrade for more.');
        } else if (status === 403) {
          // upgrade event already dispatched by interceptor
          setMatches([]);
        } else {
          setError((err.response && err.response.data && err.response.data.error) || 'Failed to load predictions');
        }
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchData(activeLeague, !hasLoadedOnce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeague]);

  useEffect(() => {
    const onUpgrade = (e) => {
      setRequiredTier((e.detail && e.detail.requiredTier) || 'SCOUT');
      setUpgradeOpen(true);
    };
    window.addEventListener('upgrade-required', onUpgrade);
    return () => window.removeEventListener('upgrade-required', onUpgrade);
  }, []);

  const handleLocked = (minTier) => {
    setRequiredTier(minTier);
    setUpgradeOpen(true);
  };

  const handleRefresh = () => {
    if (user.tier === 'FREE') {
      setRequiredTier('SCOUT');
      setUpgradeOpen(true);
      return;
    }
    if (remaining <= 0) {
      setError('Daily refresh limit reached.');
      return;
    }
    fetchData(activeLeague, false);
  };

  const refreshLabel = useMemo(() => {
    if (user.tier === 'FREE') return '↺ Refresh (upgrade)';
    if (user.tier === 'EDGE') return '↺ Refresh';
    return `↺ Refresh · ${remaining} / ${refreshLimit} left`;
  }, [user.tier, remaining, refreshLimit]);

  return (
    <>
      <Navbar />
      <div className="container" style={{ paddingTop: 12 }}>
        <div className="spread" style={{ alignItems: 'flex-end' }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>Today's matches</h2>
            <div className="muted small">
              {LEAGUES.find((l) => l.id === activeLeague) && LEAGUES.find((l) => l.id === activeLeague).name}
            </div>
          </div>
          <button className="btn" onClick={handleRefresh} disabled={user.tier === 'FREE' && hasLoadedOnce}>
            {refreshLabel}
          </button>
        </div>

        <LeagueTabs
          userTier={user.tier}
          activeLeague={activeLeague}
          onSelect={setActiveLeague}
          onLocked={handleLocked}
        />

        {loading ? (
          <div className="matches-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="card">
            <div className="error-text">{error}</div>
          </div>
        ) : matches.length === 0 ? (
          <div className="card">
            <h3>No matches</h3>
            <p className="muted small">{message || 'No fixtures scheduled today for this league.'}</p>
          </div>
        ) : (
          <div className="matches-grid">
            {matches.map((m) => (
              <MatchCard
                key={m.fixtureId || m.id}
                match={m}
                userTier={user.tier}
                onUpgrade={(tier) => {
                  setRequiredTier(tier || 'ANALYST');
                  setUpgradeOpen(true);
                }}
              />
            ))}
          </div>
        )}
      </div>

      <UpgradeModal
        open={upgradeOpen}
        requiredTier={requiredTier}
        onClose={() => setUpgradeOpen(false)}
      />
    </>
  );
}
