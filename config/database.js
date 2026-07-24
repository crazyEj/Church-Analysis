'use strict';

/**
 * config/database.js
 *
 * Central PostgreSQL / TimescaleDB connection pool.
 * All modules must obtain their DB access through this file — no module
 * should instantiate its own `pg.Pool`. This keeps connection limits,
 * SSL config, and query instrumentation centralized.
 */

const { Pool } = require('pg');

const requiredEnvVars = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];

function assertEnv() {
  const missing = requiredEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    // Fail loudly the moment a DB operation is actually attempted —
    // NOT at module-require time. Many files under src/core and
    // src/modules co-locate pure math functions alongside DB-backed
    // ones in the same module; eagerly validating env vars on require()
    // would make those pure functions un-importable (and therefore
    // un-unit-testable) without a live DB connection configured.
    throw new Error(
      `[database] Missing required environment variables: ${missing.join(', ')}. ` +
        'Copy .env.example to .env and populate connection details.'
    );
  }
}

let _pool = null;

/**
 * Lazily construct (once) and return the shared connection pool.
 * Deferring construction until first actual use means importing this
 * module — or any module that requires it — never fails just because
 * `.env` hasn't been configured yet, which matters for pure-function
 * unit tests that import a file for its non-DB exports.
 *
 * @returns {import('pg').Pool}
 */
function getPool() {
  if (_pool) return _pool;

  assertEnv();

  _pool = new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: Number(process.env.PG_POOL_MAX || 20),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS || 5000),
    ssl:
      process.env.PGSSL === 'true'
        ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' }
        : false,
  });

  _pool.on('error', (err) => {
    // Unexpected error on an idle client — log and let the process
    // supervisor (pm2 / k8s liveness probe / etc.) decide whether to restart.
    // eslint-disable-next-line no-console
    console.error('[database] Unexpected error on idle client', err);
  });

  return _pool;
}

// Backwards/forwards-compatible accessor: consumers that do
// `const { pool } = require('.../database')` get a Proxy that
// transparently forwards to the lazily-constructed real pool on first
// property access, preserving the simple `pool.query(...)` call style
// used in scripts/provision-schema.js without forcing eager construction.
const pool = new Proxy(
  {},
  {
    get(_target, prop) {
      const realPool = getPool();
      const value = realPool[prop];
      return typeof value === 'function' ? value.bind(realPool) : value;
    },
  }
);

/**
 * Execute a parameterized query. Always prefer this over raw pool.query
 * calls scattered across services, so slow-query logging stays centralized.
 *
 * @param {string} text - SQL text with $1, $2... placeholders.
 * @param {Array<any>} params - Bound parameters (never string-interpolate values).
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params = []) {
  const start = process.hrtime.bigint();
  try {
    const result = await getPool().query(text, params);
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    if (durationMs > Number(process.env.SLOW_QUERY_THRESHOLD_MS || 500)) {
      // eslint-disable-next-line no-console
      console.warn(`[database] Slow query (${durationMs.toFixed(1)}ms): ${text.slice(0, 200)}`);
    }
    return result;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[database] Query failed:', text.slice(0, 200), params, err.message);
    throw err;
  }
}

/**
 * Run a set of operations inside a single transaction. `fn` receives a
 * client bound to the transaction; use `client.query` inside it.
 *
 * @param {(client: import('pg').PoolClient) => Promise<any>} fn
 */
async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, getPool, query, withTransaction };