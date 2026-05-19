export default function FormDots({ form }) {
  const items = Array.isArray(form) ? form.slice(-5) : [];
  return (
    <span className="form-dots" aria-label="Recent form">
      {items.map((r, i) => {
        const cls = r === 'W' ? 'w' : r === 'L' ? 'l' : 'd';
        return <span key={i} className={`form-dot ${cls}`} title={r} />;
      })}
      {items.length === 0 && <span className="mono small muted">no form</span>}
    </span>
  );
}
