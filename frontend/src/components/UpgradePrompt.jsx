import { Link } from 'react-router-dom';

export default function UpgradePrompt() {
  return (
    <div className="ev-upgrade">
      <Link to="/settings">Upgrade to Sharp to see EV →</Link>
    </div>
  );
}
