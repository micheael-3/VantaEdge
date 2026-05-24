import { useEffect, useRef } from 'react';

// 10-pill horizontal calendar strip: 3 past + today + 6 ahead.
// Each pill: 64px wide, weekday (9px mono) above day-of-month (20px Syne)
// above a 4px dot. Auto-scrolls to centre today on mount.
//
// State visual treatment (spec: mobile UI polish round):
//   - selected            → mint border + mint-tinted fill, mint text/dot
//   - today (unselected)  → solid card bg, mint text + mint dot
//   - past (clickable)    → muted opacity, grey text
//   - future no matches   → grey text, no dot
//   - future has matches  → muted grey dot accent below date
//
// Accepts:
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
      {days.map((d) => {
        const isActive = activeDate === d.date;
        const isToday = !!d.isToday;
        const isPast = !!d.isPast;
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

        // Background / border state machine.
        const background = isActive
          ? 'rgba(110,231,183,0.10)'
          : isToday
            ? 'rgba(110,231,183,0.04)'
            : 'transparent';
        const borderColor = isActive
          ? 'rgba(110,231,183,0.5)'
          : isToday
            ? 'rgba(110,231,183,0.35)'
            : 'var(--border-soft)';

        // Text colours.
        const weekdayColor = isActive || isToday
          ? 'var(--mint)'
          : isPast
            ? 'var(--text-faint)'
            : 'var(--text-3)';
        const dayNumColor = isActive || isToday
          ? 'var(--text)'
          : isPast
            ? 'var(--text-3)'
            : 'var(--text-2)';

        // Dot colour: mint on today/active when matches exist, grey when
        // matches exist on any other day, transparent placeholder when none.
        const dotBg = hasMatches
          ? isActive || isToday
            ? 'var(--mint)'
            : 'var(--text-faint)'
          : 'transparent';

        return (
          <button
            key={d.date}
            type="button"
            ref={isToday ? todayRef : undefined}
            onClick={() => onSelect && onSelect(d.date)}
            role="tab"
            aria-selected={isActive}
            title={`${d.count || 0} matches on ${d.label || d.date}`}
            style={{
              flexShrink: 0,
              width: 64,
              padding: '10px 8px',
              border: `1px solid ${borderColor}`,
              background,
              borderRadius: 10,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              transition: 'all 0.15s',
              cursor: 'pointer',
              opacity: isPast && !isActive ? 0.65 : 1,
            }}
          >
            <span
              className="mono"
              style={{
                fontSize: 9,
                letterSpacing: '0.08em',
                color: weekdayColor,
                whiteSpace: 'nowrap',
              }}
            >
              {weekday}
            </span>
            <span
              className="display"
              style={{
                fontSize: 20,
                fontWeight: 600,
                color: dayNumColor,
                lineHeight: 1,
              }}
            >
              {dayNum}
            </span>
            <span
              style={{
                width: 4,
                height: 4,
                borderRadius: '50%',
                background: dotBg,
              }}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}
