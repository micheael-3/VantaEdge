import { useEffect, useRef } from 'react';
import './CalendarStrip.css';

// Horizontal scrollable date strip — replaces the older dp-date-pills row.
// Props:
//   days       — array of { date, count, isToday, isPast, label }
//   activeDate — currently selected YYYY-MM-DD (null = no explicit pin)
//   onSelect   — (date) => void
//   loading    — boolean (reserved for future skeleton variant)
export default function CalendarStrip({ days, activeDate, onSelect, loading }) {
  const stripRef = useRef(null);
  const todayRef = useRef(null);
  void loading; // reserved — we keep the prop in the signature for future use.

  // On mount (and whenever `days` changes shape) centre the today pill in
  // the viewport. Past pills end up on the left, future pills on the right.
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
        const empty = !d.count || d.count === 0;
        const klass = [
          'cs-day',
          d.isToday ? 'today' : '',
          isActive && !d.isToday ? 'active' : '',
          empty ? 'empty' : '',
          d.isPast && !d.isToday ? 'past' : '',
        ].filter(Boolean).join(' ');

        // Parse weekday + day-of-month off the YYYY-MM-DD without timezone surprises.
        let weekday = '';
        let dayNum = '';
        try {
          const dt = new Date(`${d.date}T12:00:00Z`);
          weekday = dt.toLocaleDateString(undefined, { weekday: 'short' });
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
            title={`${d.count == null ? '?' : d.count} matches on ${d.label || d.date}`}
          >
            {d.count != null && d.count > 0 && (
              <span className="day-count">{d.count}</span>
            )}
            <span className="day-name">{weekday}</span>
            <span className="day-num">{dayNum}</span>
            {!empty ? (
              <span className="day-dot" aria-hidden="true" />
            ) : (
              <span style={{ width: 5, height: 5 }} aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}
