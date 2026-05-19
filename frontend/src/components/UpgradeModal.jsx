import { PLANS } from '../config/leagues';

export default function UpgradeModal({ open, requiredTier, onClose }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2>Upgrade your plan</h2>
        {requiredTier && (
          <div className="muted small mono">This feature requires {requiredTier} or higher.</div>
        )}
        <div className="pricing-grid">
          {PLANS.map((plan) => (
            <div key={plan.id} className={`plan ${plan.popular ? 'popular' : ''}`}>
              <div className="spread">
                <h3>{plan.name}</h3>
                {plan.popular && <span className="badge accent small">Most Popular</span>}
              </div>
              <div className="plan-price">
                {plan.price}
                <small>{plan.period}</small>
              </div>
              <ul className="plan-features">
                {plan.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <a href="#" className="btn btn-primary" style={{ marginTop: 'auto' }}>
                Subscribe
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
