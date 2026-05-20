import { Link } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import LockedOverlay from '../components/LockedOverlay.jsx';
import { isSharp, useAuth } from '../context/AuthContext.jsx';
import { openWhopCheckout } from '../lib/checkout.js';

// Guide / How It Works page. Two sections:
//  1. How FastScore works — visible to everyone (the "free preview")
//  2. Sports betting fundamentals — Sharp tier only. FREE users see
//     the top of each section blurred under a single LockedOverlay,
//     so they can tell the content is real but can't read it.
export default function Guide({ openUpgrade }) {
  const { user } = useAuth();
  const sharp = isSharp(user);

  return (
    <Layout page="guide" openUpgrade={openUpgrade}>
      <div style={{ maxWidth: 880 }}>
        <div style={{ marginBottom: 28 }}>
          <h1
            className="display"
            style={{ fontSize: 36, fontWeight: 700, margin: 0, letterSpacing: '-0.025em' }}
          >
            How It Works
          </h1>
          <p
            className="mono"
            style={{ margin: '6px 0 0', color: 'var(--text-3)', fontSize: 12, letterSpacing: '0.04em' }}
          >
            EVERYTHING YOU NEED TO KNOW · UPDATED FOR THE 2026 SEASON
          </p>
        </div>

        {/* ============ FREE: How FastScore works ============ */}
        <Section title="What FastScore does">
          <p style={p}>
            FastScore is an AI-powered MLS match analyser. Every Monday morning
            we scan the upcoming week of fixtures, pull each team's recent form,
            scoring/conceding averages, rest days, and head-to-head record, and
            ask a language model to score the most likely Over/Under and BTTS
            (Both Teams To Score) outcomes — with a confidence percentage and a
            written reasoning.
          </p>
          <p style={p}>
            The model is just the input. Where you make money is at the next step:
            comparing the model's probability against the bookmaker's implied
            probability. If the model says 74% chance of Over 2.5 and the bookie
            is pricing it at 1.85 (≈ 54% implied), there's a 20-point edge — that's
            value you can bet into repeatedly.
          </p>
        </Section>

        <Section title="The dashboard, top to bottom">
          <Step n={1} title="Calendar strip">
            Shows the current Monday–Sunday week. The pill highlighted in mint
            is today. Each pill shows how many fixtures are scheduled for that
            day. Click any future date to filter the match list.
          </Step>
          <Step n={2} title="Best Bet banner">
            The single highest-confidence pick for the selected day, with a
            built-in odds input. Type your bookmaker's price and the edge +
            Kelly stake update live.
          </Step>
          <Step n={3} title="Match cards">
            Each fixture shows team form (last 5 W/L/D), average goals
            scored/conceded, rest days, head-to-head goals-per-match, then two
            prediction badges — OVER 2.5 with confidence %, BTTS YES with
            confidence %. Below that: an odds input per market. Type the
            bookie's odds and you get the edge percentage + Kelly stake size
            instantly.
          </Step>
          <Step n={4} title="Show AI Analysis">
            Expands a paragraph explaining why the model picked these lines.
            References the specific stats from the data (form, goals averages,
            etc.) — not generic templated text.
          </Step>
        </Section>

        <Section title="Plans">
          <p style={p}>
            <strong style={{ color: 'var(--text)' }}>Free.</strong>{' '}
            Predictions, confidence scores, and form/stats — fully visible.
            The EV and Kelly calculations on each card are locked behind an
            upgrade overlay.
          </p>
          <p style={p}>
            <strong style={{ color: 'var(--mint)' }}>Sharp — $9.99/mo.</strong>{' '}
            Unlocks the EV + Kelly calculators on every card, the full bet
            tracker with P&amp;L, history accuracy, AI reasoning paragraphs,
            and CSV export. Cancel anytime.
          </p>
        </Section>

        {/* ============ SHARP: Real betting education ============ */}
        <div style={{ position: 'relative', marginTop: 32 }}>
          <Section title="Sports betting fundamentals">
            <Step n={1} title="What is +EV (expected value)?">
              Every bet has an outcome with a probability and a payoff. If you
              bet $100 at 1.85 odds on a 74% chance outcome, your average return
              over thousands of identical bets is:
              <br />
              <code style={code}>EV = (0.74 × 0.85) − (0.26 × 1.00) = +0.369 per $1 bet</code>
              <br />
              That's a 36.9% edge. Repeat that bet enough times and you make money.
              Anything above 0% is profitable in the long run.
            </Step>
            <Step n={2} title="The Kelly Criterion (stake sizing)">
              Once you have an edge, the next question is how much to bet. Too
              much and one losing streak wipes you out. Too little and you
              don't capture the edge. The Kelly formula gives the mathematically
              optimal percentage of your bankroll:
              <br />
              <code style={code}>f = (bp − q) / b</code>
              <br />
              Where{' '}
              <span style={mono}>b</span> = decimal odds − 1,{' '}
              <span style={mono}>p</span> = your win probability,{' '}
              <span style={mono}>q</span> = 1 − p. FastScore calculates this for
              you automatically when you enter odds.
            </Step>
            <Step n={3} title="Bankroll management">
              Real pros use <strong>half-Kelly</strong> or <strong>quarter-Kelly</strong> —
              they bet half (or a quarter) of what the formula recommends. The
              math says full Kelly is optimal, but it ignores estimation error.
              In reality your "74%" might actually be 68%. Half-Kelly absorbs
              that error while still capturing most of the upside.
            </Step>
            <Step n={4} title="Why most bettors lose">
              Bookmakers build in a margin (the "vig" or "overround"), usually
              4–8%. The implied probabilities of all outcomes sum to ≥ 100%.
              That margin alone means casual bettors are guaranteed to lose long
              term. The only way to beat the book is to find prices where the
              true probability is significantly higher than the implied one —
              which is what the FastScore EV calculator surfaces in real time.
            </Step>
            <Step n={5} title="Over/Under markets — why they're our focus">
              Goals lines (Over 2.5, BTTS) are statistically easier to model than
              match results. They're driven by clear, persistent team-level
              tendencies: a team that averages 2.4 goals scored and 1.6 conceded
              over the season doesn't suddenly become a defensive masterclass.
              That stability is what makes AI models like the one driving
              FastScore measurably better than pure intuition on these markets.
            </Step>
            <Step n={6} title="When to skip a match">
              If the bookie's odds imply a higher probability than FastScore's
              confidence (negative EV), don't bet. Discipline matters more than
              volume — pros bet 3–5 matches a week, not 30. The EV calculator
              tells you when to walk away as clearly as when to bet.
            </Step>
            <Step n={7} title="Record everything">
              Use the Bet Tracker. Every entered bet creates a row with the
              match, market, stake, odds, and outcome. Over 50–100 bets you'll
              see your real ROI emerge — and whether your edge is actually
              working. Anyone telling you they're profitable without showing
              their tracker is lying.
            </Step>
          </Section>

          {!sharp && (
            <LockedOverlay
              onUnlock={openWhopCheckout}
              style={{ borderRadius: 12, marginTop: -40 }}
            >
              <span className="lock-pill">
                🔒 Unlock the Sharp Guide — $9.99/mo
              </span>
            </LockedOverlay>
          )}
        </div>

        {!sharp && (
          <div
            className="card"
            style={{
              marginTop: 24,
              padding: 24,
              borderColor: 'rgba(110,231,183,0.3)',
              background:
                'linear-gradient(180deg, rgba(110,231,183,0.06), transparent), var(--card)',
            }}
          >
            <div className="mono" style={{ fontSize: 10, color: 'var(--mint)', letterSpacing: '0.1em', marginBottom: 6 }}>
              SHARP UNLOCKS THE FULL GUIDE
            </div>
            <h3 className="display" style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>
              Learn the math, then bet with it.
            </h3>
            <p style={{ margin: '0 0 14px', color: 'var(--text-2)', fontSize: 14 }}>
              The full guide covers EV, Kelly, bankroll management, when to skip,
              and why Over/Under markets reward discipline. Plus you get the
              live EV calculator on every match card.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={openWhopCheckout}
            >
              Get SHARP — $9.99/mo
            </button>
          </div>
        )}

        <div style={{ marginTop: 28, fontSize: 12, color: 'var(--text-faint)' }}>
          18+ · Gambling can be addictive. Bet responsibly · Past performance
          does not guarantee future results · Not financial advice.{' '}
          <Link to="/dashboard" style={{ color: 'var(--mint)' }}>
            Back to today's matches →
          </Link>
        </div>
      </div>
    </Layout>
  );
}

function Section({ title, children }) {
  return (
    <div
      className="card"
      style={{ padding: 24, marginBottom: 16 }}
    >
      <h2
        className="display"
        style={{ margin: '0 0 14px', fontSize: 22, fontWeight: 600 }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
      <div
        className="display"
        style={{
          flex: '0 0 36px',
          height: 36,
          borderRadius: '50%',
          background: 'rgba(110, 231, 183, 0.12)',
          border: '1px solid rgba(110, 231, 183, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--mint)',
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        {n}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 15,
            marginBottom: 6,
            color: 'var(--text)',
          }}
        >
          {title}
        </div>
        <div style={{ ...p, marginBottom: 0 }}>{children}</div>
      </div>
    </div>
  );
}

const p = {
  margin: '0 0 12px',
  color: 'var(--text-2)',
  fontSize: 14,
  lineHeight: 1.65,
};

const mono = {
  fontFamily: 'var(--font-mono)',
  color: 'var(--mint)',
  fontSize: 13,
};

const code = {
  display: 'inline-block',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  color: 'var(--mint)',
  background: 'rgba(110, 231, 183, 0.08)',
  border: '1px solid rgba(110, 231, 183, 0.2)',
  padding: '4px 8px',
  borderRadius: 4,
  margin: '6px 0',
};
