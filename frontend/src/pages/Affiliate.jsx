import { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout.jsx';
import Icon from '../components/Icon.jsx';
import Loading from '../components/Loading.jsx';
import { affiliate as affApi } from '../api/client.js';

// Affiliate page — visual port of the design's affiliate.jsx, wired to
// the real /api/affiliate/dashboard backend.

function SmallStat({ label, value, mint }) {
  return (
    <div
      style={{
        padding: 14,
        background: 'var(--bg-2)',
        border: '1px solid var(--border-soft)',
        borderRadius: 8,
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 9,
          color: 'var(--text-3)',
          letterSpacing: '0.1em',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        className="display"
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: mint ? 'var(--mint)' : 'var(--text)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function CommBlock({ label, value, unit, highlight }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        className="mono"
        style={{
          fontSize: 10,
          color: 'var(--text-3)',
          letterSpacing: '0.1em',
          marginBottom: 8,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div
        className="display"
        style={{
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: '-0.025em',
          color: highlight ? 'var(--mint)' : 'var(--text)',
        }}
      >
        {value}
        <span
          className="mono"
          style={{ fontSize: 13, color: 'var(--text-3)', fontWeight: 400 }}
        >
          {unit}
        </span>
      </div>
    </div>
  );
}

export default function Affiliate() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refs, setRefs] = useState(10);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await affApi.dashboard();
      setData(res);
      if (typeof res.activeReferrals === 'number' && res.activeReferrals > 0) {
        setRefs(res.activeReferrals);
      }
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        'Failed to load affiliate dashboard';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onJoin = async () => {
    setBusy(true);
    try {
      await affApi.join();
      await load();
    } catch {
      /* surface elsewhere */
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async () => {
    if (!data?.referralLink) return;
    try {
      await navigator.clipboard.writeText(data.referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  const monthly = refs * 4.0;
  const yearly = monthly * 12;

  return (
    <Layout>
      {() => (
        <div>
          <div style={{ marginBottom: 32 }}>
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: 'var(--mint)',
                letterSpacing: '0.12em',
                marginBottom: 12,
              }}
            >
              AFFILIATE PROGRAM
            </div>
            <h1
              className="display"
              style={{
                fontSize: 48,
                fontWeight: 700,
                margin: 0,
                letterSpacing: '-0.03em',
                lineHeight: 1.05,
              }}
            >
              Earn{' '}
              <em
                style={{
                  color: 'var(--mint)',
                  fontStyle: 'italic',
                  fontWeight: 600,
                }}
              >
                40% recurring
              </em>
              <br />
              commission, forever.
            </h1>
            <p
              style={{
                margin: '16px 0 0',
                color: 'var(--text-2)',
                fontSize: 17,
                maxWidth: 580,
                lineHeight: 1.55,
              }}
            >
              Refer bettors to FastScore. Earn every month they stay
              subscribed. No caps. No tiers. Cash out at $20.
            </p>
          </div>

          {loading ? (
            <Loading label="Loading affiliate dashboard…" />
          ) : error ? (
            <div className="empty-state">
              <h3>Couldn't load affiliate data</h3>
              <p>{error}</p>
            </div>
          ) : data && data.hasAffiliate === false ? (
            <div
              className="card"
              style={{
                padding: 28,
                borderColor: 'rgba(110,231,183,0.3)',
                background:
                  'linear-gradient(180deg, rgba(110,231,183,0.06), transparent), var(--card)',
              }}
            >
              <h3
                className="display"
                style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 600 }}
              >
                Become an affiliate
              </h3>
              <p style={{ color: 'var(--text-2)', margin: '0 0 16px' }}>
                Get a unique link, share FastScore, earn a cut on every paid
                signup.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onJoin}
                disabled={busy}
              >
                {busy ? 'Enrolling…' : 'Become an affiliate'}
              </button>
            </div>
          ) : (
            <>
              {/* Commission breakdown */}
              <div
                className="card"
                style={{ padding: 28, marginBottom: 24 }}
              >
                <div
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: 'var(--text-3)',
                    letterSpacing: '0.1em',
                    marginBottom: 20,
                  }}
                >
                  HOW IT BREAKS DOWN
                </div>
                <div
                  className="aff-comm-grid"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto 1fr auto 1fr',
                    gap: 24,
                    alignItems: 'center',
                  }}
                >
                  <CommBlock label="SHARP plan" value="$9.99" unit="/mo" />
                  <span
                    className="display"
                    style={{
                      fontSize: 28,
                      color: 'var(--text-faint)',
                      fontWeight: 300,
                    }}
                  >
                    →
                  </span>
                  <CommBlock
                    label="You earn"
                    value="$4.00"
                    unit="/mo per ref"
                    highlight
                  />
                  <span
                    className="display"
                    style={{
                      fontSize: 28,
                      color: 'var(--text-faint)',
                      fontWeight: 300,
                    }}
                  >
                    ×
                  </span>
                  <CommBlock
                    label={`${refs} referrals`}
                    value={`$${(monthly * 12).toFixed(0)}`}
                    unit="/yr"
                    highlight
                  />
                </div>
              </div>

              {/* Calculator */}
              <div
                className="card"
                style={{
                  padding: 32,
                  marginBottom: 24,
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    width: 400,
                    height: 400,
                    background:
                      'radial-gradient(circle, rgba(110,231,183,0.05), transparent 60%)',
                    pointerEvents: 'none',
                  }}
                />
                <div style={{ position: 'relative' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      marginBottom: 8,
                    }}
                  >
                    <h3
                      className="display"
                      style={{ margin: 0, fontSize: 20, fontWeight: 600 }}
                    >
                      Earnings calculator
                    </h3>
                    <span
                      className="mono"
                      style={{ fontSize: 11, color: 'var(--text-3)' }}
                    >
                      DRAG TO ESTIMATE
                    </span>
                  </div>
                  <div
                    className="aff-calc-grid"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 40,
                      marginTop: 28,
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'baseline',
                          marginBottom: 12,
                        }}
                      >
                        <span
                          className="mono"
                          style={{
                            fontSize: 11,
                            color: 'var(--text-2)',
                            letterSpacing: '0.08em',
                          }}
                        >
                          ACTIVE REFERRALS
                        </span>
                        <span
                          className="display"
                          style={{
                            fontSize: 48,
                            fontWeight: 700,
                            color: 'var(--mint)',
                            letterSpacing: '-0.03em',
                            lineHeight: 1,
                          }}
                        >
                          {refs}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={100}
                        step={1}
                        value={refs}
                        onChange={(e) => setRefs(parseInt(e.target.value, 10))}
                        style={{ width: '100%', accentColor: '#6ee7b7' }}
                      />
                    </div>
                    <div style={{ display: 'grid', gap: 12 }}>
                      <div
                        style={{
                          padding: 20,
                          borderRadius: 10,
                          background: 'rgba(110,231,183,0.06)',
                          border: '1px solid rgba(110,231,183,0.25)',
                        }}
                      >
                        <div
                          className="mono"
                          style={{
                            fontSize: 10,
                            color: 'var(--text-3)',
                            letterSpacing: '0.1em',
                            marginBottom: 6,
                          }}
                        >
                          PER MONTH
                        </div>
                        <div
                          className="display"
                          style={{
                            fontSize: 38,
                            fontWeight: 700,
                            color: 'var(--mint)',
                            letterSpacing: '-0.025em',
                            lineHeight: 1,
                          }}
                        >
                          ${monthly.toFixed(0)}
                        </div>
                      </div>
                      <div
                        style={{
                          padding: 20,
                          borderRadius: 10,
                          background: 'var(--card-2)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        <div
                          className="mono"
                          style={{
                            fontSize: 10,
                            color: 'var(--text-3)',
                            letterSpacing: '0.1em',
                            marginBottom: 6,
                          }}
                        >
                          PER YEAR
                        </div>
                        <div
                          className="display"
                          style={{
                            fontSize: 38,
                            fontWeight: 700,
                            letterSpacing: '-0.025em',
                            lineHeight: 1,
                          }}
                        >
                          ${yearly.toFixed(0)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Your link + stats */}
              <div
                className="aff-link-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.4fr 1fr',
                  gap: 16,
                  marginBottom: 24,
                }}
              >
                <div className="card" style={{ padding: 24 }}>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: 'var(--text-3)',
                      letterSpacing: '0.1em',
                      marginBottom: 12,
                    }}
                  >
                    YOUR REFERRAL LINK
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '12px 14px',
                      background: 'var(--bg-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        flex: 1,
                        fontSize: 14,
                        color: 'var(--text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {data?.referralLink || '—'}
                    </span>
                    <button
                      type="button"
                      onClick={onCopy}
                      className="btn btn-ghost btn-sm"
                      style={{
                        borderColor: copied
                          ? 'rgba(110,231,183,0.4)'
                          : 'var(--border)',
                        color: copied ? 'var(--mint)' : 'var(--text)',
                      }}
                    >
                      {copied ? (
                        <>
                          <Icon name="check" size={13} /> Copied
                        </>
                      ) : (
                        <>
                          <Icon name="copy" size={13} /> Copy
                        </>
                      )}
                    </button>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: 12,
                      marginTop: 24,
                    }}
                  >
                    <SmallStat
                      label="ACTIVE REFS"
                      value={data?.activeReferrals || 0}
                    />
                    <SmallStat
                      label="PENDING PAYOUT"
                      value={`$${Number(data?.pendingPayout || 0).toFixed(2)}`}
                    />
                    <SmallStat
                      label="LIFETIME"
                      value={`$${Number(data?.totalEarned || 0).toFixed(2)}`}
                      mint
                    />
                  </div>
                </div>

                <div className="card" style={{ padding: 24 }}>
                  <h3
                    className="display"
                    style={{
                      margin: '0 0 18px',
                      fontSize: 18,
                      fontWeight: 600,
                    }}
                  >
                    How it works
                  </h3>
                  <ol
                    style={{
                      listStyle: 'none',
                      padding: 0,
                      margin: 0,
                      display: 'grid',
                      gap: 16,
                    }}
                  >
                    {[
                      {
                        t: 'Share your link',
                        b: 'Drop it in Reddit threads, Discord, Twitter — anywhere bettors gather.',
                      },
                      {
                        t: 'They subscribe to SHARP',
                        b: 'Your cookie tracks them for 60 days.',
                      },
                      {
                        t: 'You earn 40% — forever',
                        b: 'Every single month they stay subscribed.',
                      },
                    ].map((s, i) => (
                      <li
                        key={i}
                        style={{ display: 'flex', gap: 14 }}
                      >
                        <span
                          style={{
                            flexShrink: 0,
                            width: 26,
                            height: 26,
                            borderRadius: '50%',
                            background: 'rgba(110,231,183,0.12)',
                            color: 'var(--mint)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 12,
                            fontWeight: 600,
                            border: '1px solid rgba(110,231,183,0.25)',
                          }}
                        >
                          {i + 1}
                        </span>
                        <div>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 500,
                              marginBottom: 3,
                            }}
                          >
                            {s.t}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: 'var(--text-2)',
                              lineHeight: 1.5,
                            }}
                          >
                            {s.b}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Layout>
  );
}
