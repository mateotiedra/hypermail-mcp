import { readFileSync } from "node:fs";

import type {
  AppConfig,
  CliOverrides,
  HttpConfig,
  ProvidersConfig,
  ToolsConfig,
  WatchConfig,
  WatchScriptConfig,
  WatchWebhookConfig,
} from "../config.js";
import { KNOWN_TOOLS, rawConfigSchema } from "../config.js";

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
const ENV_WATCH_SCRIPT_PATH = "HYPERMAIL_WATCH_SCRIPT_PATH";
const ENV_WATCH_SCRIPT_TIMEOUT_MS = "HYPERMAIL_WATCH_SCRIPT_TIMEOUT_MS";
const ENV_WATCH_SCRIPT_RETRY_MAX_ATTEMPTS = "HYPERMAIL_WATCH_SCRIPT_RETRY_MAX_ATTEMPTS";
const ENV_WATCH_SCRIPT_RETRY_BASE_DELAY = "HYPERMAIL_WATCH_SCRIPT_RETRY_BASE_DELAY_MS";

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

    // Build script if path is set (from config or env)
    const scriptPath =
      parsed.watch?.script?.path ?? process.env[ENV_WATCH_SCRIPT_PATH];
    let script: WatchScriptConfig | undefined;
    if (scriptPath) {
      const scriptTimeoutMs =
        parsed.watch?.script?.timeoutMs ??
        parseIntSafe(process.env[ENV_WATCH_SCRIPT_TIMEOUT_MS]) ??
        30000;
      const scriptRetryMaxAttempts =
        parsed.watch?.script?.retry?.maxAttempts ??
        parseIntSafe(process.env[ENV_WATCH_SCRIPT_RETRY_MAX_ATTEMPTS]) ??
        5;
      const scriptRetryBaseDelayMs =
        parsed.watch?.script?.retry?.baseDelayMs ??
        parseIntSafe(process.env[ENV_WATCH_SCRIPT_RETRY_BASE_DELAY]) ??
        1000;
      script = {
        path: scriptPath,
        timeoutMs: scriptTimeoutMs,
        retry: {
          maxAttempts: scriptRetryMaxAttempts,
          baseDelayMs: scriptRetryBaseDelayMs,
        },
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
      script,
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
