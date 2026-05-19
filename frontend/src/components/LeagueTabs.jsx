import { LEAGUES, canAccessLeague } from '../config/leagues';

export default function LeagueTabs({ userTier, activeLeague, onSelect, onLocked }) {
  return (
    <div className="league-tabs">
      {LEAGUES.map((lg) => {
        const accessible = canAccessLeague(userTier, lg.minTier);
        const isActive = activeLeague === lg.id;
        const className = [
          'tab',
          isActive ? 'active' : '',
          !accessible ? 'locked' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <button
            key={lg.id}
            className={className}
            onClick={() => (accessible ? onSelect(lg.id) : onLocked(lg.minTier))}
            title={accessible ? lg.name : `${lg.minTier} required`}
          >
            <span>{lg.flag}</span>
            <span>{lg.name}</span>
            {!accessible && <span className="mono small">🔒</span>}
          </button>
        );
      })}
    </div>
  );
}
