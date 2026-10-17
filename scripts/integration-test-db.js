'use strict';
/**
 * Step 54 — reproducible database integration tests.
 *
 * Guarantees for `npm run test:integration`:
 *  1. The target must be a LOCAL database whose name contains "test"
 *     (production / non-local / prod-like names are refused).
 *  2. Migrations are applied before any test runs (`prisma migrate deploy`).
 *  3. All test data is truncated so every run starts from a clean schema
 *     and re-runs are repeatable.
 */
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const FORBIDDEN_DB = /prod|live|staging|main/i;
const DEFAULT_URL =
  'postgresql://phantom:phantom@localhost:5432/phantom_permission_test';

function parseDatabaseUrl(url) {
  const match = /^(?:postgres|postgresql):\/\/[^@/]+@([^:/?]+)(?::\d+)?\/([^?\s]+)/.exec(
    url || '',
  );
  if (!match) {
    throw new Error(`[integration-db] unparseable DATABASE_URL: ${url}`);
  }
  return { host: match[1], database: decodeURIComponent(match[2]) };
}

/** Refuse anything that is not a local, clearly-test database. */
function assertTestDatabase(url, env = process.env) {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      '[integration-db] refusing to run integration tests with NODE_ENV=production',
    );
  }
  const { host, database } = parseDatabaseUrl(url);
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `[integration-db] refusing non-local host "${host}" — integration tests only run against localhost`,
    );
  }
  if (FORBIDDEN_DB.test(database)) {
    throw new Error(
      `[integration-db] refusing database "${database}" — looks like a non-test database`,
    );
  }
  if (!/test/i.test(database)) {
    throw new Error(
      `[integration-db] refusing database "${database}" — name must contain "test" (e.g. phantom_permission_test)`,
    );
  }
  return database;
}

function applyMigrations(url) {
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(cmd, ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: url },
  });
  if (result.status !== 0) {
    throw new Error(
      `[integration-db] prisma migrate deploy failed (status ${result.status})`,
    );
  }
}

/** Truncate every public table (keeping migration bookkeeping) for a clean run. */
async function resetTestData(url) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length > 0) {
      const list = rows
        .map((r) => `"public"."${r.tablename}"`)
        .join(', ');
      await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await client.end();
  }
}

async function setup() {
  const url = process.env.DATABASE_URL || DEFAULT_URL;
  assertTestDatabase(url); // throws before any connection is made
  process.env.DATABASE_URL = url; // propagates to Jest workers
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';
  applyMigrations(url);
  await resetTestData(url);
}

async function teardown() {
  const url = process.env.DATABASE_URL || DEFAULT_URL;
  assertTestDatabase(url);
  await resetTestData(url);
}

module.exports = { setup, teardown, assertTestDatabase, DEFAULT_URL };