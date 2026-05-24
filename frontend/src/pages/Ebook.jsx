import { Link } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { isSharp, useAuth } from '../context/AuthContext.jsx';

// Ebook landing page — "The FastScore Betting Bible".
// Linked from the PromoBanner (Banner #2) and from the sidebar under
// "How It Works". Buy Now → Whop checkout — same flow as PRO so the
// receipt + delivery email is handled by the existing webhook.
// PRO subscribers DO still pay for the ebook (separate product, not
// bundled with the subscription).
const EBOOK_PURCHASE_URL = 'https://whop.com/checkout/plan_OKCKru0OMYLlY';

const CHAPTERS = [
  { n: 1, t: 'Why most bettors lose', d: 'The math behind the bookmakers\' edge and why intuition fails.' },
  { n: 2, t: 'Expected Value (EV) from first principles', d: 'Calculating EV by hand, when it\'s positive, when it\'s a trap.' },
  { n: 3, t: 'Reading and shopping odds', d: 'Decimal, fractional, American — and why line shopping is non-negotiable.' },
  { n: 4, t: 'Bankroll management', d: 'Unit sizing, flat vs proportional staking, surviving variance.' },
  { n: 5, t: 'The Kelly Criterion', d: 'Full Kelly, fractional Kelly, when Kelly will blow up your bankroll.' },
  { n: 6, t: 'Value betting at scale', d: 'How professional bettors find +EV consistently — and what they avoid.' },
  { n: 7, t: 'Building an edge in soccer markets', d: 'Over/Under, BTTS, corners — where the value actually lives.' },
  { n: 8, t: 'Closing line value (CLV)', d: 'The single metric that tells you if you\'re actually beating the market.' },
  { n: 9, t: 'Avoiding the cognitive traps', d: 'Tilt, recency bias, sunk cost, gambler\'s fallacy — and how to spot them in yourself.' },
  { n: 10, t: 'Tracking everything', d: 'The spreadsheet template, what to log, what your numbers actually mean.' },
  { n: 11, t: 'AI tools in 2026', d: 'What they\'re good at, what they\'re bad at, how to use them as a teammate not an oracle.' },
  { n: 12, t: 'A complete betting workflow', d: 'From morning prep through bet placement through end-of-month review.' },
];

export default function Ebook() {
  const { user } = useAuth();
  const pro = isSharp(user);

  return (
    <Layout page="ebook">
      <div style={{ maxWidth: 920 }}>
        <div style={{ marginBottom: 28 }}>
          <h1
            className="display"
            style={{
              fontSize: 36,
              fontWeight: 700,
              margin: 0,
              letterSpacing: '-0.025em',
            }}
          >
            The FastScore Betting Bible
          </h1>
          <p
            className="mono"
            style={{
              margin: '6px 0 0',
              color: 'var(--text-3)',
              fontSize: 12,
              letterSpacing: '0.04em',
            }}
          >
            100+ PAGES · COMPLETE GUIDE FROM ZERO TO PROFITABLE BETTOR
          </p>
        </div>

        {/* Hero: cover + headline price + CTA */}
        <div
          className="ebook-hero card"
          style={{
            padding: 24,
            marginBottom: 24,
            display: 'grid',
            gridTemplateColumns: '180px 1fr',
            gap: 28,
            alignItems: 'center',
            borderColor: 'rgba(129,140,248,0.3)',
            background:
              'linear-gradient(135deg, rgba(129,140,248,0.06), transparent), var(--card)',
          }}
        >
          {/* Cover mockup — dark themed, no real image yet. */}
          <div
            aria-hidden="true"
            className="ebook-cover"
            style={{
              width: 180,
              height: 240,
              borderRadius: 6,
              background:
                'linear-gradient(160deg, #1a1a26 0%, #0d0d18 100%), var(--card-2)',
              border: '1px solid rgba(129,140,248,0.35)',
              boxShadow:
                '0 18px 40px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: 16,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              className="mono"
              style={{
                fontSize: 9,
                letterSpacing: '0.18em',
                color: '#818cf8',
                opacity: 0.85,
              }}
            >
              FASTSCORE
            </div>
            <div
              className="display"
              style={{
                fontSize: 18,
                fontWeight: 700,
                lineHeight: 1.15,
                color: '#fff',
                letterSpacing: '-0.015em',
              }}
            >
              THE<br />BETTING<br />BIBLE
            </div>
            <div
              className="mono"
              style={{
                fontSize: 9,
                letterSpacing: '0.16em',
                color: 'rgba(255,255,255,0.45)',
              }}
            >
              100+ PAGES · 2026
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: 'var(--indigo, #818cf8)',
                letterSpacing: '0.12em',
                marginBottom: 8,
              }}
            >
              NEW · €9.99 ONE-TIME
            </div>
            <h2
              className="display"
              style={{
                fontSize: 22,
                fontWeight: 600,
                margin: '0 0 10px',
                letterSpacing: '-0.015em',
              }}
            >
              Everything we wish we'd been told before placing our first bet.
            </h2>
            <p
              style={{
                margin: '0 0 16px',
                color: 'var(--text-2)',
                fontSize: 14,
                lineHeight: 1.55,
              }}
            >
              EV. Kelly. Closing line value. Bankroll management. Tilt control.
              How to read odds. How AI tools fit in. Twelve chapters, no
              fluff, no get-rich tone — written by the team behind FastScore.
            </p>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <a
                href={EBOOK_PURCHASE_URL}
                className="btn btn-primary"
                style={{ textDecoration: 'none' }}
                target="_blank"
                rel="noopener noreferrer"
              >
                Buy Now — €9.99 →
              </a>
              {pro ? (
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: 'var(--text-3)',
                    letterSpacing: '0.04em',
                  }}
                >
                  PRO subscriber? You still get the ebook at the same price — separate product.
                </span>
              ) : null}
              {/* Intentionally no "free with PRO" line — the ebook is
                  a separate Whop product, not bundled with the
                  subscription. The note above clarifies that for PRO
                  visitors so they don't expect a freebie. */}
            </div>
          </div>
        </div>

        {/* What's inside */}
        <div className="card" style={{ padding: 24, marginBottom: 16 }}>
          <h2
            className="display"
            style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 600 }}
          >
            What's inside
          </h2>
          <p
            className="mono"
            style={{
              margin: '0 0 18px',
              fontSize: 11,
              color: 'var(--text-3)',
              letterSpacing: '0.06em',
            }}
          >
            12 CHAPTERS · ~110 PAGES · PDF + EPUB
          </p>
          <div style={{ display: 'grid', gap: 12 }}>
            {CHAPTERS.map((c) => (
              <div
                key={c.n}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '36px 1fr',
                  gap: 14,
                  alignItems: 'flex-start',
                }}
              >
                <div
                  className="mono"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    border: '1px solid rgba(129,140,248,0.35)',
                    color: '#818cf8',
                    background: 'rgba(129,140,248,0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {String(c.n).padStart(2, '0')}
                </div>
                <div>
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--text)',
                      marginBottom: 2,
                    }}
                  >
                    {c.t}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
                    {c.d}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer CTA */}
        <div
          className="card"
          style={{
            padding: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            flexWrap: 'wrap',
            borderColor: 'rgba(129,140,248,0.3)',
          }}
        >
          <div>
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: 'var(--indigo, #818cf8)',
                letterSpacing: '0.12em',
              }}
            >
              ONE-TIME PURCHASE · €9.99
            </div>
            <div
              className="display"
              style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}
            >
              Ready when you are.
            </div>
          </div>
          <a
            href={EBOOK_PURCHASE_URL}
            className="btn btn-primary"
            style={{ textDecoration: 'none' }}
            target="_blank"
            rel="noopener noreferrer"
          >
            Buy Now →
          </a>
        </div>

        <div style={{ marginTop: 24, fontSize: 12, color: 'var(--text-faint)' }}>
          18+ · Gambling can be addictive. Bet responsibly. Past performance
          does not guarantee future results. Not financial advice.{' '}
          <Link to="/dashboard" style={{ color: 'var(--mint)' }}>
            Back to today's matches →
          </Link>
        </div>
      </div>
    </Layout>
  );
}
