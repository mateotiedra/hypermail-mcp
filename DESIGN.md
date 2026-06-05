# DB Config Migration — Design

## 1. ModePlugin Interface

The `ModePlugin` is a single abstraction that encapsulates every behavioral difference
between solo and multi mode. `server.ts` delegates to it at specific hook points.
The rest of the codebase (tools, providers, watcher) is unchanged.

### Divergence Map

Every point in the current `server.ts` where solo and multi differ:

| # | Hook point | Solo | Multi |
|---|---|---|---|
| 1 | Store creation | `FileAccountStore` + `FileAgentStore` (optional) | `DbAccountStore` + `DbAgentStore` |
| 2 | Agent bootstrap | `agents.yaml` + live-reload watcher | DB (admin API is the management surface) |
| 3 | MCP session auth | None (AgentContext = null), or x-api-key via file AgentStore | x-api-key via DB AgentStore |
| 4 | Admin HTTP routes | None | `/admin/*` CRUD protected by `HYPERMAIL_ADMIN_KEY` |
| 5 | Watcher account filter | From file AgentStore agents | From DB AgentStore agents |
| 6 | Config validation | Standard config | Requires `DATABASE_URL`, `HYPERMAIL_ENCRYPTION_KEY` |
| 7 | DB lifecycle | None | Pool connect, migrate, health-check, close |

### Interface

```typescript
// ── Auth error ──

/** Thrown by authenticate() on auth failure. Caught by the HTTP handler. */
class AuthError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

// ── Store interfaces (shared by file and DB implementations) ──

interface IAccountStore {
  listAccounts(): AccountRecord[];
  getAccount(email: string): AccountRecord | undefined;
  upsertAccount(rec: AccountRecord): Promise<AccountRecord>;
  removeAccount(email: string): Promise<boolean>;
}

interface IAgentStore {
  listAgents(): AgentRecord[];
  getAgent(id: string): AgentRecord | undefined;
  findAgentByApiKey(apiKey: string): AgentRecord | undefined;
  upsertAgent(rec: UpsertAgentInput): Promise<AgentRecord>;
  removeAgent(id: string): Promise<boolean>;
  assignAccount(agentId: string, email: string): Promise<AgentRecord>;
  unassignAccount(agentId: string, email: string): Promise<AgentRecord>;
}

// ── Plugin ──

interface ModePlugin {
  readonly mode: "solo" | "multi";

  /**
   * One-time initialization. Called before stores are created.
   * Multi mode: connects to DB, runs migrations. Crashes if DB unreachable.
   * Solo mode: no-op.
   */
  init(): Promise<void>;

  /**
   * Cleanup before process exit.
   * Multi mode: closes DB pool.
   * Solo mode: no-op.
   */
  close(): Promise<void>;

  /**
   * Create the account store implementation for this mode.
   * Solo: file-backed (accounts.json.enc).
   * Multi: DB-backed (accounts table, ciphertext tokens).
   */
  createAccountStore(dataDir?: string): Promise<IAccountStore>;

  /**
   * Create the agent store implementation. Returns null if multi-agent
   * support is not enabled (solo mode with no agents.yaml).
   * Solo: file-backed if agents.yaml is configured, else null.
   * Multi: DB-backed, always present.
   */
  createAgentStore(dataDir?: string): Promise<IAgentStore | null>;

  /**
   * Authenticate an incoming HTTP request for MCP session init.
   * Called once per new session (not per request — MCP sessions persist).
   *
   * Returns:
   *   - AgentContext — authenticated, attach to session
   *   - null — no auth required for this mode (solo)
   *   - throws AuthError — auth failed (401 with message)
   */
  authenticate(req: IncomingMessage): Promise<AgentContext | null>;

  /**
   * Handle an HTTP request to /admin/*.
   * Called for every request whose URL starts with "/admin".
   * Plugin is responsible for auth, routing, and response.
   *
   * Returns true if the request was handled (response already sent).
   * If returns false, the server falls through to 404.
   * If undefined, the server returns 404 immediately (no admin support).
   */
  handleAdminRequest?(req: IncomingMessage, res: ServerResponse): Promise<boolean>;

  /**
   * Compute the account filter for the email watcher.
   * Returns an array of email addresses to poll, or undefined to poll all.
   * Derived from the agent store's authorized accounts.
   *
   * Solo: from file agent store (if present), else undefined.
   * Multi: from DB agent store, always present.
   */
  getWatcherAccountFilter?(): Promise<string[] | undefined>;
}
```

### Server Refactor — Hook Points

The refactored `server.ts` flow (pseudocode):

```typescript
async function startServer(config, plugin: ModePlugin) {
  // 1. Init plugin (DB connect + migrate in multi mode)
  await plugin.init();

  // 2. Create stores via plugin
  const accountStore = await plugin.createAccountStore(config.dataDir);
  const agentStore = await plugin.createAgentStore(config.dataDir);

  // 3. Build registry, resolve tools (unchanged from current)
  const registry = buildRegistry({ store: accountStore, providers: config.providers });
  const tools = resolveTools(config);

  // 4. Watcher setup (unchanged logic, uses plugin for filter)
  const watchEnabled = config.http.enabled && config.watch?.enabled !== false;
  const notificationBuffer = watchEnabled ? [] : undefined;

  // 5. MCP server factory (unchanged)
  const createServer = (agentContext) => { /* same as current */ };

  if (config.http.enabled) {
    // Watcher account filter via plugin
    const accountFilter = plugin.getWatcherAccountFilter
      ? await plugin.getWatcherAccountFilter()
      : undefined;

    if (watchEnabled) { /* start watcher */ }

    // 6. HTTP server — auth + admin delegated to plugin
    await startHttp(createServer, config, plugin, notifyTargets, agentStore);
  } else {
    // Stdio (unchanged)
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}
```

And the HTTP request handler becomes:

```typescript
const http = createHttpServer(async (req, res) => {
  try {
    // ── Admin routes (multi mode only) ──
    if (req.url?.startsWith("/admin")) {
      if (plugin.handleAdminRequest) {
        const handled = await plugin.handleAdminRequest(req, res);
        if (handled) return;
      }
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    // ── MCP routes ──
    if (!req.url?.startsWith("/mcp")) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    // ... session lookup ...

    if (!session) {
      // ── Auth via plugin ──
      let agentContext: AgentContext | null = null;
      try {
        agentContext = await plugin.authenticate(req);
      } catch (err) {
        if (err instanceof AuthError) {
          res.statusCode = err.statusCode;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
        throw err;
      }

      // ... create session (unchanged) ...
    }

    // ... handle request (unchanged) ...
  }
});
```

### CLI Changes

```typescript
// New --mode flag
case "--mode":
  out.mode = String(argv[++i] ?? "solo") as "solo" | "multi";
  break;

// Multi mode validation
if (opts.mode === "multi") {
  if (!process.env.DATABASE_URL) {
    console.error("Fatal: --mode multi requires DATABASE_URL env var");
    process.exit(1);
  }
  if (!process.env.HYPERMAIL_ENCRYPTION_KEY) {
    console.error("Fatal: --mode multi requires HYPERMAIL_ENCRYPTION_KEY env var");
    process.exit(1);
  }
  // Multi mode implicitly enables HTTP
  opts.http = true;
}
```

## 2. PostgreSQL Schema

```sql
-- Migrations tracking (versioned, idempotent)
CREATE TABLE IF NOT EXISTS _migrations (
  version   INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agents
CREATE TABLE IF NOT EXISTS agents (
  id           TEXT PRIMARY KEY,          -- e.g. "my-agent"
  api_key_hash TEXT NOT NULL,             -- "salt:hash" (scrypt, hex)
  name         TEXT NOT NULL,             -- display name
  accounts     JSONB NOT NULL DEFAULT '[]', -- ["alice@ex.com", "bob@ex.com"]
  provisioning BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Accounts (email accounts, not agents)
CREATE TABLE IF NOT EXISTS accounts (
  email        TEXT PRIMARY KEY,          -- normalized lowercase
  provider     TEXT NOT NULL,             -- "outlook" | "imap" | "gmail"
  display_name TEXT,
  tokens_enc   BYTEA NOT NULL,            -- AES-256-GCM ciphertext (provider tokens)
  signature    TEXT,                      -- HTML signature
  style        JSONB,                     -- { fontFamily?, fontSize?, fontColor? }
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  last_seen_ids JSONB NOT NULL DEFAULT '[]' -- recent email ids (capped at 200)
);

CREATE INDEX idx_accounts_provider ON accounts(provider);
```

**Design decisions:**
- `accounts` on agent table uses JSONB (string array) — simple, no join needed for the common case
- `style` uses JSONB — mirrors the current `AccountRecord.style` shape
- `tokens_enc` is BYTEA — stores the full AES-256-GCM ciphertext (iv + tag + ct) as produced by the existing `encrypt()` function
- `last_seen_ids` uses JSONB — string array, same as current file-based store

## 3. Admin API Routes

All under `/admin`, protected by bearer token from `HYPERMAIL_ADMIN_KEY` env var.

```
GET    /admin/agents           → list all agents (no api_key_hash exposed)
POST   /admin/agents           → create agent { id, api_key, name, accounts?, provisioning? }
DELETE /admin/agents/:id       → remove agent

GET    /admin/accounts          → list all email accounts
DELETE /admin/accounts/:email  → remove email account
```

Auth: `Authorization: Bearer <HYPERMAIL_ADMIN_KEY>` header.
If missing or wrong → 401 `{"error": "Unauthorized"}`.
If `HYPERMAIL_ADMIN_KEY` is not set → admin routes return 404 (not exposed).

**Agent creation flow:**
1. Client sends `{ id, api_key, name, accounts?, provisioning? }`
2. Server validates `api_key` format (`hm_sk_` prefix + 64 hex chars)
3. Server scrypt-hashes the plaintext key
4. Inserts into `agents` table
5. Returns the agent (without api_key_hash)

## 4. Migration Strategy

**Clean slate only.** No auto-migration from file-based stores to DB.

Rationale:
- File-based store is encrypted — would need to decrypt, then re-encrypt with different key
- Agents are re-created via admin API (manual bootstrap via one-time script if needed)
- Account tokens are tied to OAuth flows — users re-add accounts
- Simplifies implementation, avoids fragile one-time migration code

## 5. In-Memory Cache Strategy

**No cache for now.** Each store call hits the DB directly.

Rationale:
- The MCP server handles one request at a time per session
- Agent lookup (findAgentByApiKey) happens once per session init — not per request
- Account operations (listAccounts, getAccount) are infrequent — polling interval is 60s minimum
- Premature optimization — add caching only if profiling shows it's needed

## 6. Encryption Key

Multi mode requires `HYPERMAIL_ENCRYPTION_KEY` env var. This key encrypts OAuth tokens
(provider secrets) before storing in the `accounts.tokens_enc` column.

Format: 64 hex chars (32 bytes) or base64-encoded 32 bytes (same as current `HYPERMAIL_MCP_KEY`).
The existing `parseEnvKey()` function from `crypto.ts` handles both formats.

This is a SEPARATE key from `HYPERMAIL_ADMIN_KEY` (which protects the admin API).
The encryption key should never be exposed via any API.
