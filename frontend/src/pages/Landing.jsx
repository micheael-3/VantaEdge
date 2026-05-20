import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Landing.css';

// ============ Nav ============
function Nav({ openAppHref }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <Link to="/" className="lp-brand" aria-label="VantaEdge home">
            Vanta<span className="accent-dot">·</span>Edge
          </Link>

          <div className="lp-nav-links">
            <a href="#how">How It Works</a>
            <a href="#pricing">Pricing</a>
            <Link to="/blog">Blog</Link>
            <Link to="/affiliate">Affiliate</Link>
          </div>

          <div className="lp-nav-actions">
            <Link to="/login" className="lp-btn lp-btn-sm">Login</Link>
            <Link to={openAppHref} className="lp-btn lp-btn-sm lp-btn-primary">Start Free</Link>
          </div>

          <button
            type="button"
            className="lp-hamburger"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
        </div>
      </nav>

      {open && (
        <div className="lp-menu" role="dialog" aria-modal="true">
          <div className="lp-menu-top">
            <Link to="/" className="lp-brand" onClick={() => setOpen(false)}>
              Vanta<span className="accent-dot">·</span>Edge
            </Link>
            <button
              type="button"
              className="lp-menu-close"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
            >
              ✕
            </button>
          </div>
          <div className="lp-menu-links" onClick={() => setOpen(false)}>
            <a href="#top">Home</a>
            <a href="#how">How It Works</a>
            <a href="#pricing">Pricing</a>
            <Link to="/blog">Blog</Link>
            <Link to="/affiliate">Affiliate</Link>
          </div>
          <div className="lp-menu-actions">
            <Link to="/login" className="lp-btn lp-btn-block" onClick={() => setOpen(false)}>Login</Link>
            <Link to="/register" className="lp-btn lp-btn-primary lp-btn-block" onClick={() => setOpen(false)}>
              Start Free
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

// ============ Hero ============
function Hero() {
  return (
    <section className="lp-hero lp-container" id="top">
      <h1>
        Find Your <span className="accent">Edge</span> on Every Matchday
      </h1>
      <p className="lede">
        AI scores fixtures across MLS, Bundesliga, and Eredivisie — then helps you
        spot bets where the bookmaker has it wrong.
      </p>
      <div className="lp-hero-ctas">
        <Link to="/register" className="lp-btn lp-btn-primary lp-btn-block">Start Free</Link>
        <a href="#how" className="lp-btn lp-btn-block">How it works</a>
      </div>
      <div className="lp-hero-pills">
        <span className="lp-hero-pill">3 LEAGUES</span>
        <span className="lp-hero-pill">AI-POWERED</span>
        <span className="lp-hero-pill">FREE TO START</span>
      </div>
    </section>
  );
}

// ============ How It Works ============
function HowItWorks() {
  return (
    <section className="lp-section lp-container" id="how">
      <div className="lp-section-eyebrow">— How it works</div>
      <h2>Three steps. Then you bet your edge.</h2>
      <div className="lp-steps">
        <div className="lp-step">
          <div className="num">01</div>
          <h3>Pick a league</h3>
          <p>Choose MLS, Bundesliga, or Eredivisie — three high-scoring leagues with clear patterns.</p>
        </div>
        <div className="lp-step">
          <div className="num">02</div>
          <h3>AI scores fixtures</h3>
          <p>Form, rest days, and goals-per-game weighted by Claude AI into Over/Under and BTTS calls with confidence %.</p>
        </div>
        <div className="lp-step">
          <div className="num">03</div>
          <h3>Bet your edge</h3>
          <p>Type the bookmaker's odds and we tell you your edge and Kelly stake — instantly.</p>
        </div>
      </div>
    </section>
  );
}

// ============ Leagues ============
const LEAGUE_LIST = [
  { flag: '🇺🇸', name: 'MLS' },
  { flag: '🇩🇪', name: 'Bundesliga' },
  { flag: '🇳🇱', name: 'Eredivisie' },
];
function Leagues() {
  return (
    <section className="lp-section lp-container">
      <div className="lp-section-eyebrow">— Coverage</div>
      <h2>Three high-scoring leagues, every matchday.</h2>
      <div className="lp-leagues">
        {LEAGUE_LIST.map((l) => (
          <div key={l.name} className="lp-league">
            <span className="flag">{l.flag}</span>
            <span className="name">{l.name}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ============ Pricing ============
const PLANS = [
  {
    name: 'Free',
    price: '$0',
    suffix: '/ month',
    features: [
      '3 leagues (MLS, Bundesliga, Eredivisie)',
      'AI confidence + reasoning',
      'Daily predictions',
      'Form + rest day stats',
    ],
    cta: 'Start Free',
  },
  {
    name: 'Analyst',
    price: '$12.99',
    suffix: '/ month',
    features: [
      'Everything in Free',
      'EV calculator on every match card',
      'Kelly stake sizing',
      'Full prediction history + accuracy stats',
      'CSV export of bet log',
      'Priority support',
    ],
    cta: 'Get Analyst',
    featured: true,
  },
];
function Pricing() {
  return (
    <section className="lp-section lp-container" id="pricing">
      <div className="lp-section-eyebrow">— Pricing</div>
      <h2>Free to start. Upgrade when the edge pays for itself.</h2>
      <div className="lp-pricing">
        {PLANS.map((p) => (
          <div key={p.name} className={`lp-plan ${p.featured ? 'featured' : ''}`}>
            {p.featured && <span className="lp-plan-tag">Most Popular</span>}
            <h3>{p.name}</h3>
            <div className="lp-plan-price">
              {p.price} <small>{p.suffix}</small>
            </div>
            <ul>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
            <Link to="/register" className={`lp-btn ${p.featured ? 'lp-btn-primary' : ''} lp-btn-block`}>{p.cta}</Link>
          </div>
        ))}
      </div>
    </section>
  );
}

// ============ Footer ============
function Footer({ openAppHref }) {
  return (
    <footer className="lp-footer">
      <div className="lp-container">
        <div className="lp-footer-grid">
          <div className="lp-footer-brand">
            <Link to="/" className="lp-brand">
              Vanta<span className="accent-dot">·</span>Edge
            </Link>
            <p className="tagline">Statistical edge. Every matchday.</p>
          </div>
          <div className="lp-footer-col">
            <h5>Product</h5>
            <Link to={openAppHref}>Dashboard</Link>
            <Link to="/blog">Blog</Link>
          </div>
          <div className="lp-footer-col">
            <h5>Company</h5>
            <Link to="/affiliate">Affiliate</Link>
          </div>
          <div className="lp-footer-col">
            <h5>Legal</h5>
            <a href="#top">Responsible Gambling</a>
          </div>
        </div>
        <div className="lp-footer-bottom">
          <div className="disclaimer">
            Statistical analysis only. Not financial advice. 18+ Bet responsibly.
          </div>
          <div>© 2026 VantaEdge</div>
        </div>
      </div>
    </footer>
  );
}

// ============ Page ============
export default function Landing() {
  const { user } = useAuth();
  const openAppHref = user ? '/dashboard' : '/login';

  return (
    <div className="landing-page">
      <Nav openAppHref={openAppHref} />
      <Hero />
      <HowItWorks />
      <Leagues />
      <Pricing />
      <Footer openAppHref={openAppHref} />
    </div>
  );
}
