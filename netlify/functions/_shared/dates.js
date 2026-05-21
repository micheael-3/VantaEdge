// Cyprus-local date helpers. Every place in the codebase that needed to
// compute "today" or "the Monday of this week" used to do UTC math via
// getUTCFullYear / getUTCDay, which is wrong for an Asia/Nicosia user.
//
// Concrete failure mode that drove this file: a 2:30 AM Sunday kickoff
// in Cyprus is 23:30 UTC on Saturday. The /week endpoint was bucketing
// it under Saturday (UTC date of the ISO), so the dashboard's Sunday
// pill came up empty and the Saturday pill showed a "ghost" match.
//
// Everything in here returns YYYY-MM-DD strings in Asia/Nicosia. The
// Intl.DateTimeFormat path is the only reliable way to get a TZ-shifted
// calendar date from Node 18+ — manual UTC offset math breaks across DST.

const CYPRUS_TZ = 'Asia/Nicosia';

// Return the Asia/Nicosia calendar date (YYYY-MM-DD) for either a Date
// object or anything Date can parse (ISO string, ms timestamp). Returns
// null on bad input rather than throwing — callers usually want to
// skip bad rows, not crash.
function cyprusDateStr(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA gives YYYY-MM-DD natively — saves us reformatting parts.
  return d.toLocaleDateString('en-CA', { timeZone: CYPRUS_TZ });
}

// Day-of-week (0=Sun … 6=Sat) for the given input in Asia/Nicosia.
function cyprusDayOfWeek(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const wd = d.toLocaleDateString('en-US', { timeZone: CYPRUS_TZ, weekday: 'short' });
  // Map "Sun"…"Sat" → 0…6
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd] ?? null;
}

// Return YYYY-MM-DD for the Monday of the Asia/Nicosia week that contains
// `input`. ISO week semantics: Monday is the first day, Sunday is day 7.
function cyprusMonday(input) {
  const day = cyprusDayOfWeek(input);
  if (day == null) return null;
  // Sun (0) → step back 6, Mon (1) → step back 0, Tue (2) → 1, etc.
  const stepBack = day === 0 ? 6 : day - 1;
  const todayStr = cyprusDateStr(input);
  if (!todayStr) return null;
  return addDaysStr(todayStr, -stepBack);
}

// Add `n` days (can be negative) to a YYYY-MM-DD string. We anchor at
// UTC noon for the math so a DST transition can't accidentally shift
// the date by one — noon is at least 11 hours from any DST boundary
// in any timezone, so the integer day always advances cleanly.
function addDaysStr(baseDateStr, n) {
  if (typeof baseDateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(baseDateStr)) {
    return null;
  }
  const d = new Date(`${baseDateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// Pretty kickoff time in Asia/Nicosia, e.g. "21:30". Frontend already
// renders via toLocaleTimeString, so this is mainly for backend logs.
function cyprusTimeStr(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-GB', {
    timeZone: CYPRUS_TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
}

module.exports = {
  CYPRUS_TZ,
  cyprusDateStr,
  cyprusDayOfWeek,
  cyprusMonday,
  cyprusTimeStr,
  addDaysStr,
};
