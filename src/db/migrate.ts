import { query, queryOne } from "./connection.js";

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "initial-schema",
    sql: `
      -- Agents table
      CREATE TABLE IF NOT EXISTS agents (
        id           TEXT PRIMARY KEY,
        api_key_hash TEXT NOT NULL,
        name         TEXT NOT NULL,
        accounts     JSONB NOT NULL DEFAULT '[]',
        provisioning BOOLEAN NOT NULL DEFAULT false,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Email accounts table
      CREATE TABLE IF NOT EXISTS accounts (
        email        TEXT PRIMARY KEY,
        provider     TEXT NOT NULL,
        display_name TEXT,
        tokens_enc   BYTEA NOT NULL,
        signature    TEXT,
        style        JSONB,
        added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ,
        last_seen_ids JSONB NOT NULL DEFAULT '[]'
      );

      CREATE INDEX IF NOT EXISTS idx_accounts_provider ON accounts(provider);
    `,
  },
];

/**
 * Ensure the _migrations tracking table exists, then run any pending
 * migrations in version order. Idempotent — safe to call on every startup.
 */
export async function runMigrations(): Promise<void> {
  // Create tracking table if it doesn't exist (bootstrap)
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Find the latest applied version
  const last = await queryOne<{ version: number }>(
    `SELECT version FROM _migrations ORDER BY version DESC LIMIT 1`,
  );

  const appliedVersion = last?.version ?? 0;

  // Run pending migrations in order
  const pending = migrations
    .filter((m) => m.version > appliedVersion)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    // eslint-disable-next-line no-console
    console.error(
      `[hypermail-mcp] Running migration ${migration.version}: ${migration.name}`,
    );

    await query(migration.sql);

    await query(
      `INSERT INTO _migrations (version, name) VALUES ($1, $2)`,
      [migration.version, migration.name],
    );

    // eslint-disable-next-line no-console
    console.error(
      `[hypermail-mcp] Migration ${migration.version} complete`,
    );
  }

  if (pending.length === 0) {
    // eslint-disable-next-line no-console
    console.error("[hypermail-mcp] DB migrations up to date");
  }
}
