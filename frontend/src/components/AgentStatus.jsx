import { useEffect, useState } from 'react';
import agentApi from '../api/agent';

export default function AgentStatus() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const s = await agentApi.status();
        if (!cancelled) setStatus(s);
      } catch {
        if (!cancelled) setStatus({ status: 'OFFLINE' });
      }
    };
    load();
    const id = setInterval(load, 90 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!status) return null;
  const cls =
    status.status === 'ACTIVE' ? 'active'
    : status.status === 'LATE' ? 'late'
    : '';
  const label =
    status.status === 'ACTIVE' ? 'Agent active'
    : status.status === 'LATE' ? 'Agent late'
    : 'Agent offline';

  return (
    <span
      className={`agent-dot ${cls}`}
      title={`Last scan: ${status.lastScannerRun || '—'} · ${status.matchesMonitored || 0} matches monitored · ${status.alertsToday || 0} alerts today`}
    >
      <span className="dot" />
      <span>{label}</span>
    </span>
  );
}
