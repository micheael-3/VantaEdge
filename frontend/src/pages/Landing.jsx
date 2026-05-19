import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { PLANS } from '../config/leagues';

export default function Landing() {
  return (
    <>
      <Navbar />
      <section className="hero container">
        <h1>Statistical Edge. Every Matchday.</h1>
        <p>
          AI-powered football goals predictions across MLS, Bundesliga, Eredivisie, Championship, Ligue 1,
          Scottish Premiership, La Liga, and the Premier League. +EV calculator, Kelly stakes, and full
          accuracy tracking.
        </p>
        <div className="hero-actions">
          <Link to="/register" className="btn btn-primary">
            Start Free
          </Link>
          <a href="#pricing" className="btn">
            See Plans
          </a>
        </div>
      </section>

      <section className="section container">
        <h2>How it works</h2>
        <div className="steps">
          <div className="card">
            <div className="step-num mono">01</div>
            <h3>Pick a league</h3>
            <p className="muted">Choose from 8 leagues with distinct scoring profiles and tactics.</p>
          </div>
          <div className="card">
            <div className="step-num mono">02</div>
            <h3>AI analyses stats</h3>
            <p className="muted">Form, rest days, H2H, team stats — Claude builds a goals model per match.</p>
          </div>
          <div className="card">
            <div className="step-num mono">03</div>
            <h3>Get +EV picks</h3>
            <p className="muted">Compare to odds, see expected value, get Kelly stake suggestions.</p>
          </div>
        </div>
      </section>

      <section className="section container">
        <h2>What you get</h2>
        <div className="feature-grid">
          <div className="card">
            <h3>AI Analysis</h3>
            <p className="muted small">Claude-powered per-match analysis with statistical reasoning.</p>
          </div>
          <div className="card">
            <h3>+EV Calculator</h3>
            <p className="muted small">Live expected value vs. your bookie's price.</p>
          </div>
          <div className="card">
            <h3>Multi-league</h3>
            <p className="muted small">8 leagues with league-specific tendencies modelled.</p>
          </div>
          <div className="card">
            <h3>Accuracy tracking</h3>
            <p className="muted small">Rolling hit-rate, league breakdowns, and CSV export.</p>
          </div>
        </div>
      </section>

      <section id="pricing" className="section container">
        <h2>Pricing</h2>
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
              <Link to="/register" className="btn btn-primary" style={{ marginTop: 'auto' }}>
                Subscribe
              </Link>
            </div>
          ))}
        </div>
      </section>

      <footer className="footer container">
        <div>© VantaEdge 2025</div>
        <div className="row" style={{ gap: 16 }}>
          <Link to="/login">Login</Link>
          <Link to="/register">Register</Link>
        </div>
      </footer>
    </>
  );
}
