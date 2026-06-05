import type { Pool, PoolClient, QueryResultRow } from "pg";

let pool: Pool | null = null;

/**
 * Get or create the connection pool. Uses dynamic import so `pg` is only
 * loaded in multi mode — solo mode never touches this module.
 */
export async function getPool(): Promise<Pool> {
  if (pool) return pool;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for multi mode. " +
        "Set it to a PostgreSQL connection string, e.g. " +
        "postgresql://user:pass@localhost:5432/hypermail",
    );
  }

  // Dynamic import — `pg` is not bundled into the solo-mode path.
  const { Pool: PgPool } = await import("pg");

  pool = new PgPool({
    connectionString: databaseUrl,
    max: 5, // conservative — one session at a time per agent
    idleTimeoutMillis: 30_000,
  });

  // Handle pool errors (e.g. DB goes down after initial connect)
  pool.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[hypermail-mcp] pg pool error:", err.message);
  });

  return pool;
}

/**
 * Verify the DB is reachable. Called once on startup in multi mode.
 * Throws immediately if the connection fails — crash-fast behavior.
 */
export async function healthCheck(): Promise<void> {
  const p = await getPool();
  let client: PoolClient | undefined;
  try {
    client = await p.connect();
    await client.query("SELECT 1");
  } catch (err) {
    throw new Error(
      `PostgreSQL health check failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  } finally {
    client?.release();
  }
}

/**
 * Run a single query and return rows. Lightweight wrapper.
 */
export async function query<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const p = await getPool();
  const result = await p.query<T>(text, params);
  return result.rows;
}

/**
 * Run a query and return the first row, or undefined.
 */
export async function queryOne<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}

/**
 * Close the pool. Called on shutdown in multi mode.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
