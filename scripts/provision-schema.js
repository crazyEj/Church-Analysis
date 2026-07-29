'use strict';

/**
 * scripts/provision-schema.js
 *
 * Runs all model DDL statements against the configured database, in
 * correct foreign-key dependency order: campuses -> households ->
 * individuals -> check_ins. Safe to re-run (every DDL uses IF NOT EXISTS).
 *
 * Usage:
 *   node scripts/provision-schema.js
 *
 * Requires TimescaleDB extension to be installed on the target
 * database for the check_ins hypertable conversion:
 *   CREATE EXTENSION IF NOT EXISTS timescaledb;
 */

const { pool, query } = require('../config/database');
const Campus = require('../src/core/models/Campus');
const Household = require('../src/core/models/Household');
const Individual = require('../src/core/models/Individual');
const CheckIn = require('../src/core/models/CheckIn');

async function provision() {
  console.log('[provision-schema] Ensuring TimescaleDB extension is available...');
  await query('CREATE EXTENSION IF NOT EXISTS timescaledb;');

  const modelsInOrder = [Campus, Household, Individual, CheckIn];

  for (const model of modelsInOrder) {
    console.log(`[provision-schema] Applying DDL for ${model.TABLE_NAME}...`);
    // eslint-disable-next-line no-await-in-loop
    await query(model.DDL);
  }

  console.log('[provision-schema] Schema provisioning complete.');
  await pool.end();
}

provision().catch((err) => {
  console.error('[provision-schema] Failed:', err);
  process.exitCode = 1;
});