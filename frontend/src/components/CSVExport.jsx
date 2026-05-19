function escape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportToCSV(predictions, filename) {
  const headers = [
    'Date',
    'League',
    'Home',
    'Away',
    'Kickoff',
    'Over Line',
    'Over Confidence',
    'BTTS',
    'BTTS Confidence',
    'EV Over',
    'EV BTTS',
    'Kelly Over',
    'Kelly BTTS',
  ];
  const rows = predictions.map((p) => [
    new Date().toISOString().slice(0, 10),
    p.league,
    p.home && p.home.name,
    p.away && p.away.name,
    p.kickoff,
    p.predictions && p.predictions.over ? p.predictions.over.line : '',
    p.predictions && p.predictions.over ? p.predictions.over.confidence : '',
    p.predictions && p.predictions.btts ? p.predictions.btts.prediction : '',
    p.predictions && p.predictions.btts ? p.predictions.btts.confidence : '',
    p.ev && p.ev.over ? p.ev.over.edge : '',
    p.ev && p.ev.btts ? p.ev.btts.edge : '',
    p.ev && p.ev.kellyOver != null ? p.ev.kellyOver : '',
    p.ev && p.ev.kellyBtts != null ? p.ev.kellyBtts : '',
  ]);
  const csv = [headers, ...rows].map((r) => r.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = filename || `vantaedge-picks-${date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function CSVExport({ matches }) {
  const handleClick = () => exportToCSV(matches || []);
  return (
    <button className="btn btn-ghost" onClick={handleClick} title="Export to CSV" aria-label="Export to CSV">
      ⬇ CSV
    </button>
  );
}
