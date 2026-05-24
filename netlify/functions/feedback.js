// /api/feedback — per-user 1–5 star ratings on individual predictions.
//
// POST /api/feedback
//   Body: { predictionId, rating (1-5), comment? }
//   Auth: required (cookie session)
//   Returns: { success: true, id }
//   Idempotency: (user_id, prediction_id) is UNIQUE in the DB. A second
//                POST from the same user upserts (so the user can change
//                their star rating); we return 200 in both cases.
//
// GET /api/feedback/my
//   Auth: required
//   Returns: { feedback: [{ id, predictionId, rating, comment, createdAt,
//                           homeTeam, awayTeam, kickoff }] }
//   Joins the feedback row to its prediction so the frontend can show
//   "you rated Portland vs Seattle 4 stars" without a second round-trip.
//
// These are public-facing endpoints — auth is mandatory. The
// feedback table cascades on user/prediction delete, so a churned
// user's feedback is removed automatically when their row goes.

const { sql } = require('./_shared/db');
const { json, error, notFound, methodNotAllowed, parseBody, subPath } = require('./_shared/response');
const { requireUser } = require('./_shared/auth-mw');

function isMissingTableErr(err) {
  return (
    err &&
    (err.code === '42P01' ||
      /relation "?feedback"? does not exist/i.test(err.message || ''))
  );
}

async function handlePost(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;

  const body = parseBody(event);
  const predictionId = String(body.predictionId || '').trim();
  const rating = parseInt(body.rating, 10);
  const comment = body.comment ? String(body.comment).slice(0, 1000) : null;

  if (!predictionId) return error(400, 'predictionId required');
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return error(400, 'rating must be an integer 1-5');
  }

  // Verify the prediction actually exists before inserting. Cheap guard
  // that produces a 404 instead of a generic FK violation.
  let predRow;
  try {
    const rows = await sql()`SELECT id FROM predictions WHERE id = ${predictionId} LIMIT 1`;
    predRow = rows[0];
  } catch (err) {
    return error(500, err.message || 'DB lookup failed');
  }
  if (!predRow) return error(404, 'Prediction not found');

  try {
    const ins = await sql()`
      INSERT INTO feedback (user_id, prediction_id, rating, comment)
      VALUES (${user.id}, ${predictionId}, ${rating}, ${comment})
      ON CONFLICT (user_id, prediction_id) DO UPDATE SET
        rating  = EXCLUDED.rating,
        comment = EXCLUDED.comment,
        created_at = NOW()
      RETURNING id`;
    return json(200, { success: true, id: ins[0] && ins[0].id });
  } catch (err) {
    if (isMissingTableErr(err)) {
      return error(503, 'feedback table missing — run run-migration.sql');
    }
    console.error('[feedback POST] failed:', err.message);
    return error(500, err.message || 'feedback insert failed');
  }
}

async function handleGetMy(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  try {
    const rows = await sql()`
      SELECT f.id, f.prediction_id, f.rating, f.comment, f.created_at,
             p.home_team, p.away_team, p.kickoff,
             p.over_line, p.over_confidence, p.btts, p.btts_confidence
      FROM feedback f
      JOIN predictions p ON p.id = f.prediction_id
      WHERE f.user_id = ${user.id}
      ORDER BY f.created_at DESC
      LIMIT 10`;
    const out = rows.map((r) => ({
      id: r.id,
      predictionId: r.prediction_id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.created_at,
      prediction: {
        homeTeam: r.home_team,
        awayTeam: r.away_team,
        kickoff: r.kickoff,
        over: { line: r.over_line, confidence: r.over_confidence },
        btts: { prediction: r.btts, confidence: r.btts_confidence },
      },
    }));
    return json(200, { feedback: out });
  } catch (err) {
    if (isMissingTableErr(err)) return json(200, { feedback: [] });
    console.error('[feedback GET my] failed:', err.message);
    return error(500, err.message || 'feedback fetch failed');
  }
}

exports.handler = async (event) => {
  try {
    if (event && event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    const path = subPath(event, 'feedback');
    const method = event && event.httpMethod;
    if (method === 'POST' && (path === '/' || path === '')) {
      return await handlePost(event);
    }
    if (method === 'GET' && (path === '/my' || path === '/my/')) {
      return await handleGetMy(event);
    }
    if (method && method !== 'GET' && method !== 'POST') return methodNotAllowed();
    return notFound();
  } catch (err) {
    console.error('feedback handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
