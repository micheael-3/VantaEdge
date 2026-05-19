export default function TierGate({ requiredTier, onUpgrade, children }) {
  return (
    <div className="tier-gate-wrap">
      <div className="tier-gate-content">{children}</div>
      <div className="tier-gate-overlay">
        <div className="lock-icon" aria-hidden>🔒</div>
        <div className="mono small">{requiredTier} Plan Required</div>
        <button className="btn btn-primary" onClick={onUpgrade}>
          Upgrade
        </button>
      </div>
    </div>
  );
}
