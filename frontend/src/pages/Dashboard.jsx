import { useCallback, useEffect, useMemo, useState } from 'react';
import Navbar from '../components/Navbar.jsx';
import CalendarStrip from '../components/CalendarStrip.jsx';
import MatchCard from '../components/MatchCard.jsx';
import Loading from '../components/Loading.jsx';
import { predictions } from '../api/client.js';
import { formatDateLabel } from '../lib/dateLabel.js';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [pinnedDate, setPinnedDate] = useState(null);
  const [error, setError] = useState('');

  // Pull the 15-day strip once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const u = await predictions.upcoming({ past: 7, future: 7 });
        if (!cancelled) setDays(u.days || []);
      } catch {
        /* strip is optional; dashboard still renders without it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchDay = useCallback(async (date, isInitial) => {
    if (isInitial) setLoading(true);
    else setSwitching(true);
    setError('');
    try {
      const params = {};
      if (date) params.date = date;
      if (isInitial) params.initial = 1;
      const res = await predictions.get(params);
      setData(res);
    } catch (err) {
      const msg =
        (err.response && err.response.data && err.response.data.message) ||
        (err.response && err.response.data && err.response.data.error) ||
        'Failed to load predictions';
      setError(msg);
    } finally {
      setLoading(false);
      setSwitching(false);
    }
  }, []);

  useEffect(() => {
    fetchDay(null, true);
  }, [fetchDay]);

  const activeDate = pinnedDate || (data && data.matchDate) || null;

  const dateLabel = useMemo(() => {
    if (!data) return '';
    return formatDateLabel(data.matchDate, data.isPast, data.isToday);
  }, [data]);

  const onSelectDay = (date) => {
    setPinnedDate(date);
    fetchDay(date, false);
  };

  const onRefresh = () => {
    fetchDay(activeDate, false);
  };

  const showRecent = () => {
    // Find the most recent past day in the strip that actually has matches.
    const past = days.filter((d) => d.isPast && d.count > 0);
    if (past.length === 0) return;
    const target = past[past.length - 1];
    onSelectDay(target.date);
  };

  const fixtures = (data && data.fixtures) || [];

  return (
    <>
      <Navbar />
      <main className="page">
        <div className="container">
          <div className="dash-header">
            <div>
              <h1>Today’s Edge</h1>
              <div className="date-label">{dateLabel || 'MLS predictions'}</div>
            </div>
            <button type="button" className="btn btn-sm" onClick={onRefresh} disabled={loading || switching}>
              {switching ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          <CalendarStrip days={days} activeDate={activeDate} onSelect={onSelectDay} />

          {loading ? (
            <Loading label="Loading predictions…" />
          ) : error ? (
            <div className="empty-state">
              <h3>Couldn’t load predictions</h3>
              <p>{error}</p>
              <button type="button" className="btn" onClick={onRefresh} style={{ marginTop: 12 }}>
                Try again
              </button>
            </div>
          ) : fixtures.length === 0 ? (
            <div className="empty-state">
              <h3>No matches for {data && data.dateLabel ? data.dateLabel : 'this day'}</h3>
              <p>Pick a different day from the strip above.</p>
              <button type="button" className="btn" onClick={showRecent} style={{ marginTop: 12 }}>
                Show recent matches
              </button>
            </div>
          ) : (
            <div className="stack">
              {fixtures.map((f) => (
                <MatchCard key={f.id || f.fixtureId} fixture={f} />
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
