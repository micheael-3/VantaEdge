// Shared bankroll accounting helpers, importable by both the bankroll
// function and the results worker (which auto-settles linked entries).

const { sql } = require('./db');

const VALID_RESULTS = new Set(['PENDING', 'WIN', 'LOSS', 'PUSH']);
const VALID_MARKETS = new Set(['OVER', 'BTTS', 'OTHER']);

function computeBetProfit(stake, odds, result) {
  const s = Number(stake) || 0;
  const o = Number(odds) || 0;
  if (result === 'WIN') return Math.round(s * (o - 1) * 100) / 100;
  if (result === 'LOSS') return -s;
  return 0; // PUSH or PENDING
}

// When a bet is recorded, the stake leaves the bankroll immediately.
// Settlement adds back stake + profit (WIN) or stake (PUSH) — LOSS keeps
// the stake debited.
function deltaOnSettlement(stake, result) {
  const s = Number(stake) || 0;
  if (result === 'WIN' || result === 'PUSH') return s; // refund stake (WIN also gets profit separately)
  return 0;
}

async function getOrInitBankroll(userId) {
  const rows = await sql()`SELECT * FROM bankrolls WHERE user_id = ${userId}`;
  return rows[0] || null;
}

function shapeBankroll(row) {
  if (!row) return null;
  return {
    id: row.id,
    startingAmount: Number(row.starting_amount),
    currentAmount: Number(row.current_amount),
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function shapeEntry(row) {
  return {
    id: row.id,
    type: row.type,
    market: row.market || null,
    stake: row.stake != null ? Number(row.stake) : null,
    odds: row.odds != null ? Number(row.odds) : null,
    result: row.result,
    profitLoss: Number(row.profit_loss || 0),
    balanceBefore: Number(row.balance_before),
    balanceAfter: Number(row.balance_after),
    notes: row.notes || null,
    predictionId: row.prediction_id || null,
    createdAt: row.created_at,
  };
}

// Settle a single PENDING entry against an already-known prediction outcome.
// Updates the entry's result/profit_loss/balance_after and bumps the
// bankroll. Returns the updated entry shape, or null if it was already
// settled / shouldn't be touched.
async function settlePendingEntry(entry, prediction) {
  if (!entry || entry.result !== 'PENDING') return null;
  if (!prediction) return null;

  let won = null;
  if (entry.market === 'OVER' && prediction.over_hit !== null && prediction.over_hit !== undefined) {
    won = !!prediction.over_hit;
  } else if (entry.market === 'BTTS' && prediction.btts_hit !== null && prediction.btts_hit !== undefined) {
    won = !!prediction.btts_hit;
  }
  if (won === null) return null;

  const result = won ? 'WIN' : 'LOSS';
  const profit = computeBetProfit(entry.stake, entry.odds, result);
  // Bankroll change: stake was already debited when entry was created.
  // On WIN, add stake + profit back. On LOSS, nothing more.
  const refund = won ? Number(entry.stake) + profit : 0;

  const [bk] = await sql()`SELECT current_amount FROM bankrolls WHERE user_id = ${entry.user_id}`;
  if (!bk) return null;
  const newBalance = Number(bk.current_amount) + refund;

  await sql()`
    UPDATE bankroll_entries
    SET result = ${result},
        profit_loss = ${profit},
        balance_after = ${newBalance}
    WHERE id = ${entry.id}`;
  await sql()`
    UPDATE bankrolls
    SET current_amount = ${newBalance}, updated_at = NOW()
    WHERE user_id = ${entry.user_id}`;

  return { entryId: entry.id, result, profit, newBalance };
}

// Settle every PENDING entry that points at this prediction.
async function settleEntriesForPrediction(predictionId) {
  const [prediction] = await sql()`
    SELECT id, over_hit, btts_hit FROM predictions WHERE id = ${predictionId}`;
  if (!prediction) return [];
  const entries = await sql()`
    SELECT id, user_id, market, stake, odds, result
    FROM bankroll_entries
    WHERE prediction_id = ${predictionId} AND result = 'PENDING'`;
  const out = [];
  for (const e of entries) {
    const res = await settlePendingEntry(e, prediction);
    if (res) out.push(res);
  }
  return out;
}

module.exports = {
  VALID_RESULTS,
  VALID_MARKETS,
  computeBetProfit,
  deltaOnSettlement,
  getOrInitBankroll,
  shapeBankroll,
  shapeEntry,
  settlePendingEntry,
  settleEntriesForPrediction,
};
