const { neon } = require('@neondatabase/serverless');

let _sql = null;

function sql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

async function queryOne(strings, ...values) {
  const rows = await sql()(strings, ...values);
  return rows[0] || null;
}

module.exports = { sql, queryOne };
