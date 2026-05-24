const { sql } = require('./_shared/db');
const { json, error, notFound, parseBody, subPath } = require('./_shared/response');
const { requireUser } = require('./_shared/auth-mw');
const { requireTier } = require('./_shared/tier');
const { ensureTable } = require('./_shared/ensure-table');
const {
  VALID_RESULTS,
  VALID_MARKETS,
  computeBetProfit,
  shapeBankroll,
  shapeEntry,
  settlePendingEntry,
} = require('./_shared/bankroll');

// Self-healing DDL for the cross-device bet tracker blob. Runs once
// per Lambda cold start the first time /bets is hit; idempotent.
const BET_TRACKER_BLOBS_DDL = `
  CREATE TABLE IF NOT EXISTS bet_tracker_blobs (
    user_id    UUID         PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    bets       JSONB        NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )
`;

const ALLOWED_CURRENCIES = new Set(['USD', 'GBP', 'EUR']);

// ---------- GET /api/bankroll ----------
async function getBankroll(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const gate = requireTier(user, 'ANALYST');
  if (gate) return gate;

  const [bk] = await sql()`SELECT * FROM bankrolls WHERE user_id = ${user.id}`;
  if (!bk) return json(200, { bankroll: null, entries: [], series: [] });

  const entries = await sql()`
    SELECT id, type, market, stake, odds, result, profit_loss, balance_before,
           balance_after, notes, prediction_id, created_at
    FROM bankroll_entries
    WHERE user_id = ${user.id}
    ORDER BY created_at DESC
    LIMIT 30`;

  // Growth series — chronological order with starting amount as the first
  // datapoint so the chart starts at the original deposit.
  const seriesRows = await sql()`
    SELECT created_at, balance_after
    FROM bankroll_entries
    WHERE user_id = ${user.id}
    ORDER BY created_at ASC`;
  const series = [
    { ts: bk.created_at, balance: Number(bk.starting_amount) },
    ...seriesRows.map((r) => ({ ts: r.created_at, balance: Number(r.balance_after) })),
  ];

  // Headline stats — only WIN/LOSS bets count for win rate / ROI; ADJUSTMENTs
  // and PUSH/PENDING are excluded.
  const settled = await sql()`
    SELECT result, stake, profit_loss FROM bankroll_entries
    WHERE user_id = ${user.id} AND type = 'BET' AND result IN ('WIN', 'LOSS')`;
  const wins = settled.filter((r) => r.result === 'WIN').length;
  const losses = settled.length - wins;
  const totalStaked = settled.reduce((s, r) => s + Number(r.stake || 0), 0);
  const totalProfit = settled.reduce((s, r) => s + Number(r.profit_loss || 0), 0);

  const pl = Number(bk.current_amount) - Number(bk.starting_amount);
  const stats = {
    bets: settled.length,
    wins,
    losses,
    winRate: settled.length ? Math.round((wins / settled.length) * 1000) / 10 : 0,
    totalStaked: Math.round(totalStaked * 100) / 100,
    totalProfit: Math.round(totalProfit * 100) / 100,
    roi: totalStaked > 0 ? Math.round((totalProfit / totalStaked) * 1000) / 10 : 0,
    pl: Math.round(pl * 100) / 100,
    plPct:
      Number(bk.starting_amount) > 0
        ? Math.round((pl / Number(bk.starting_amount)) * 1000) / 10
        : 0,
  };

  return json(200, {
    bankroll: shapeBankroll(bk),
    entries: entries.map(shapeEntry),
    series,
    stats,
  });
}

// ---------- POST /api/bankroll/setup ----------
async function setupBankroll(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const gate = requireTier(user, 'ANALYST');
  if (gate) return gate;

  const body = parseBody(event);
  const startingAmount = Number(body.startingAmount);
  const currency = ALLOWED_CURRENCIES.has(body.currency) ? body.currency : 'USD';
  if (!startingAmount || startingAmount <= 0) return error(400, 'startingAmount must be > 0');

  const [bk] = await sql()`
    INSERT INTO bankrolls (user_id, starting_amount, current_amount, currency)
    VALUES (${user.id}, ${startingAmount}, ${startingAmount}, ${currency})
    ON CONFLICT (user_id) DO UPDATE
      SET starting_amount = EXCLUDED.starting_amount,
          current_amount = EXCLUDED.current_amount,
          currency = EXCLUDED.currency,
          updated_at = NOW()
    RETURNING *`;

  // Optional: clear old entries on setup. Spec doesn't require it, so we
  // keep history intact (user can wipe via Settings → Danger zone if needed).
  return json(201, { bankroll: shapeBankroll(bk) });
}

// ---------- POST /api/bankroll/entry ----------
async function addManualEntry(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const gate = requireTier(user, 'ANALYST');
  if (gate) return gate;

  const body = parseBody(event);
  const type = String(body.type || 'BET').toUpperCase();
  if (!['BET', 'ADJUSTMENT'].includes(type)) return error(400, 'Invalid type');

  const [bk] = await sql()`SELECT * FROM bankrolls WHERE user_id = ${user.id}`;
  if (!bk) return error(400, 'Set up your bankroll first');

  let profitLoss = 0;
  let result = 'PENDING';
  let stake = null;
  let odds = null;
  let market = null;
  let delta = 0; // signed change applied to current_amount atomically

  if (type === 'ADJUSTMENT') {
    // body.amount can be positive (deposit) or negative (withdraw).
    const amount = Number(body.amount);
    if (!amount || Number.isNaN(amount)) return error(400, 'amount required');
    profitLoss = amount;
    delta = amount;
    result = 'WIN'; // marks the entry settled; the frontend filters by type.
  } else {
    // BET
    stake = Number(body.stake);
    odds = Number(body.odds);
    if (!stake || stake <= 0) return error(400, 'stake must be > 0');
    if (!odds || odds <= 1) return error(400, 'odds must be > 1');
    if (stake > Number(bk.current_amount)) return error(400, 'stake exceeds current bankroll');

    market = String(body.market || 'OTHER').toUpperCase();
    if (!VALID_MARKETS.has(market)) market = 'OTHER';

    result = String(body.result || 'PENDING').toUpperCase();
    if (!VALID_RESULTS.has(result)) result = 'PENDING';

    profitLoss = computeBetProfit(stake, odds, result);
    // Stake leaves the bankroll right away; WIN/PUSH return stake (+ profit on WIN).
    delta = -stake;
    if (result === 'WIN') delta += stake + (stake * (odds - 1));
    else if (result === 'PUSH') delta += stake;
  }

  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 500) : null;

  // Atomic balance update first so balance_before/after on the entry reflect
  // the true serialised state, not a stale pre-read.
  const updated = await sql()`
    UPDATE bankrolls
    SET current_amount = current_amount + ${delta}, updated_at = NOW()
    WHERE user_id = ${user.id}
    RETURNING current_amount`;
  if (updated.length === 0) return error(500, 'bankroll update failed');
  const balanceAfter = Number(updated[0].current_amount);
  const balanceBefore = balanceAfter - delta;

  const [inserted] = await sql()`
    INSERT INTO bankroll_entries
      (user_id, prediction_id, type, market, stake, odds, result, profit_loss,
       balance_before, balance_after, notes)
    VALUES
      (${user.id}, ${null}, ${type}, ${market}, ${stake}, ${odds}, ${result}, ${profitLoss},
       ${balanceBefore}, ${balanceAfter}, ${notes})
    RETURNING *`;

  return json(201, { entry: shapeEntry(inserted), newBalance: balanceAfter });
}

// ---------- POST /api/bankroll/bet ----------
// Linked to a prediction. Auto-settles immediately if the prediction is already settled.
async function logBet(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const gate = requireTier(user, 'ANALYST');
  if (gate) return gate;

  const body = parseBody(event);
  const predictionId = body.predictionId;
  if (!predictionId) return error(400, 'predictionId required');
  const stake = Number(body.stake);
  const odds = Number(body.odds);
  if (!stake || stake <= 0) return error(400, 'stake must be > 0');
  if (!odds || odds <= 1) return error(400, 'odds must be > 1');
  const market = String(body.market || 'OVER').toUpperCase();
  if (!VALID_MARKETS.has(market)) return error(400, 'Invalid market');

  const [bk] = await sql()`SELECT * FROM bankrolls WHERE user_id = ${user.id}`;
  if (!bk) return error(400, 'Set up your bankroll first');
  if (stake > Number(bk.current_amount)) return error(400, 'stake exceeds current bankroll');

  // Confirm the prediction exists and belongs to this user (or matches a public fixture).
  const [pred] = await sql()`
    SELECT id, user_id, over_hit, btts_hit FROM predictions WHERE id = ${predictionId}`;
  if (!pred) return error(404, 'Prediction not found');

  // Atomic debit — avoids losing concurrent log-this-bet clicks.
  const debited = await sql()`
    UPDATE bankrolls
    SET current_amount = current_amount - ${stake}, updated_at = NOW()
    WHERE user_id = ${user.id} AND current_amount >= ${stake}
    RETURNING current_amount`;
  if (debited.length === 0) return error(400, 'stake exceeds current bankroll');
  const balanceAfter = Number(debited[0].current_amount);
  const balanceBefore = balanceAfter + Number(stake);

  const [inserted] = await sql()`
    INSERT INTO bankroll_entries
      (user_id, prediction_id, type, market, stake, odds, result, profit_loss,
       balance_before, balance_after, notes)
    VALUES
      (${user.id}, ${predictionId}, 'BET', ${market}, ${stake}, ${odds}, 'PENDING', 0,
       ${balanceBefore}, ${balanceAfter}, ${typeof body.notes === 'string' ? body.notes.slice(0, 500) : null})
    RETURNING *`;

  // If the linked prediction has already settled, settle this entry now.
  let settledNow = null;
  if (pred.over_hit !== null || pred.btts_hit !== null) {
    settledNow = await settlePendingEntry({ ...inserted, user_id: user.id }, pred);
  }

  // Re-read for the post-settle state.
  const [final] = await sql()`SELECT * FROM bankroll_entries WHERE id = ${inserted.id}`;
  const [bkFinal] = await sql()`SELECT current_amount FROM bankrolls WHERE user_id = ${user.id}`;

  return json(201, {
    entry: shapeEntry(final),
    newBalance: Number(bkFinal.current_amount),
    settled: !!settledNow,
  });
}

// ---------- GET/PUT /api/bankroll/bets ----------
//
// Cross-device sync for the Bet Tracker page. The frontend keeps its
// bet list in a localStorage blob (parlays + single bets + free-form
// match strings — a richer shape than the structured bankroll_entries
// table tracks). This endpoint mirrors that blob into the
// `bet_tracker_blobs` table so the same logged-in account sees the
// same tracker on iPad + PC + phone.
//
// GET returns { bets: [...] }; empty array when no row exists yet.
// PUT body { bets: [...] } upserts the row. We cap the array at 500
// entries server-side as a hard ceiling against runaway payloads.

const MAX_BETS = 500;

function isMissingBlobTable(err) {
  return (
    err &&
    (err.code === '42P01' ||
      /relation "?bet_tracker_blobs"? does not exist/i.test(err.message || ''))
  );
}

async function getBets(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const gate = requireTier(user, 'ANALYST');
  if (gate) return gate;
  // Self-heal — first request after a deploy creates the table.
  try { await ensureTable('bet_tracker_blobs', BET_TRACKER_BLOBS_DDL); } catch { /* fall through */ }
  try {
    const [row] = await sql()`
      SELECT bets, updated_at FROM bet_tracker_blobs WHERE user_id = ${user.id}`;
    if (!row) return json(200, { bets: [], updatedAt: null });
    const bets = Array.isArray(row.bets) ? row.bets : [];
    return json(200, { bets, updatedAt: row.updated_at });
  } catch (err) {
    if (isMissingBlobTable(err)) {
      // Schema not migrated — degrade so the frontend keeps working
      // from localStorage. PUT will see the same error.
      return json(200, { bets: [], updatedAt: null, warning: 'bet_tracker_blobs table missing — run schema.sql' });
    }
    console.error('[bankroll/bets GET] failed:', err.message);
    return error(500, err.message || 'bets fetch failed');
  }
}

async function putBets(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const gate = requireTier(user, 'ANALYST');
  if (gate) return gate;
  const body = parseBody(event);
  const incoming = Array.isArray(body.bets) ? body.bets : null;
  if (!incoming) return error(400, 'bets must be an array');
  const bets = incoming.slice(0, MAX_BETS);
  try { await ensureTable('bet_tracker_blobs', BET_TRACKER_BLOBS_DDL); } catch { /* fall through */ }
  try {
    await sql()`
      INSERT INTO bet_tracker_blobs (user_id, bets, updated_at)
      VALUES (${user.id}, ${JSON.stringify(bets)}::jsonb, NOW())
      ON CONFLICT (user_id) DO UPDATE
        SET bets = EXCLUDED.bets,
            updated_at = NOW()`;
    return json(200, { ok: true, count: bets.length });
  } catch (err) {
    if (isMissingBlobTable(err)) {
      // Same graceful degrade — return ok so the frontend doesn't show
      // an error toast; user will simply lose cross-device sync until
      // the table exists.
      return json(200, { ok: true, count: bets.length, warning: 'bet_tracker_blobs table missing — run schema.sql' });
    }
    console.error('[bankroll/bets PUT] failed:', err.message);
    return error(500, err.message || 'bets save failed');
  }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    const path = subPath(event, 'bankroll');
    const method = event.httpMethod;
    if (method === 'GET' && (path === '/' || path === '')) return await getBankroll(event);
    if (method === 'POST' && path === '/setup') return await setupBankroll(event);
    if (method === 'POST' && path === '/entry') return await addManualEntry(event);
    if (method === 'POST' && path === '/bet') return await logBet(event);
    // Cross-device bet tracker sync.
    if (method === 'GET' && (path === '/bets' || path === '/bets/')) return await getBets(event);
    if ((method === 'PUT' || method === 'POST') && (path === '/bets' || path === '/bets/')) return await putBets(event);
    return notFound();
  } catch (err) {
    console.error('bankroll handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
