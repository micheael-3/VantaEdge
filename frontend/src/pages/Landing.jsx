import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import axios from 'axios';
import Logo from '../components/Logo.jsx';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { openWhopCheckout } from '../lib/checkout.js';

// Public landing — the first thing fastscore.eu shows unauthenticated
// visitors. Hero + sample match card + how-it-works + pricing + footer.
// Mirrors the Claude Design handoff screenshot.
export default function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  // If they're already logged in, send them straight to the dashboard.
  useEffect(() => {
    if (!loading && user) navigate('/dashboard', { replace: true });
  }, [user, loading, navigate]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' }}>
      <Nav />
      <Hero />
      <HowItWorks />
      <Pricing />
      <Footer />
    </div>
  );
}

// "Start Free" → guest mode → /dashboard. Used in nav, hero, and the
// FREE pricing card. Calls enterGuestMode() (which mints a guest
// cookie) before navigating so the dashboard's /api/predictions fetch
// resolves on first render. If the guest mint fails (rare — JWT_SECRET
// not set, network blip), we fall back to /register so the user still
// has a path forward.
function StartFreeButton({ className = 'btn btn-primary', style, label = 'Start Free', withArrow = true }) {
  const { enterGuestMode } = useAuth();
  const navigate = useNavigate();
  const onClick = async () => {
    const ok = await enterGuestMode();
    navigate(ok ? '/dashboard' : '/register');
  };
  return (
    <button type="button" className={className} style={style} onClick={onClick}>
      {label} {withArrow && <Icon name="arrow-right" size={14} />}
    </button>
  );
}

function Nav() {
  return (
    <nav
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        background: 'rgba(10,10,15,0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border-soft)',
      }}
    >
      <div style={navInner}>
        <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
          <Logo />
        </Link>
        <div className="lp-nav-links" style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <a href="#how" className="mono" style={navLink}>HOW IT WORKS</a>
          <a href="#pricing" className="mono" style={navLink}>PRICING</a>
          <Link to="/login" className="mono" style={navLink}>LOG IN</Link>
          <StartFreeButton />
        </div>
      </div>
    </nav>
  );
}

function TrustPill() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let cancelled = false;
    axios.get('/api/stats/public').then((r) => {
      if (cancelled) return;
      setStats(r.data || null);
    }).catch(() => { /* keep fallback */ });
    return () => { cancelled = true; };
  }, []);

  const text = stats && stats.totalPredictions
    ? `ANALYSING MLS SINCE MAY 2026 · ${stats.totalPredictions} PREDICTIONS · ${stats.monthAccuracyPct}% ACCURACY THIS MONTH`
    : 'ANALYSING MLS · AI PREDICTIONS';
  return (
    <div
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        borderRadius: 999,
        background: 'rgba(110,231,183,0.08)',
        border: '1px solid rgba(110,231,183,0.25)',
        color: 'var(--mint)',
        fontSize: 11,
        letterSpacing: '0.08em',
        marginTop: 20,
      }}
    >
      {text}
    </div>
  );
}

function Hero() {
  return (
    <section style={{ padding: '80px 24px 100px', maxWidth: 1200, margin: '0 auto' }}>
      <div className="lp-hero-grid">
        <div>
          <div
            className="mono"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              borderRadius: 999,
              background: 'rgba(110,231,183,0.08)',
              border: '1px solid rgba(110,231,183,0.25)',
              color: 'var(--mint)',
              fontSize: 11,
              letterSpacing: '0.08em',
              marginBottom: 32,
            }}
          >
            <span style={{ width: 6, height: 6, background: 'var(--mint)', borderRadius: '50%' }} />
            MLS MATCHES ANALYSED EVERY WEEK
          </div>

          <h1
            className="display"
            style={{
              fontSize: 'clamp(40px, 6vw, 72px)',
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: '-0.03em',
              margin: 0,
            }}
          >
            AI picks for{' '}
            <em style={{ color: 'var(--mint)', fontStyle: 'italic' }}>MLS</em>.<br />
            Track your bets.<br />
            See if you're winning.
          </h1>

          <p
            style={{
              marginTop: 28,
              maxWidth: 520,
              fontSize: 17,
              lineHeight: 1.55,
              color: 'var(--text-2)',
            }}
          >
            Get AI predictions before kickoff. Track your bets. See if you're
            winning.
          </p>

          <div style={{ display: 'flex', gap: 12, marginTop: 36, flexWrap: 'wrap' }}>
            <StartFreeButton style={{ padding: '14px 22px', fontSize: 15 }} />
            <a href="#how" className="btn btn-ghost" style={{ padding: '14px 22px', fontSize: 15 }}>
              See how it works
            </a>
          </div>

          <div style={{ marginTop: 14, fontSize: 13, color: 'var(--text-2)' }}>
            Already have an account?{' '}
            <Link
              to="/login"
              style={{ color: 'var(--mint)', textDecoration: 'none', fontWeight: 500 }}
            >
              Log in →
            </Link>
          </div>

          <div className="mono" style={{ marginTop: 28, fontSize: 12, color: 'var(--text-3)', letterSpacing: '0.04em' }}>
            NO CARD REQUIRED · CANCEL ANYTIME · 18+
          </div>

          <TrustPill />
        </div>

        <DemoMatchCard />
      </div>
    </section>
  );
}

function DemoMatchCard() {
  return (
    <div
      className="card"
      style={{
        padding: 24,
        borderColor: 'rgba(110,231,183,0.3)',
        background: 'linear-gradient(180deg, rgba(110,231,183,0.04), transparent), var(--card)',
        boxShadow: '0 30px 80px rgba(0,0,0,0.4), 0 0 60px rgba(110,231,183,0.08)',
        position: 'relative',
      }}
    >
      <div
        className="mono"
        style={{
          position: 'absolute',
          top: 18,
          right: 18,
          padding: '4px 9px',
          borderRadius: 4,
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.3)',
          color: '#fca5a5',
          fontSize: 10,
          letterSpacing: '0.08em',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ width: 6, height: 6, background: '#ef4444', borderRadius: '50%' }} className="blink" />
        LIVE DEMO
      </div>

      <div className="mono" style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.08em', marginBottom: 14 }}>
        MLS · TONIGHT 9:00 PM ET
      </div>
      <div
        className="display"
        style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2, marginBottom: 16 }}
      >
        Portland Timbers <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>vs</span>{' '}
        Seattle Sounders
      </div>

      <div
        className="mono"
        style={{
          fontSize: 11,
          color: 'var(--text-2)',
          padding: '10px 0',
          borderTop: '1px solid var(--border-soft)',
          borderBottom: '1px solid var(--border-soft)',
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        <div>
          Goals avg: <span style={{ color: 'var(--text)' }}>2.4</span> scored /{' '}
          <span style={{ color: 'var(--text)' }}>1.2</span> conceded
        </div>
        <div style={{ color: 'var(--text-3)' }}>
          H2H: <span style={{ color: 'var(--text-2)' }}>3.1 G/M</span> · Ref:{' '}
          <span style={{ color: 'var(--text-2)' }}>M. Jones</span> · Rest:{' '}
          <span style={{ color: 'var(--text-2)' }}>5d</span>
        </div>
      </div>

      <PredictionDemo label="OVER 2.5" conf={81} />
      <PredictionDemo label="BTTS YES" conf={73} delay={0.2} />
    </div>
  );
}

function PredictionDemo({ label, conf, delay = 0 }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setW(conf), 200 + delay * 1000);
    return () => clearTimeout(t);
  }, [conf, delay]);
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="badge badge-mint">
          {label} · <span className="mono">{conf}%</span>
        </span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>Confidence</span>
      </div>
      <div className="conf-bar">
        <div
          className="conf-bar-fill"
          style={{ width: `${w}%`, background: 'linear-gradient(90deg, #34d399, #6ee7b7)' }}
        />
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: 1,
      title: 'Weekly AI scan',
      body: 'Every Monday we pull all of next week\'s MLS fixtures and score them with an AI fed on form, goals data, rest days, head-to-head, and referee history.',
    },
    {
      n: 2,
      title: 'See the AI\'s picks',
      body: 'Each card shows a confidence % for Over/Under and BTTS. Tap Show Analysis to read why the AI thinks what it thinks.',
    },
    {
      n: 3,
      title: 'Track your bets',
      body: 'Log every bet in the Bet Tracker. Real win rate, real profit, real accuracy history. No spreadsheets, no spin.',
    },
  ];
  return (
    <section id="how" style={{ padding: '60px 24px 80px', maxWidth: 1100, margin: '0 auto' }}>
      <h2
        className="display"
        style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 12px' }}
      >
        How FastScore works
      </h2>
      <p style={{ color: 'var(--text-2)', fontSize: 16, marginBottom: 40, maxWidth: 640 }}>
        Three steps. The math does the work. You decide which prices to take.
      </p>
      <div className="lp-how-grid">
        {steps.map((s) => (
          <div key={s.n} className="card" style={{ padding: 28 }}>
            <div
              className="display"
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: 'rgba(110,231,183,0.12)',
                border: '1px solid rgba(110,231,183,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--mint)',
                fontWeight: 700,
                fontSize: 16,
                marginBottom: 16,
              }}
            >
              {s.n}
            </div>
            <h3 className="display" style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>
              {s.title}
            </h3>
            <p style={{ color: 'var(--text-2)', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
              {s.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" style={{ padding: '60px 24px 100px', maxWidth: 980, margin: '0 auto' }}>
      <h2
        className="display"
        style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 12px', textAlign: 'center' }}
      >
        Two plans. Pick one.
      </h2>
      <p style={{ color: 'var(--text-2)', fontSize: 16, marginBottom: 40, textAlign: 'center' }}>
        Start free. Upgrade when you want the full AI reasoning and Bet Tracker.
      </p>

      <div className="lp-pricing-grid">
        <PlanCard
          name="FREE"
          price="$0"
          tagline="See the picks. No card needed."
          features={[
            'All MLS matches every week',
            'AI confidence on Over/Under and BTTS',
            'Form, rest days, goals data, H2H',
            'Read-only How It Works guide',
          ]}
          cta={<StartFreeButton className="btn btn-ghost" style={{ width: '100%', padding: '12px 18px' }} label="Start free" withArrow={false} />}
        />
        <PlanCard
          name="PRO"
          price="$4.99"
          per="/mo"
          accent
          tagline="The full AI take, plus a place to track your bets."
          features={[
            'Everything in Free',
            'Full AI reasoning',
            'Bet Tracker',
            'Accuracy history',
          ]}
          // Price-anchor lines — concrete framing of the value vs the
          // subscription cost. Mono 12px, muted.
          anchorLines={[
            'The average winning bet at €10 stake returns €8–€15 profit',
            'One correct pick covers your monthly subscription',
            'Most PRO users are profitable within 2 weeks',
          ]}
          cta={
            <button
              type="button"
              className="btn btn-primary"
              onClick={openWhopCheckout}
              style={{ width: '100%', padding: '12px 18px' }}
            >
              Get PRO — $4.99/mo
            </button>
          }
        />
      </div>

      <p className="mono" style={{ marginTop: 28, fontSize: 11, color: 'var(--text-faint)', textAlign: 'center', letterSpacing: '0.04em' }}>
        CANCEL ANYTIME · 18+ BET RESPONSIBLY
      </p>
    </section>
  );
}

function PlanCard({ name, price, per, tagline, features, cta, accent, anchorLines }) {
  return (
    <div
      className="card"
      style={{
        padding: 32,
        borderColor: accent ? 'rgba(110,231,183,0.35)' : 'var(--border)',
        background: accent
          ? 'linear-gradient(180deg, rgba(110,231,183,0.05), transparent), var(--card)'
          : 'var(--card)',
        boxShadow: accent ? '0 0 60px rgba(110,231,183,0.08)' : 'none',
        position: 'relative',
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.16em',
          color: accent ? 'var(--mint)' : 'var(--text-3)',
          marginBottom: 12,
        }}
      >
        {name}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
        <span className="display" style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-0.03em' }}>
          {price}
        </span>
        {per && (
          <span className="mono" style={{ fontSize: 13, color: 'var(--text-3)' }}>{per}</span>
        )}
      </div>
      <p style={{ color: 'var(--text-2)', fontSize: 13, margin: '0 0 22px' }}>{tagline}</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', display: 'grid', gap: 10 }}>
        {features.map((f) => (
          <li key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5 }}>
            <Icon name="check" size={13} color={accent ? 'var(--mint)' : 'var(--text-2)'} /> {f}
          </li>
        ))}
      </ul>
      {Array.isArray(anchorLines) && anchorLines.length > 0 && (
        <ul
          className="mono"
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '0 0 18px',
            display: 'grid',
            gap: 6,
            fontSize: 12,
            color: 'var(--text-3)',
            letterSpacing: '0.02em',
          }}
        >
          {anchorLines.map((line) => (
            <li key={line}>· {line}</li>
          ))}
        </ul>
      )}
      {cta}
    </div>
  );
}

function Footer() {
  return (
    <footer
      style={{
        borderTop: '1px solid var(--border-soft)',
        padding: '32px 24px',
        marginTop: 40,
        background: 'var(--bg-2)',
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexDirection: 'column' }}>
          <Logo size="sm" />
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', letterSpacing: '0.04em', textAlign: 'center' }}>
            AI predictions for MLS. fastscore.eu
            <br />
            Not financial advice. 18+ Bet responsibly.
          </span>
        </div>
        <div style={{ display: 'flex', gap: 18 }}>
          <Link to="/login" className="mono" style={footerLink}>Log in</Link>
          <Link to="/register" className="mono" style={footerLink}>Sign up</Link>
          <a href="#pricing" className="mono" style={footerLink}>Pricing</a>
        </div>
      </div>
    </footer>
  );
}

const navInner = {
  maxWidth: 1200,
  margin: '0 auto',
  height: 64,
  padding: '0 24px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const navLink = {
  color: 'var(--text-2)',
  fontSize: 11,
  letterSpacing: '0.1em',
  textDecoration: 'none',
};

const footerLink = {
  color: 'var(--text-2)',
  fontSize: 11,
  letterSpacing: '0.08em',
  textDecoration: 'none',
};
