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
// intact. Strips line comments (-- ...) BEFORE the char-by-char scan so
// semicolons inside comments (e.g. "daily cache; one row per date")
// can't break a CREATE TABLE in half. Then splits on `;` when we're
// outside a $$ block and outside a '...' string literal.
function splitSql(rawSql) {
  const cleaned = rawSql
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('--')) return '';
      // Strip trailing line comments too: "-- foo" after some SQL
      const idx = findLineCommentStart(line);
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');

  const statements = [];
  let buf = '';
  let inDollar = false;
  let inSingleQuote = false;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    const next = cleaned[i + 1];
    if (!inSingleQuote && c === '$' && next === '$') {
      inDollar = !inDollar;
      buf += '$$';
      i += 1;
      continue;
    }
    if (!inDollar && c === "'") {
      inSingleQuote = !inSingleQuote;
      buf += c;
      continue;
    }
    if (c === ';' && !inDollar && !inSingleQuote) {
      const stmt = buf.trim();
      if (stmt) statements.push(stmt);
      buf = '';
      continue;
    }
    buf += c;
  }
  const tail = buf.trim();
  if (tail) statements.push(tail);
  return statements;
}

// Returns the index of a `--` line-comment start that isn't inside a
// single-quoted string on the same line. Returns -1 if no comment.
function findLineCommentStart(line) {
  let inQuote = false;
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] === "'") inQuote = !inQuote;
    if (!inQuote && line[i] === '-' && line[i + 1] === '-') return i;
  }
  return -1;
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
  // Outer try/catch: fs read failures, schema-splitter throws, or any
  // other unexpected error becomes a real 500 with a message instead of
  // Netlify's default 502 empty body.
  try {
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
  } catch (err) {
    console.error('[migrate] fatal:', err);
    return jsonResp(500, { error: err.message || 'Internal error' });
  }
};

function jsonResp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body, null, 2),
  };
}
