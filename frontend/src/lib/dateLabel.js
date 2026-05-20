// Produce a header label like "Today · Tuesday May 20" / "Past · Sunday May 18".
export function formatDateLabel(matchDate, isPast, isToday) {
  if (!matchDate) return '';
  let formatted = matchDate;
  try {
    const d = new Date(`${matchDate}T12:00:00Z`);
    formatted = d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    /* keep raw */
  }
  let prefix = 'Upcoming';
  if (isToday) prefix = 'Today';
  else if (isPast) prefix = 'Past';
  return `${prefix} · ${formatted}`;
}

// Kickoff time formatter: "MLS · Sat 09:30 PM"
export function formatKickoff(iso, league) {
  if (!iso) return league || '';
  try {
    const d = new Date(iso);
    const day = d.toLocaleDateString('en-US', { weekday: 'short' });
    const time = d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${league || 'MLS'} · ${day} ${time}`;
  } catch {
    return league || 'MLS';
  }
}
