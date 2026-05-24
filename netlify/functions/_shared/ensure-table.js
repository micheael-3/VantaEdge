// Lightweight "make sure this table exists" helper. Each new feature
// can call ensureTable('feature_key', 'CREATE TABLE IF NOT EXISTS ...')
// at the top of its handler — the SQL runs once per Lambda cold start
// (cheap, idempotent) and is then memoised in-process.
//
// Why this exists: when a new schema lands but Neon hasn't been
// migrated yet, the user-facing endpoints used to return errors or
// silently degrade. With this helper the table self-heals the first
// time any request touches it. Admin can still hit /api/admin/migrate
// for the canonical full-schema pass — this is the safety net for
// piecewise additions.

const { sql } = require('./db');

// Module-scope cache. Lives for the lifetime of the Lambda instance.
const _ensured = new Set();
const _inflight = new Map();

async function execRaw(stmt) {
  const sqlFn = sql();
  const parts = [stmt];
  parts.raw = [stmt];
  return await sqlFn(parts);
}

// `key`  — short stable identifier so repeated calls (concurrent or
//          sequential) all coalesce on the same in-flight promise.
// `ddl`  — full CREATE TABLE / CREATE INDEX statement(s). Must be
//          idempotent (IF NOT EXISTS). May be a single string or an
//          array of statements to run in order.
async function ensureTable(key, ddl) {
  if (_ensured.has(key)) return;
  // De-dupe concurrent first calls.
  if (_inflight.has(key)) return _inflight.get(key);
  const work = (async () => {
    try {
      const statements = Array.isArray(ddl) ? ddl : [ddl];
      for (const stmt of statements) {
        await execRaw(stmt);
      }
      _ensured.add(key);
    } catch (err) {
      // Don't poison the in-flight cache — let the next call try again.
      // Log so we can spot DDL drift without it blowing up the request.
      console.warn(`[ensureTable:${key}] DDL failed, will retry next request:`, err.message);
      throw err;
    } finally {
      _inflight.delete(key);
    }
  })();
  _inflight.set(key, work);
  return work;
}

module.exports = { ensureTable };
