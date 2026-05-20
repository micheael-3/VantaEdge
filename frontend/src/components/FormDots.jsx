// Form is an array like ['W','L','D','W','D']. Anything not W/L/D renders as a neutral dot.
export default function FormDots({ form }) {
  const items = Array.isArray(form) ? form.slice(0, 5) : [];
  return (
    <span className="form-dots" aria-label="Recent form">
      {items.map((r, i) => {
        const code = (r || '').toString().toUpperCase();
        const cls = ['W', 'L', 'D'].includes(code) ? code : '';
        return (
          <span key={i} className={`form-dot ${cls}`} title={code || '?'}>
            {code || '·'}
          </span>
        );
      })}
    </span>
  );
}
