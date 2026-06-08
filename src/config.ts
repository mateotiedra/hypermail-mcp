import { readFileSync } from "node:fs";
import { z } from "zod";

// ── Schema ──

const httpConfigSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().min(1).max(65535).default(3000),
  host: z.string().default("127.0.0.1"),
});

const toolsConfigSchema = z.object({
  disabled: z.array(z.string()).optional(),
  enabled: z.array(z.string()).optional(),
});

const outlookProviderSchema = z.object({
  clientId: z.string().optional(),
  tenantId: z.string().optional(),
});

const gmailProviderSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
});

const providersConfigSchema = z.object({
  outlook: outlookProviderSchema.optional(),
  gmail: gmailProviderSchema.optional(),
});

const watchConfigSchema = z.object({
  enabled: z.boolean().default(false),
  pollIntervalSeconds: z.number().int().min(10).max(3600).default(10),
  webhook: z
    .object({
      url: z.string(),
      retry: z
        .object({
          maxAttempts: z.number().int().min(1).max(10).default(5),
          baseDelayMs: z.number().int().min(100).default(1000),
        })
        .optional(),
    })
    .optional(),
});

const rawConfigSchema = z.object({
  dataDir: z.string().optional(),
  http: httpConfigSchema.optional(),
  tools: toolsConfigSchema.optional(),
  providers: providersConfigSchema.optional(),
  watch: watchConfigSchema.optional(),
});

// ── Types ──

export interface HttpConfig {
  enabled: boolean;
  port: number;
  host: string;
}

export interface ToolsConfig {
  disabled?: string[];
  enabled?: string[];
}

export interface OutlookProviderConfig {
  clientId?: string;
  tenantId?: string;
}

export interface GmailProviderConfig {
  clientId?: string;
  clientSecret?: string;
}

export interface ProvidersConfig {
  outlook?: OutlookProviderConfig;
  gmail?: GmailProviderConfig;
}

export interface WatchRetryConfig {
  /** Maximum number of webhook delivery attempts (default: 5). */
  maxAttempts: number;
  /** Base delay in milliseconds for exponential backoff (default: 1000). */
  baseDelayMs: number;
}

export interface WatchWebhookConfig {
  /** URL to POST new-email events to. */
  url: string;
  /** Retry configuration for failed deliveries. */
  retry: WatchRetryConfig;
}

export interface WatchConfig {
  /** Whether the email poll loop is enabled (default: false). */
  enabled: boolean;
  /** Seconds between inbox polls (min 10, default 10). */
  pollIntervalSeconds: number;
  /** Webhook delivery configuration. */
  webhook?: WatchWebhookConfig;
}

/** Fully resolved application configuration (after ${VAR} expansion and CLI merge). */
export interface AppConfig {
  dataDir?: string;
  http: HttpConfig;
  tools?: ToolsConfig;
  providers?: ProvidersConfig;
  watch?: WatchConfig;
}

/** CLI flags that can override config file values. */
export interface CliOverrides {
  http?: boolean;
  port?: number;
  host?: string;
  dataDir?: string;
}

// ── Known tool names ──

/**
 * Every tool that {@link registerTools} may register.
 * Used for validation — typos in tools.disabled / tools.enabled are caught at startup.
 */
// Legacy: `check_notifications` was removed in v0.7.0 but is kept here
// so existing configs that reference it don't break validation.
export const KNOWN_TOOLS = [
  "list_accounts",
  "add_account",
  "complete_add_account",
  "get_account_settings",
  "set_account_settings",
  "remove_account",
  "list_emails",
  "search_emails",
  "read_email",
  "read_attachment",
  "archive_email",
  "trash_email",
  "move_email",
  "mark_read",
  "mark_unread",
  "list_folders",
  "create_folder",
  "delete_folder",
  "rename_folder",
  "send_email",
  "draft_email",
  "edit_draft",
  "send_draft",
  "add_attachment_to_draft",
  "check_notifications",
] as const;

// ── Env var names ──

// Dedicated HYPERMAIL_* env vars — one per config field.
// Also keep legacy names (MS_CLIENT_ID, etc.) for backward compat.

const ENV_HTTP_ENABLED = "HYPERMAIL_HTTP_ENABLED";
const ENV_HTTP_PORT = "HYPERMAIL_HTTP_PORT";
const ENV_HTTP_HOST = "HYPERMAIL_HTTP_HOST";
const ENV_TOOLS_DISABLED = "HYPERMAIL_TOOLS_DISABLED";
const ENV_TOOLS_ENABLED = "HYPERMAIL_TOOLS_ENABLED";
const ENV_OUTLOOK_CLIENT_ID = "HYPERMAIL_PROVIDERS_OUTLOOK_CLIENT_ID";
const ENV_OUTLOOK_TENANT_ID = "HYPERMAIL_PROVIDERS_OUTLOOK_TENANT_ID";
const ENV_GMAIL_CLIENT_ID = "HYPERMAIL_PROVIDERS_GMAIL_CLIENT_ID";
const ENV_GMAIL_CLIENT_SECRET = "HYPERMAIL_PROVIDERS_GMAIL_CLIENT_SECRET";
const ENV_WATCH_ENABLED = "HYPERMAIL_WATCH_ENABLED";
const ENV_WATCH_POLL_INTERVAL = "HYPERMAIL_WATCH_POLL_INTERVAL";
const ENV_WATCH_WEBHOOK_URL = "HYPERMAIL_WATCH_WEBHOOK_URL";
const ENV_WATCH_WEBHOOK_RETRY_MAX_ATTEMPTS = "HYPERMAIL_WATCH_WEBHOOK_RETRY_MAX_ATTEMPTS";
const ENV_WATCH_WEBHOOK_RETRY_BASE_DELAY = "HYPERMAIL_WATCH_WEBHOOK_RETRY_BASE_DELAY_MS";

// Legacy env var names (backward compat — read only if dedicated var is unset)
const LEGACY_MS_CLIENT_ID = "MS_CLIENT_ID";
const LEGACY_MS_TENANT_ID = "MS_TENANT_ID";
const LEGACY_GOOGLE_CLIENT_ID = "GOOGLE_CLIENT_ID";
const LEGACY_GOOGLE_CLIENT_SECRET = "GOOGLE_CLIENT_SECRET";

// ── ${VAR} resolution ──

const ENV_VAR_RE = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

function resolveEnvVars(value: string): string {
  return value.replace(ENV_VAR_RE, (_match, name: string) => {
    return process.env[name] ?? "";
  });
}

/** Recursively resolve `${VAR}` placeholders in all string values. */
function deepResolve(obj: unknown): unknown {
  if (typeof obj === "string") return resolveEnvVars(obj);
  if (Array.isArray(obj)) return obj.map(deepResolve);
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      out[key] = deepResolve(val);
    }
    return out;
  }
  return obj;
}

// ── Type coercion helpers ──

/** Parse a boolean from an env-var string. Returns undefined if unrecognised. */
function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const lower = value.trim().toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes") return true;
  if (lower === "false" || lower === "0" || lower === "no" || lower === "") return false;
  return undefined;
}

/** Parse a positive integer from an env-var string. Returns undefined on parse failure. */
function parseIntSafe(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const n = Number.parseInt(trimmed, 10);
  return Number.isNaN(n) ? undefined : n;
}

/** Parse a comma-separated string into a trimmed, filtered array.
 *  Returns an empty array for empty/whitespace-only strings so callers
 *  can distinguish "set to empty" from "not set at all". */
function parseStringArray(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return [];
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ── Validation ──

function validateToolNames(
  toolNames: string[] | undefined,
  listName: string,
): void {
  if (!toolNames || toolNames.length === 0) return;
  const known = new Set<string>(KNOWN_TOOLS as readonly string[]);
  for (const name of toolNames) {
    if (!known.has(name)) {
      throw new Error(
        `Unknown tool "${name}" in ${listName}. Known tools: ${KNOWN_TOOLS.join(", ")}`,
      );
    }
  }
}

// ── Loading ──

/**
 * Load and validate `hypermail-config.json`.
 *
 * @param configPath  File path, or `undefined` to use defaults.
 * @param cliOverrides  CLI flags that take precedence over config file values.
 * @returns  A fully resolved {@link AppConfig}.
 */
export function loadConfig(
  configPath: string | undefined,
  cliOverrides: CliOverrides = {},
): AppConfig {
  let raw: Record<string, unknown> = {};

  if (configPath) {
    try {
      raw = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch (err) {
      const detail =
        err instanceof SyntaxError
          ? "Invalid JSON"
          : err instanceof Error
            ? err.message
            : String(err);
      throw new Error(`Failed to read config file "${configPath}": ${detail}`);
    }
  }

  // Resolve ${VAR} before zod validation so env-var references become real values.
  raw = deepResolve(raw) as Record<string, unknown>;

  // Validate structure
  const parsed = rawConfigSchema.parse(raw);

  // ── Env var resolution (fallback layer) ──
  // Fields unset in the config file are filled from HYPERMAIL_* env vars.
  // Priority: CLI > config file > env var > hardcoded default.

  // -- HTTP --
  const http: HttpConfig = {
    enabled:
      cliOverrides.http ??
      parsed.http?.enabled ??
      parseBool(process.env[ENV_HTTP_ENABLED]) ??
      false,
    port:
      cliOverrides.port ??
      parsed.http?.port ??
      parseIntSafe(process.env[ENV_HTTP_PORT]) ??
      3000,
    host:
      cliOverrides.host ??
      parsed.http?.host ??
      process.env[ENV_HTTP_HOST] ??
      "127.0.0.1",
  };

  // -- Tools --
  const toolsDisabled =
    parsed.tools?.disabled ??
    parseStringArray(process.env[ENV_TOOLS_DISABLED]);
  const toolsEnabled =
    parsed.tools?.enabled ??
    parseStringArray(process.env[ENV_TOOLS_ENABLED]);

  if (toolsDisabled && toolsEnabled) {
    throw new Error(
      "tools.disabled and tools.enabled are mutually exclusive — use one or the other",
    );
  }
  if (toolsEnabled !== undefined && toolsEnabled.length === 0) {
    throw new Error(
      "tools.enabled is empty — at least one tool must be listed. " +
        "To enable all tools, omit the tools section entirely.",
    );
  }
  validateToolNames(toolsDisabled, "tools.disabled");
  validateToolNames(toolsEnabled, "tools.enabled");

  const tools: ToolsConfig | undefined =
    toolsDisabled || toolsEnabled
      ? { disabled: toolsDisabled, enabled: toolsEnabled }
      : undefined;

  // -- Providers --

  // Outlook: dedicated env var first, then legacy name for backward compat
  const outlookClientId =
    parsed.providers?.outlook?.clientId ??
    process.env[ENV_OUTLOOK_CLIENT_ID] ??
    process.env[LEGACY_MS_CLIENT_ID];
  const outlookTenantId =
    parsed.providers?.outlook?.tenantId ??
    process.env[ENV_OUTLOOK_TENANT_ID] ??
    process.env[LEGACY_MS_TENANT_ID];

  // Gmail: dedicated env var first, then legacy name for backward compat
  const gmailClientId =
    parsed.providers?.gmail?.clientId ??
    process.env[ENV_GMAIL_CLIENT_ID] ??
    process.env[LEGACY_GOOGLE_CLIENT_ID];
  const gmailClientSecret =
    parsed.providers?.gmail?.clientSecret ??
    process.env[ENV_GMAIL_CLIENT_SECRET] ??
    process.env[LEGACY_GOOGLE_CLIENT_SECRET];

  let providers: ProvidersConfig | undefined;
  if (outlookClientId || outlookTenantId || gmailClientId || gmailClientSecret) {
    providers = {};
    if (outlookClientId || outlookTenantId) {
      providers.outlook = {};
      if (outlookClientId) providers.outlook.clientId = outlookClientId;
      if (outlookTenantId) providers.outlook.tenantId = outlookTenantId;
    }
    if (gmailClientId || gmailClientSecret) {
      providers.gmail = {};
      if (gmailClientId) providers.gmail.clientId = gmailClientId;
      if (gmailClientSecret) providers.gmail.clientSecret = gmailClientSecret;
    }
  }

  // -- Watch --

  const watchEnabledEnv = parseBool(process.env[ENV_WATCH_ENABLED]);
  let watch: WatchConfig | undefined;
  if (parsed.watch || watchEnabledEnv !== undefined) {
    // Build webhook if URL is set (from config or env)
    const webhookUrl =
      parsed.watch?.webhook?.url ?? process.env[ENV_WATCH_WEBHOOK_URL];
    let webhook: WatchWebhookConfig | undefined;
    if (webhookUrl) {
      const retryMaxAttempts =
        parsed.watch?.webhook?.retry?.maxAttempts ??
        parseIntSafe(process.env[ENV_WATCH_WEBHOOK_RETRY_MAX_ATTEMPTS]) ??
        5;
      const retryBaseDelayMs =
        parsed.watch?.webhook?.retry?.baseDelayMs ??
        parseIntSafe(process.env[ENV_WATCH_WEBHOOK_RETRY_BASE_DELAY]) ??
        1000;
      webhook = {
        url: webhookUrl,
        retry: { maxAttempts: retryMaxAttempts, baseDelayMs: retryBaseDelayMs },
      };
    }

    watch = {
      enabled:
        watchEnabledEnv ??
        parsed.watch?.enabled ??
        false,
      pollIntervalSeconds:
        parsed.watch?.pollIntervalSeconds ??
        parseIntSafe(process.env[ENV_WATCH_POLL_INTERVAL]) ??
        10,
      webhook,
    };
  }

  return {
    dataDir:
      cliOverrides.dataDir ??
      parsed.dataDir ??
      process.env.HYPERMAIL_MCP_DATA_DIR,
    http,
    tools,
    providers,
    watch,
  };
}

// ── Helpers ──

/** Extracted tool filtering state for {@link registerTools}. */
export interface ResolvedTools {
  /** If set, only these tools are registered (allowlist mode). */
  enabledTools: Set<string> | null;
  /** If set, these tools are NOT registered (blocklist mode). */
  disabledTools: Set<string> | null;
}

/** Convert {@link AppConfig.tools} into the sets that {@link registerTools} consumes. */
export function resolveTools(config: AppConfig): ResolvedTools {
  if (!config.tools) {
    return { enabledTools: null, disabledTools: null };
  }
  return {
    enabledTools: config.tools.enabled
      ? new Set(config.tools.enabled)
      : null,
    disabledTools: config.tools.disabled
      ? new Set(config.tools.disabled)
      : null,
  };
}
