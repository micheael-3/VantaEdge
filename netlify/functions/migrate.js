// One-shot DB migration runner. Reads schema.sql (bundled via
// included_files in netlify.toml) and executes every statement against
// Neon. Every statement in schema.sql is idempotent (CREATE ... IF NOT
// EXISTS, ALTER TABLE ... ADD COLUMN IF NOT EXISTS, DO blocks that swallow
// duplicate_object), so the endpoint is safe to hit repeatedly.
//
// Usage: GET /api/migrate?key=<ADMIN_PASSWORD>
//
// Returns a JSON report listing every statement, whether it succeeded,
// and the Postgres error message for any that didn't.

const fs = require('fs');
const path = require('path');
const { sql } = require('./_shared/db');

// Smart splitter aware of $$ ... $$ PL/pgSQL blocks so DO blocks stay
// intact. Splits on `;` only when we're not inside a $$ block. Drops
// pure comment lines (-- ...) but preserves inline comments.
function splitSql(rawSql) {
  const statements = [];
  let buf = '';
  let inDollar = false;
  for (let i = 0; i < rawSql.length; i++) {
    const c = rawSql[i];
    const next = rawSql[i + 1];
    if (c === '$' && next === '$') {
      inDollar = !inDollar;
      buf += '$$';
      i += 1;
      continue;
    }
    if (c === ';' && !inDollar) {
      const stmt = stripCommentLines(buf).trim();
      if (stmt) statements.push(stmt);
      buf = '';
      continue;
    }
    buf += c;
  }
  const tail = stripCommentLines(buf).trim();
  if (tail) statements.push(tail);
  return statements;
}

function stripCommentLines(s) {
  return s
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

// Execute a single raw SQL statement against Neon. The serverless driver's
// tagged-template callable also accepts a fake strings array as the first
// argument, which is the documented escape hatch for running unparameterised
// DDL. We use that here.
async function execRaw(stmt) {
  const sqlFn = sql();
  // Build a TemplateStringsArray-like object: an array with a `raw` field.
  const parts = [stmt];
  parts.raw = [stmt];
  return await sqlFn(parts);
}

exports.handler = async (event) => {
  // Auth: must pass ?key=<ADMIN_PASSWORD>
  const params = event.queryStringParameters || {};
  const supplied = params.key || '';
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected) {
    return jsonResp(500, { error: 'ADMIN_PASSWORD is not set on the server.' });
  }
  if (supplied !== expected) {
    return jsonResp(401, { error: 'Unauthorized. Append ?key=<ADMIN_PASSWORD> to the URL.' });
  }

  // Load schema.sql — it's bundled into the function by netlify.toml.
  let schemaPath = path.join(__dirname, '..', '..', 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    // Netlify Functions sometimes sits the file relative to the function root.
    const alt = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(alt)) schemaPath = alt;
    else return jsonResp(500, { error: `schema.sql not found at ${schemaPath} or ${alt}` });
  }
  const rawSql = fs.readFileSync(schemaPath, 'utf8');
  const statements = splitSql(rawSql);

  const results = [];
  let okCount = 0;
  let failCount = 0;

  for (const stmt of statements) {
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 120);
    try {
      await execRaw(stmt);
      results.push({ ok: true, stmt: preview });
      okCount += 1;
    } catch (err) {
      // Idempotent statements may still complain (e.g. CREATE INDEX
      // CONCURRENTLY conflicts). We surface the error but keep going so a
      // single bad row doesn't abort the rest of the migration.
      results.push({ ok: false, stmt: preview, error: err.message });
      failCount += 1;
    }
  }

  return jsonResp(200, {
    summary: { total: statements.length, ok: okCount, failed: failCount },
    schemaPath,
    results,
  });
};

function jsonResp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body, null, 2),
  };
}
