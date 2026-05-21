import { Link } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import { isSharp, useAuth } from '../context/AuthContext.jsx';
import { openWhopCheckout } from '../lib/checkout.js';

// Guide / How It Works page. Plain-English, no betting-math jargon.
// Both Free and Pro see the same content here — there's nothing locked
// in this page anymore.
export default function Guide({ openUpgrade }) {
  const { user } = useAuth();
  const pro = isSharp(user);

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
            WHAT FASTSCORE DOES · WHAT EACH SCREEN SHOWS
          </p>
        </div>

        <Section title="What FastScore does">
          <p style={p}>
            FastScore is an AI-powered MLS match analyser. Every Monday morning
            we scan the upcoming week of fixtures, pull each team's recent form,
            scoring/conceding averages, rest days, head-to-head record, and the
            referee's goals-per-game tendency. An AI scores the most likely
            Over/Under and BTTS (Both Teams To Score) outcomes — with a
            confidence percentage and a written reasoning paragraph.
          </p>
          <p style={p}>
            The point is to give you something better than a coin flip. You
            still decide whether to bet. We just put the AI's take next to the
            stats it's leaning on.
          </p>
        </Section>

        <Section title="The dashboard, top to bottom">
          <Step n={1} title="Calendar strip">
            Shows the current Monday–Sunday week. The pill highlighted in mint
            is today. Each pill shows how many fixtures are scheduled for that
            day. Tap any future date to jump to it.
          </Step>
          <Step n={2} title="Best Bet banner">
            The single highest-confidence pick for the selected day. One match,
            one prediction, one confidence number. That's it.
          </Step>
          <Step n={3} title="Match cards">
            Each fixture shows team form (last 5 W/L/D), goals averages, rest
            days, head-to-head goals-per-match, the referee on duty, and two
            prediction badges — OVER 2.5 with confidence %, BTTS with
            confidence %.
          </Step>
          <Step n={4} title="Show Analysis">
            Expands a paragraph explaining why the AI picked these lines.
            References the specific stats from the data (form, goals averages,
            head-to-head, referee history) — not generic templated text.
          </Step>
        </Section>

        <Section title="The Bet Tracker">
          <p style={p}>
            Log every bet you place. Pick the match, the bet type (Over 2.5,
            Under 2.5, BTTS Yes/No, or Other), enter your odds and stake,
            mark it as a win or loss when the match finishes. The Tracker
            tallies your real win rate and profit over time — no
            self-deception, no spreadsheets.
          </p>
        </Section>

        <Section title="Results page">
          <p style={p}>
            Want to see how the AI did this week? The Results page shows the
            last 7 days of settled predictions — each match with what was
            predicted, the final score, and a hit-or-miss check.
          </p>
        </Section>

        <Section title="Plans">
          <p style={p}>
            <strong style={{ color: 'var(--text)' }}>Free.</strong>{' '}
            Predictions, confidence scores, form, stats, head-to-head, and the
            Results page are all visible. Full AI reasoning, Bet Tracker, and
            accuracy history are locked.
          </p>
          <p style={p}>
            <strong style={{ color: 'var(--mint)' }}>PRO — $4.99/mo.</strong>{' '}
            Unlocks the full AI reasoning paragraph on every card, the Bet
            Tracker, and the accuracy history page. Cancel anytime.
          </p>
        </Section>

        {!pro && (
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
              UPGRADE
            </div>
            <h3 className="display" style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>
              Unlock PRO
            </h3>
            <p style={{ margin: '0 0 14px', color: 'var(--text-2)', fontSize: 14 }}>
              Full AI reasoning · Bet Tracker · Accuracy history.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={openWhopCheckout}
            >
              Get PRO — $4.99/mo
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
