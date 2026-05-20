import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import affiliateApi from '../api/affiliate';

const COMMISSION = { SCOUT: 1.5, ANALYST: 5.2, EDGE: 10.0 };
// 50/30/20 mix used as the default scenario for the calculator.
const DEFAULT_MIX = { SCOUT: 0.5, ANALYST: 0.3, EDGE: 0.2 };

function avgCommission(mix) {
  return mix.SCOUT * COMMISSION.SCOUT + mix.ANALYST * COMMISSION.ANALYST + mix.EDGE * COMMISSION.EDGE;
}

function fmtMoney(n) {
  return `$${n.toFixed(2)}`;
}

export default function Affiliate() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [refCount, setRefCount] = useState(25);
  const [leaders, setLeaders] = useState([]);
  const [leadersLoading, setLeadersLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await affiliateApi.leaderboard();
        setLeaders(data.leaders || []);
      } catch {
        // Public endpoint — if it fails, just hide the section.
      } finally {
        setLeadersLoading(false);
      }
    })();
  }, []);

  const avg = useMemo(() => avgCommission(DEFAULT_MIX), []);
  const monthly = refCount * avg;
  const annual = monthly * 12;

  const handleCTA = () => {
    if (user) navigate('/affiliate/dashboard');
    else navigate('/register');
  };

  return (
    <>
      <Navbar />
      <section className="hero container">
        <h1>Earn Up To 40% Recurring Commission</h1>
        <p>
          Refer bettors to VantaEdge and earn every single month they stay subscribed. No cap.
          No expiry. Real recurring income.
        </p>
        <div className="hero-actions">
          <button className="btn btn-primary" onClick={handleCTA}>
            Become An Affiliate
          </button>
          <a href="#calculator" className="btn">
            See How Much You Could Earn
          </a>
        </div>
      </section>

      <section className="section container">
        <h2>How it works</h2>
        <div className="steps">
          <div className="card">
            <div className="step-num mono">01</div>
            <h3>Share your link</h3>
            <p className="muted">
              Get a unique referral link from your dashboard. Post it anywhere — Twitter, Reddit,
              your Discord, your blog.
            </p>
          </div>
          <div className="card">
            <div className="step-num mono">02</div>
            <h3>They subscribe</h3>
            <p className="muted">
              Anyone who signs up through your link and picks a paid plan is tied to you for life.
            </p>
          </div>
          <div className="card">
            <div className="step-num mono">03</div>
            <h3>You earn every month</h3>
            <p className="muted">
              You get a slice of the monthly subscription for as long as they stay subscribed.
              Cancel? You stop earning on that one. Resubscribe? You start earning again.
            </p>
          </div>
        </div>
      </section>

      <section className="section container">
        <h2>Commission rates</h2>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="history-table">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Price</th>
                <th>Your cut</th>
                <th>Monthly per referral</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Scout</td>
                <td>$4.99</td>
                <td>30%</td>
                <td>$1.50</td>
              </tr>
              <tr>
                <td>Analyst</td>
                <td>$12.99</td>
                <td>40%</td>
                <td>$5.20</td>
              </tr>
              <tr>
                <td>Edge</td>
                <td>$24.99</td>
                <td>40%</td>
                <td>$10.00</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="calculator" className="section container">
        <h2>Earnings calculator</h2>
        <div className="card">
          <div className="stack">
            <div className="spread">
              <label className="label" htmlFor="ref-slider">
                Active referrals
              </label>
              <span className="mono">{refCount}</span>
            </div>
            <input
              id="ref-slider"
              type="range"
              min="1"
              max="200"
              step="1"
              value={refCount}
              onChange={(e) => setRefCount(parseInt(e.target.value, 10))}
              style={{ width: '100%' }}
            />
            <div className="muted small mono">
              Assumes a 50% Scout / 30% Analyst / 20% Edge mix · avg {fmtMoney(avg)} per referral / month
            </div>
            <div className="kpi-grid" style={{ marginTop: 16 }}>
              <div className="kpi">
                <div className="label">Monthly</div>
                <div className="value">{fmtMoney(monthly)}</div>
              </div>
              <div className="kpi">
                <div className="label">Annual</div>
                <div className="value">{fmtMoney(annual)}</div>
              </div>
              <div className="kpi">
                <div className="label">Per referral / mo</div>
                <div className="value">{fmtMoney(avg)}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section container">
        <h2>Top affiliates</h2>
        {leadersLoading ? (
          <div className="card">Loading…</div>
        ) : leaders.length === 0 ? (
          <div className="card muted">No affiliates on the board yet — be the first.</div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="history-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Affiliate</th>
                  <th>Active referrals</th>
                  <th>Lifetime earned</th>
                </tr>
              </thead>
              <tbody>
                {leaders.map((l, i) => (
                  <tr key={l.code}>
                    <td>#{i + 1}</td>
                    <td className="mono">{l.code}</td>
                    <td>{l.activeReferrals}</td>
                    <td>{fmtMoney(l.lifetimePayout)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section container" style={{ textAlign: 'center' }}>
        <h2>Ready to start earning?</h2>
        <p className="muted" style={{ maxWidth: 540, margin: '0 auto 24px' }}>
          {user
            ? 'You’re logged in — claim your affiliate link in one click.'
            : 'Free account, free affiliate program. Sign up and start sharing in under a minute.'}
        </p>
        <button className="btn btn-primary" onClick={handleCTA}>
          {user ? 'Open Affiliate Dashboard' : 'Become An Affiliate'}
        </button>
      </section>

      <footer className="footer container">
        <div>© VantaEdge 2025</div>
        <div className="row" style={{ gap: 16 }}>
          <Link to="/affiliate">Affiliates</Link>
          <Link to="/login">Login</Link>
          <Link to="/register">Register</Link>
        </div>
      </footer>
    </>
  );
}
