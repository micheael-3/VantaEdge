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
        The Edge Bookmakers <span className="accent">Don't Want</span> You To Have
      </h1>
      <p className="lede">
        AI analyses team form, injuries, weather and odds across 8 leagues — then finds where
        bookmakers have mispriced the market. That gap is your profit.
      </p>
      <div className="lp-hero-ctas">
        <Link to="/register" className="lp-btn lp-btn-primary lp-btn-block">Start Free</Link>
        <a href="#pricing" className="lp-btn lp-btn-block">See Plans</a>
      </div>
      <div className="lp-hero-pills">
        <span className="lp-hero-pill">8 LEAGUES</span>
        <span className="lp-hero-pill">AI-POWERED</span>
        <span className="lp-hero-pill">LIVE ODDS</span>
      </div>
    </section>
  );
}

// ============ Marquee ============
function Marquee() {
  // Duplicate items so the loop is seamless.
  const items = [
    '847 value bets identified this month',
    '73% avg confidence on Strong Value picks',
    '8 leagues analysed every matchday',
    'Real bookmaker odds from 20+ books',
    'Auto +EV calculation',
    'Kelly stake sizing built in',
  ];
  const doubled = [...items, ...items];
  return (
    <div className="lp-marquee" aria-hidden="true">
      <div className="lp-marquee-track">
        {doubled.map((s, i) => (
          <span key={i} className="lp-marquee-item">{s}</span>
        ))}
      </div>
    </div>
  );
}

// ============ How It Works ============
function HowItWorks() {
  return (
    <section className="lp-section lp-container" id="how">
      <div className="lp-section-eyebrow">— How it works</div>
      <h2>Find the bets where the market is wrong.</h2>
      <div className="lp-steps">
        <div className="lp-step">
          <div className="num">01</div>
          <h3>Pick a league</h3>
          <p>Choose from 8 leagues with distinct scoring profiles and tactical patterns.</p>
        </div>
        <div className="lp-step">
          <div className="num">02</div>
          <h3>AI analyses the data</h3>
          <p>Form, injuries, xG, weather, referee tendency, head-to-head — all weighted by Claude AI.</p>
        </div>
        <div className="lp-step">
          <div className="num">03</div>
          <h3>Get your edge</h3>
          <p>See confidence %, EV against real bookmaker odds, and the Kelly stake to risk.</p>
        </div>
      </div>
    </section>
  );
}

// ============ Why It Works ============
function WhyItWorks() {
  return (
    <section className="lp-section lp-container">
      <div className="lp-section-eyebrow">— Why it works</div>
      <h2>Use the tools the professionals use.</h2>
      <div className="lp-why">
        <div className="lp-why-block">
          <h3>The problem</h3>
          <p>
            Bookmakers employ data scientists and AI to price every market perfectly. The average
            bettor uses gut feeling and league tables. That's why 97% lose long term.
          </p>
        </div>
        <div className="lp-why-block solution">
          <h3>The solution</h3>
          <p>
            VantaEdge pulls live stats, xG data, injury reports, weather and real odds — runs it
            through Claude AI — and tells you exactly where the market is mispriced. Same tools
            the professionals use.
          </p>
        </div>
      </div>
    </section>
  );
}

// ============ EV Example ============
function EVExample() {
  return (
    <section className="lp-section lp-container">
      <div className="lp-section-eyebrow" style={{ textAlign: 'center', justifyContent: 'center', display: 'flex' }}>
        — What +EV looks like
      </div>
      <h2 style={{ textAlign: 'center' }}>The math in practice.</h2>
      <div className="lp-ev-card">
        <h3>Premier League · Sat 15:00</h3>
        <div className="lp-ev-match">Dortmund vs Leverkusen</div>
        <div className="lp-ev-row"><span className="lbl">AI confidence</span><span className="val mint">74%</span></div>
        <div className="lp-ev-row"><span className="lbl">Bookmaker odds</span><span className="val">1.85 · Bet365</span></div>
        <div className="lp-ev-row"><span className="lbl">Implied probability</span><span className="val">54.1%</span></div>
        <div className="lp-ev-row"><span className="lbl">Your edge</span><span className="val mint">+19.9%</span></div>
        <div className="lp-ev-verdict">STRONG VALUE ✓</div>
      </div>
      <p className="lp-ev-footer">
        When this edge appears consistently across hundreds of bets — the math works in your favour.
      </p>
    </section>
  );
}

// ============ Leagues ============
const LEAGUE_LIST = [
  { flag: '🇺🇸', name: 'MLS' },
  { flag: '🇩🇪', name: 'Bundesliga' },
  { flag: '🇳🇱', name: 'Eredivisie' },
  { flag: '🏴', name: 'Championship' },
  { flag: '🇫🇷', name: 'Ligue 1' },
  { flag: '🏴', name: 'Scottish Prem' },
  { flag: '🇪🇸', name: 'La Liga' },
  { flag: '🏴', name: 'Premier League' },
];
function Leagues() {
  return (
    <section className="lp-section lp-container">
      <div className="lp-section-eyebrow">— Coverage</div>
      <h2>Eight leagues, every matchday.</h2>
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
    name: 'Scout',
    price: '£0',
    suffix: '/ month',
    features: ['3 core leagues', 'Daily AI analysis', 'Confidence scoring', 'Email digest'],
    cta: 'Start Free',
  },
  {
    name: 'Analyst',
    price: '£14',
    suffix: '/ month',
    features: ['All 8 leagues', 'Auto +EV from real odds', 'Kelly stake sizer', 'Bankroll tracker', '30-day history'],
    cta: 'Get Analyst',
    featured: true,
  },
  {
    name: 'Edge',
    price: '£39',
    suffix: '/ month',
    features: ['Everything in Analyst', 'Real-time alerts', 'CSV export', 'API access', 'Priority support'],
    cta: 'Get Edge',
  },
];
function Pricing() {
  return (
    <section className="lp-section lp-container" id="pricing">
      <div className="lp-section-eyebrow">— Pricing</div>
      <h2>One winning bet covers your subscription.</h2>
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
      <p className="lp-pricing-foot">Everything after that one hit is pure edge.</p>
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
      <Marquee />
      <HowItWorks />
      <WhyItWorks />
      <EVExample />
      <Leagues />
      <Pricing />
      <Footer openAppHref={openAppHref} />
    </div>
  );
}
