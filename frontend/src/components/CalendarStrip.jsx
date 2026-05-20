import { useEffect, useRef } from 'react';

// Horizontal scrollable calendar. `days` items look like:
// { date: 'YYYY-MM-DD', count, label, isToday, isPast }
export default function CalendarStrip({ days, activeDate, onSelect }) {
  const stripRef = useRef(null);
  const todayRef = useRef(null);

  // Centre today on mount (and whenever the days array shape changes).
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
    <div className="cs-strip" ref={stripRef} role="tablist" aria-label="Match calendar">
      {days.slice(0, 15).map((d) => {
        const isActive = activeDate === d.date;
        const empty = !d.count;
        const klass = [
          'cs-day',
          d.isToday ? 'today' : '',
          isActive && !d.isToday ? 'active' : '',
          empty ? 'empty' : '',
        ]
          .filter(Boolean)
          .join(' ');

        // Build weekday + day-of-month without timezone surprises.
        let weekday = '';
        let dayNum = '';
        try {
          const dt = new Date(`${d.date}T12:00:00Z`);
          weekday = dt.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
          dayNum = String(dt.getUTCDate());
        } catch {
          dayNum = d.date.slice(-2);
        }

        return (
          <button
            key={d.date}
            type="button"
            ref={d.isToday ? todayRef : undefined}
            className={klass}
            onClick={() => onSelect && onSelect(d.date)}
            role="tab"
            aria-selected={isActive || d.isToday}
            title={`${d.count || 0} matches on ${d.label || d.date}`}
          >
            <span className="day-name">{weekday}</span>
            <span className="day-num">{dayNum}</span>
            {d.count > 0 ? (
              <>
                <span className="day-count">{d.count}</span>
                <span className="day-dot" aria-hidden="true" />
              </>
            ) : (
              <span className="day-dot-placeholder" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}
