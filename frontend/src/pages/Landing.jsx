import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Landing.css';

// ============ Hooks ============
function useCounter(target, duration = 1800, startOn = true) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!startOn) return;
    let raf;
    const start = performance.now();
    const tick = (t) => {
      const p = Math.min((t - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, startOn]);
  return value;
}

function useInView(ref, threshold = 0.2) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [ref, threshold]);
  return seen;
}

// ============ Bits ============
function Brand() {
  return (
    <span className="lp-brand">
      Vanta<span className="accent-dot">·</span>Edge
    </span>
  );
}

function HeroNum({ value, suffix = '' }) {
  const n = useCounter(value, 1800);
  return (
    <>
      {Math.round(n).toLocaleString()}
      {suffix}
    </>
  );
}

// ============ Sections ============
function Nav({ openAppHref }) {
  return (
    <nav className="lp-nav">
      <div className="lp-container lp-nav-inner">
        <Link to="/" aria-label="VantaEdge home">
          <Brand />
        </Link>
        <div className="lp-nav-links">
          <a href="#why">Why</a>
          <a href="#how">How It Works</a>
          <a href="#leagues">Leagues</a>
          <a href="#pricing">Pricing</a>
        </div>
        <div className="lp-nav-actions">
          <Link className="lp-btn lp-btn-ghost lp-btn-sm lp-hidden-md" to="/login">
            Login
          </Link>
          <Link className="lp-btn lp-btn-primary lp-btn-sm" to={openAppHref}>
            Open App
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="lp-hero lp-container">
      <div className="lp-hero-inner">
        <div className="lp-eyebrow">
          <span className="dot" />
          <span>Live · 8 leagues · matchday analysis</span>
        </div>
        <h1 style={{ fontSize: 'clamp(30px, 5.2vw, 68px)' }}>
          The Edge
          <br />
          Bookmakers <span className="accent">Don't Want</span>
          <br />
          You To Have.
        </h1>
        <p className="lede">
          VantaEdge uses AI to analyse team form, rest days, head-to-head data and expected goals
          across 8 leagues — then calculates exactly where the bookmaker's odds are mispriced. That
          gap is your profit.
        </p>
        <div className="lp-hero-ctas">
          <Link className="lp-btn lp-btn-primary lp-btn-lg" to="/register">
            Start For Free
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </Link>
          <a className="lp-btn lp-btn-lg" href="#how">
            See How It Works
          </a>
        </div>

        <div className="lp-hero-footnote">
          <span className="lp-mono">No card required</span>
          <span className="sep">·</span>
          <span className="lp-mono">Cancel anytime</span>
          <span className="sep">·</span>
          <span className="lp-mono">7-day Edge trial</span>
        </div>

        <div className="lp-hero-stats">
          <div className="lp-hero-stat">
            <span className="num">
              <HeroNum value={847} />
            </span>
            <span className="lbl">Value bets identified this month</span>
          </div>
          <div className="lp-hero-stat">
            <span className="num">
              <HeroNum value={73} suffix="%" />
            </span>
            <span className="lbl">Avg confidence on Strong Value picks</span>
          </div>
          <div className="lp-hero-stat">
            <span className="num">
              <HeroNum value={8} />
            </span>
            <span className="lbl">Leagues analysed every matchday</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function WhySection() {
  const cols = [
    {
      idx: '01 / PROBLEM',
      title: 'Bookmakers Have The Edge',
      body:
        "Bookmakers employ teams of analysts, data scientists and AI to price every market. The average bettor is making decisions based on gut feeling and league tables. That's why 97% of bettors lose long term. The house always wins — unless you have better data.",
      tintVar: 'var(--lp-red)',
      glyph: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 3v18h18" />
          <path d="M19 17l-5-5-3 3-4-4" />
        </svg>
      ),
    },
    {
      idx: '02 / SOLUTION',
      title: 'AI That Works For You',
      body:
        'VantaEdge pulls live team statistics, analyses last 5 home and away results, calculates expected goals, factors in rest days and head-to-head history — then runs it through Claude AI to determine the statistically justified outcome. In seconds, for every match, every day.',
      tintVar: 'var(--lp-indigo)',
      glyph: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
        </svg>
      ),
    },
    {
      idx: '03 / RESULT',
      title: 'Find Mispriced Odds',
      body:
        "When our AI gives a match 74% confidence and the bookmaker's odds imply 52% — that's a 22% edge in your favour. Bet that edge consistently across enough matches and the math works in your favour. This is how professional bettors operate. Now you have the same tools.",
      tintVar: 'var(--lp-mint)',
      glyph: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 2L4 7v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V7l-8-5z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      ),
    },
  ];

  return (
    <section className="lp-section" id="why">
      <div className="lp-container">
        <div className="lp-section-eyebrow">— Why VantaEdge</div>
        <div className="lp-section-head">
          <h2 className="lp-heading">
            Betting without data is gambling.
            <br />
            <span style={{ color: 'var(--lp-mint)' }}>Betting with VantaEdge is different.</span>
          </h2>
        </div>

        <div className="lp-three-col">
          {cols.map((c) => (
            <div key={c.idx} className="lp-feature-card">
              <div className="idx">{c.idx}</div>
              <div className="glyph" style={{ color: c.tintVar }}>
                {c.glyph}
              </div>
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function EVSection() {
  const ref = useRef(null);
  const inView = useInView(ref);
  const conf = useCounter(74, 1400, inView);
  const implied = useCounter(54.1, 1400, inView);
  const edge = useCounter(19.9, 1600, inView);
  const profit = useCounter(199, 1800, inView);

  return (
    <section className="lp-section" id="how" ref={ref}>
      <div className="lp-container">
        <div className="lp-section-eyebrow">— How EV works</div>
        <div className="lp-section-head">
          <h2 className="lp-heading">
            What is +EV betting and
            <br />
            why does it make you money?
          </h2>
        </div>

        <div className="lp-ev-grid">
          <div className="lp-ev-explainer">
            <p>
              <strong style={{ color: 'var(--lp-text)' }}>Expected Value (EV)</strong> is the
              mathematical edge you have on any bet. A positive EV bet means the true probability of
              an outcome is higher than what the bookmaker's odds imply.
            </p>
            <p>
              Over hundreds of bets, positive EV betting is the only mathematically proven strategy
              that beats the bookmaker long term.
            </p>
            <p
              style={{
                color: 'var(--lp-mint)',
                fontFamily: 'DM Mono, monospace',
                fontSize: '13px',
                marginTop: 24,
                letterSpacing: '0.04em',
              }}
            >
              CONFIDENCE − IMPLIED PROBABILITY = YOUR EDGE
            </p>

            <div className="lp-ev-pillrow">
              <div className="lp-ev-pill-mini">
                <span className="lbl lp-mono">Sample size</span>
                <span className="val lp-mono">100 bets</span>
              </div>
              <div className="lp-ev-pill-mini">
                <span className="lbl lp-mono">Stake</span>
                <span className="val lp-mono">£10</span>
              </div>
              <div className="lp-ev-pill-mini">
                <span className="lbl lp-mono">Expected profit</span>
                <span className="val lp-mono mint">+£{Math.round(profit)}</span>
              </div>
            </div>
          </div>

          <div className="lp-ev-card lp-card-glow-mint">
            <div className="lp-ev-card-head">
              <div>
                <div className="league">PREMIER LEAGUE · SAT 15:00</div>
                <div className="teams">Brighton vs Aston Villa</div>
              </div>
              <div className="lp-bet-badge">OVER 2.5</div>
            </div>

            <div className="lp-ev-row">
              <span className="lbl">AI Confidence</span>
              <span className="val mint">{conf.toFixed(0)}%</span>
            </div>
            <div className="lp-ev-bar-wrap">
              <div className="lp-ev-bar-fill" style={{ width: `${conf}%` }} />
            </div>

            <div className="lp-ev-row">
              <span className="lbl">Bookmaker Odds</span>
              <span className="val">1.85</span>
            </div>
            <div className="lp-ev-row">
              <span className="lbl">Implied Probability</span>
              <span className="val">{implied.toFixed(1)}%</span>
            </div>
            <div className="lp-ev-row">
              <span className="lbl">Your Edge</span>
              <span className="val mint">+{edge.toFixed(1)}%</span>
            </div>

            <div className="lp-verdict">
              <div className="lp-verdict-top">
                <span className="lp-verdict-label">Verdict</span>
                <span className="lp-verdict-val">STRONG VALUE ✓</span>
              </div>
              <div className="lp-verdict-sub">
                100 bets × £10 at these odds → expected return <strong>+£{Math.round(profit)}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SocialProof() {
  const stats = [
    { val: '8', label: 'Leagues — analysed every matchday', mint: true },
    { val: '5', label: 'Data points per team per match minimum' },
    { val: 'Real-Time', label: 'Odds comparison & EV calculation' },
    { val: '100%', label: 'Statistical — zero gut feeling', mint: true },
  ];
  return (
    <section className="lp-section-tight">
      <div className="lp-container">
        <div className="lp-section-eyebrow">— Proof</div>
        <div className="lp-section-head">
          <h2 className="lp-heading">
            Built on real data.
            <br />
            Proven by the numbers.
          </h2>
        </div>
        <div className="lp-stats-row">
          {stats.map((s) => (
            <div key={s.label} className="lp-stat-card">
              <div className={`val lp-mono ${s.mint ? 'mint' : ''}`}>{s.val}</div>
              <div className="label">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function LeaguesSection() {
  const leagues = [
    { flag: '🇺🇸', name: 'MLS', stat: '3.1 avg goals/game. Highest variance in professional football.', badge: 'HIGH O/U' },
    { flag: '🇩🇪', name: 'Bundesliga', stat: 'High-press style produces 2.9 avg goals. Most predictable in Europe.', badge: 'CORE' },
    { flag: '🇳🇱', name: 'Eredivisie', stat: "Europe's highest scoring league. Average 3.2 goals per game.", badge: 'TOP GOALS' },
    { flag: '🏴', name: 'Championship', stat: '46-game season. Fatigue creates late-season scoring patterns.', badge: 'CORE' },
    { flag: '🇫🇷', name: 'Ligue 1', stat: 'Open mid-table football. Strong BTTS rates outside top 3.', badge: 'BTTS' },
    { flag: '🏴', name: 'Scottish Prem', stat: 'Celtic/Rangers dominate. Rest of league highly open.', badge: 'CORE' },
    { flag: '🇪🇸', name: 'La Liga', stat: 'Top-heavy league. Identifiable mismatches every matchday.', badge: 'MISMATCH' },
    { flag: '🏴', name: 'Premier League', stat: "World's most bet league. Soft lines on lower-table fixtures.", badge: 'CORE' },
  ];
  return (
    <section className="lp-section" id="leagues">
      <div className="lp-container">
        <div className="lp-section-eyebrow">— Coverage</div>
        <div className="lp-section-head">
          <h2 className="lp-heading">
            8 leagues. Every matchday.
            <br />
            All season.
          </h2>
          <p>
            Every fixture run through the same statistical model — fed by team form, expected goals,
            rest days, and head-to-head data.
          </p>
        </div>
        <div className="lp-leagues-grid">
          {leagues.map((l) => (
            <div key={l.name} className="lp-league-card">
              <div className="league-top">
                <span className="flag">{l.flag}</span>
                <span className="lp-badge">{l.badge}</span>
              </div>
              <h4>{l.name}</h4>
              <p>{l.stat}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PricingSection() {
  const plans = [
    {
      name: 'Scout',
      price: '£0',
      suffix: '/ month',
      urgency: 'Start understanding value today',
      desc: 'Get started with daily match analysis on three core leagues.',
      features: [
        '3 leagues — rotating weekly',
        'Daily AI match analysis',
        'EV calculator (top 5 picks/day)',
        'Confidence scoring',
        'Email matchday digest',
      ],
      cta: 'Start free',
    },
    {
      name: 'Analyst',
      price: '£14',
      suffix: '/ month',
      urgency: 'The full edge toolkit — most popular',
      desc: 'Full coverage across 8 leagues with unlimited EV picks.',
      features: [
        'All 8 leagues, all matchdays',
        'Unlimited EV picks',
        'Form, xG, rest days & H2H stats',
        'Strong Value alerts',
        'Bet tracking + ROI dashboard',
        'Priority data refresh',
      ],
      cta: 'Get Analyst',
      featured: true,
    },
    {
      name: 'Edge',
      price: '£39',
      suffix: '/ month',
      urgency: 'Everything. No limits. Maximum edge.',
      desc: 'Pro-tier toolkit with API access and custom alerts.',
      features: [
        'Everything in Analyst',
        'Custom EV thresholds',
        'Real-time push alerts',
        'API access for spreadsheets',
        'Bankroll & Kelly calculator',
        'Direct support',
      ],
      cta: 'Get Edge',
    },
  ];
  return (
    <section className="lp-section" id="pricing">
      <div className="lp-container">
        <div className="lp-section-eyebrow">— Pricing</div>
        <div className="lp-section-head">
          <h2 className="lp-heading">
            One winning bet pays
            <br />
            for a month.
          </h2>
          <p>
            The average STRONG VALUE pick identified by VantaEdge at £10 stake returns £1.50–£3.50
            profit. One hit covers your subscription. Everything after that is pure edge.
          </p>
        </div>
        <div className="lp-pricing-grid">
          {plans.map((p) => (
            <div key={p.name} className={`lp-plan ${p.featured ? 'featured' : ''}`}>
              {p.featured && <span className="lp-plan-tag">Most Popular</span>}
              <h3>{p.name}</h3>
              <div className="price">
                <span>{p.price}</span>
                <span className="price-suffix">{p.suffix}</span>
              </div>
              <div className="urgency">{p.urgency}</div>
              <div className="desc">{p.desc}</div>
              <ul>
                {p.features.map((f) => (
                  <li key={f}>
                    <span className="check">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link className={`lp-btn plan-cta ${p.featured ? 'lp-btn-primary' : ''}`} to="/register">
                {p.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer({ openAppHref }) {
  return (
    <footer className="lp-footer">
      <div className="lp-container">
        <div className="lp-footer-top">
          <div>
            <Brand />
            <p className="tagline">Statistical edge. Every matchday.</p>
          </div>
          <div className="lp-footer-col">
            <h5>Product</h5>
            <Link to={openAppHref}>Dashboard</Link>
            <Link to="/login">Login</Link>
            <Link to="/register">Register</Link>
            <Link to="/affiliate">Affiliates</Link>
          </div>
          <div className="lp-footer-col">
            <h5>Resources</h5>
            <a href="#how">How EV works</a>
            <a href="#leagues">Leagues</a>
            <a href="#pricing">Pricing</a>
          </div>
        </div>
        <div className="lp-footer-bottom">
          <div className="disc">
            VantaEdge provides statistical analysis for informational purposes only. We do not
            encourage gambling. Please bet responsibly. 18+.
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
      <div className="lp-shell">
        <Nav openAppHref={openAppHref} />
        <Hero />
        <WhySection />
        <EVSection />
        <SocialProof />
        <LeaguesSection />
        <PricingSection />
        <Footer openAppHref={openAppHref} />
      </div>
    </div>
  );
}
