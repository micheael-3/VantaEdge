const LABELS = {
  STRONG_VALUE: { text: 'Strong Value', cls: 'green' },
  VALUE: { text: 'Value', cls: 'green' },
  MARGINAL: { text: 'Marginal', cls: 'yellow' },
  NO_VALUE: { text: 'No Value', cls: 'red' },
};

export default function EVBadge({ ev }) {
  if (!ev) return <span className="badge muted small">enter odds</span>;
  const meta = LABELS[ev.valueBadge] || LABELS.NO_VALUE;
  const edgeStr = ev.edge >= 0 ? `+${ev.edge}%` : `${ev.edge}%`;
  return (
    <span className={`badge ${meta.cls} mono`}>
      {meta.text} · {edgeStr}
    </span>
  );
}
