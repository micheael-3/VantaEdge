import { useEffect, useRef } from 'react';

// 11+ day pill strip. Each pill: 64px wide, weekday (9px mono) above
// day-of-month (20px Syne) above a 4px dot (mint = has matches).
// Selected pill: rgba(110,231,183,0.08) bg + mint border.
//
// Accepts the backend shape from /api/predictions/upcoming/253:
//   days: [{ date: 'YYYY-MM-DD', count, label, isToday, isPast }]
export default function CalendarStrip({ days, activeDate, onSelect }) {
  const stripRef = useRef(null);
  const todayRef = useRef(null);

  // Centre today on mount.
  useEffect(() => {
    const strip = stripRef.current;
    const today = todayRef.current;
    if (!strip || !today) return;
    const left = today.offsetLeft - strip.clientWidth / 2 + today.clientWidth / 2;
    strip.scrollLeft = Math.max(0, left);
  }, [days]);

  if (!Array.isArray(days) || days.length === 0) {
    return <div className="cs-strip" aria-label="Match calendar" />;
  }

  return (
    <div
      ref={stripRef}
      className="cs-strip"
      role="tablist"
      aria-label="Match calendar"
    >
      {days.slice(0, 15).map((d) => {
        const isActive = activeDate === d.date;
        const sel = isActive || (!activeDate && d.isToday);
        const hasMatches = (d.count || 0) > 0;
        let weekday = '';
        let dayNum = '';
        try {
          const dt = new Date(`${d.date}T12:00:00Z`);
          weekday = dt
            .toLocaleDateString('en-US', { weekday: 'short' })
            .toUpperCase();
          dayNum = String(dt.getUTCDate());
        } catch {
          dayNum = (d.date || '').slice(-2);
        }
        return (
          <button
            key={d.date}
            type="button"
            ref={d.isToday ? todayRef : undefined}
            onClick={() => onSelect && onSelect(d.date)}
            role="tab"
            aria-selected={sel}
            title={`${d.count || 0} matches on ${d.label || d.date}`}
            style={{
              flexShrink: 0,
              width: 64,
              padding: '10px 8px',
              border:
                '1px solid ' +
                (sel
                  ? 'rgba(110,231,183,0.35)'
                  : 'var(--border-soft)'),
              background: sel
                ? 'rgba(110,231,183,0.08)'
                : d.isToday
                ? 'var(--card)'
                : 'transparent',
              borderRadius: 10,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              transition: 'all 0.15s',
              cursor: 'pointer',
            }}
          >
            <span
              className="mono"
              style={{
                fontSize: 9,
                letterSpacing: '0.08em',
                color: sel
                  ? 'var(--mint)'
                  : d.isToday
                  ? 'var(--text)'
                  : 'var(--text-3)',
                whiteSpace: 'nowrap',
              }}
            >
              {weekday}
              {d.isToday ? ' · TODAY' : ''}
            </span>
            <span
              className="display"
              style={{
                fontSize: 20,
                fontWeight: 600,
                color: sel || d.isToday ? 'var(--text)' : 'var(--text-2)',
              }}
            >
              {dayNum}
            </span>
            <span
              style={{
                width: 4,
                height: 4,
                borderRadius: '50%',
                background: hasMatches
                  ? sel
                    ? 'var(--mint)'
                    : 'var(--text-3)'
                  : 'transparent',
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
