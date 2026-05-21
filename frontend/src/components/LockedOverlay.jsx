import Icon from './Icon.jsx';

// Reusable lock-pill overlay used to gate FREE-tier paywalls.
// Place inside a `position: relative` container; this component
// is absolutely positioned via the .locked-overlay class.
export default function LockedOverlay({ onClick, label = 'Unlock with PRO', radius = 8 }) {
  return (
    <div className="locked-overlay" onClick={onClick} style={{ borderRadius: radius }}>
      <span className="lock-pill">
        <Icon name="lock" size={12} /> {label}
      </span>
    </div>
  );
}
