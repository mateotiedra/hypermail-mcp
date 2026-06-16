import type {
  AppConfig,
  CliOverrides,
  HttpConfig,
  LoadConfigResult,
  ProvidersConfig,
  ToolsConfig,
  Transport,
  WatchConfig,
  WatchNotifyCommandConfig,
  WatchRetryConfig,
  WatchWebhookConfig,
} from "../config.js";
import { KNOWN_TOOLS } from "../config.js";

// ── Env var names ──

const ENV_DATA_DIR = "HYPERMAIL_DATA_DIR";
const ENV_KEY = "HYPERMAIL_KEY";
const ENV_TRANSPORT = "HYPERMAIL_TRANSPORT";
const ENV_HTTP_PORT = "HYPERMAIL_HTTP_PORT";
const ENV_HTTP_HOST = "HYPERMAIL_HTTP_HOST";
const ENV_TOOLS_DISABLED = "HYPERMAIL_TOOLS_DISABLED";
const ENV_TOOLS_ENABLED = "HYPERMAIL_TOOLS_ENABLED";
const ENV_OUTLOOK_CLIENT_ID = "HYPERMAIL_OUTLOOK_CLIENT_ID";
const ENV_OUTLOOK_TENANT_ID = "HYPERMAIL_OUTLOOK_TENANT_ID";
const ENV_GMAIL_CLIENT_ID = "HYPERMAIL_GMAIL_CLIENT_ID";
const ENV_GMAIL_CLIENT_SECRET = "HYPERMAIL_GMAIL_CLIENT_SECRET";
const ENV_GMAIL_REDIRECT_URI = "HYPERMAIL_GMAIL_REDIRECT_URI";
const ENV_WATCH_ENABLED = "HYPERMAIL_WATCH_ENABLED";
const ENV_WATCH_POLL_SECONDS = "HYPERMAIL_WATCH_POLL_SECONDS";
const ENV_WATCH_WEBHOOK_URL = "HYPERMAIL_WATCH_WEBHOOK_URL";
const ENV_WATCH_WEBHOOK_RETRY_ATTEMPTS = "HYPERMAIL_WATCH_WEBHOOK_RETRY_ATTEMPTS";
const ENV_WATCH_WEBHOOK_RETRY_DELAY_MS = "HYPERMAIL_WATCH_WEBHOOK_RETRY_DELAY_MS";
const ENV_WATCH_NOTIFY_COMMAND = "HYPERMAIL_WATCH_NOTIFY_COMMAND";
const ENV_WATCH_NOTIFY_TIMEOUT_MS = "HYPERMAIL_WATCH_NOTIFY_TIMEOUT_MS";
const ENV_WATCH_NOTIFY_RETRY_ATTEMPTS = "HYPERMAIL_WATCH_NOTIFY_RETRY_ATTEMPTS";
const ENV_WATCH_NOTIFY_RETRY_DELAY_MS = "HYPERMAIL_WATCH_NOTIFY_RETRY_DELAY_MS";

const DEFAULT_TRANSPORT: Transport = "stdio";
const DEFAULT_HTTP_PORT = 3000;
const DEFAULT_HTTP_HOST = "127.0.0.1";
const DEFAULT_WATCH_POLL_SECONDS = 10;
const DEFAULT_RETRY_ATTEMPTS = 5;
const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_NOTIFY_TIMEOUT_MS = 30000;

// ── Type coercion helpers ──

function envRaw(name: string): string | undefined {
  return process.env[name];
}

function optionalEnvString(name: string): string | undefined {
  const value = envRaw(name);
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseBoolEnv(name: string): boolean | undefined {
  const value = envRaw(name);
  if (value === undefined) return undefined;
  const lower = value.trim().toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  throw new Error(`${name} must be either "true" or "false"`);
}

function parseTransportEnv(): Transport | undefined {
  const value = envRaw(ENV_TRANSPORT);
  if (value === undefined) return undefined;
  const lower = value.trim().toLowerCase();
  if (lower === "stdio" || lower === "http") return lower;
  throw new Error(`${ENV_TRANSPORT} must be either "stdio" or "http"`);
}

function parsePositiveInteger(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parsePositiveIntegerEnv(name: string, defaultValue: number): number {
  const value = envRaw(name);
  if (value === undefined) return defaultValue;
  const parsed = parsePositiveInteger(value);
  if (parsed === undefined) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

/** Parse a comma-separated string into a trimmed, filtered array.
 *  Returns an empty array for empty/whitespace-only strings so callers
 *  can treat an explicitly empty list as "no filtering". */
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
  envName: string,
): void {
  if (!toolNames || toolNames.length === 0) return;
  const known = new Set<string>(KNOWN_TOOLS as readonly string[]);
  for (const name of toolNames) {
    if (!known.has(name)) {
      throw new Error(
        `Unknown tool "${name}" in ${envName}. Known tools: ${KNOWN_TOOLS.join(", ")}`,
      );
    }
  }
}

function validateWebhookUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return raw;
  } catch {
    throw new Error(`${ENV_WATCH_WEBHOOK_URL} must be a valid http(s) URL`);
  }
}

function resolveHttpConfig(
  transport: Transport,
  cliOverrides: CliOverrides,
  warnings: string[],
): HttpConfig {
  const portSource = cliOverrides.port !== undefined ? "--port" : ENV_HTTP_PORT;
  const rawPort = cliOverrides.port ?? envRaw(ENV_HTTP_PORT);
  const parsedPort = parsePositiveInteger(rawPort);
  let port = DEFAULT_HTTP_PORT;
  if (parsedPort !== undefined && parsedPort <= 65535) {
    port = parsedPort;
  } else if (rawPort !== undefined && transport === "http") {
    warnings.push(
      `Invalid ${portSource}; using default HTTP port ${DEFAULT_HTTP_PORT}.`,
    );
  }

  const hostSource = cliOverrides.host !== undefined ? "--host" : ENV_HTTP_HOST;
  const rawHost = cliOverrides.host ?? envRaw(ENV_HTTP_HOST);
  let host = DEFAULT_HTTP_HOST;
  if (rawHost !== undefined && rawHost.trim().length > 0) {
    host = rawHost.trim();
  } else if (rawHost !== undefined && transport === "http") {
    warnings.push(
      `Invalid ${hostSource}; using default HTTP host ${DEFAULT_HTTP_HOST}.`,
    );
  }

  return { port, host };
}

function resolveToolsConfig(): ToolsConfig | undefined {
  const disabled = parseStringArray(envRaw(ENV_TOOLS_DISABLED));
  const enabled = parseStringArray(envRaw(ENV_TOOLS_ENABLED));
  const disabledIsNonEmpty = disabled !== undefined && disabled.length > 0;
  const enabledIsNonEmpty = enabled !== undefined && enabled.length > 0;

  if (disabledIsNonEmpty && enabledIsNonEmpty) {
    throw new Error(
      `${ENV_TOOLS_DISABLED} and ${ENV_TOOLS_ENABLED} are mutually exclusive — use one or the other`,
    );
  }

  validateToolNames(disabled, ENV_TOOLS_DISABLED);
  validateToolNames(enabled, ENV_TOOLS_ENABLED);

  if (enabledIsNonEmpty) return { enabled };
  if (disabledIsNonEmpty) return { disabled };
  return undefined;
}

function resolveProvidersConfig(): ProvidersConfig | undefined {
  const outlookClientId = optionalEnvString(ENV_OUTLOOK_CLIENT_ID);
  const outlookTenantId = optionalEnvString(ENV_OUTLOOK_TENANT_ID);
  const gmailClientId = optionalEnvString(ENV_GMAIL_CLIENT_ID);
  const gmailClientSecret = optionalEnvString(ENV_GMAIL_CLIENT_SECRET);
  const gmailRedirectUri = optionalEnvString(ENV_GMAIL_REDIRECT_URI);

  let providers: ProvidersConfig | undefined;
  if (outlookClientId || outlookTenantId || gmailClientId || gmailClientSecret || gmailRedirectUri) {
    providers = {};
    if (outlookClientId || outlookTenantId) {
      providers.outlook = {};
      if (outlookClientId) providers.outlook.clientId = outlookClientId;
      if (outlookTenantId) providers.outlook.tenantId = outlookTenantId;
    }
    if (gmailClientId || gmailClientSecret || gmailRedirectUri) {
      providers.gmail = {};
      if (gmailClientId) providers.gmail.clientId = gmailClientId;
      if (gmailClientSecret) providers.gmail.clientSecret = gmailClientSecret;
      if (gmailRedirectUri) providers.gmail.redirectUri = gmailRedirectUri;
    }
  }

  return providers;
}

function resolveRetryConfig(
  attemptsEnv: string,
  delayEnv: string,
): WatchRetryConfig {
  return {
    maxAttempts: parsePositiveIntegerEnv(attemptsEnv, DEFAULT_RETRY_ATTEMPTS),
    baseDelayMs: parsePositiveIntegerEnv(delayEnv, DEFAULT_RETRY_DELAY_MS),
  };
}

function resolveWatchConfig(): WatchConfig | undefined {
  const enabled = parseBoolEnv(ENV_WATCH_ENABLED) ?? false;
  if (!enabled) return undefined;

  const pollIntervalSeconds = parsePositiveIntegerEnv(
    ENV_WATCH_POLL_SECONDS,
    DEFAULT_WATCH_POLL_SECONDS,
  );

  const webhookUrl = optionalEnvString(ENV_WATCH_WEBHOOK_URL);
  let webhook: WatchWebhookConfig | undefined;
  if (webhookUrl) {
    webhook = {
      url: validateWebhookUrl(webhookUrl),
      retry: resolveRetryConfig(
        ENV_WATCH_WEBHOOK_RETRY_ATTEMPTS,
        ENV_WATCH_WEBHOOK_RETRY_DELAY_MS,
      ),
    };
  }

  const rawNotifyCommand = envRaw(ENV_WATCH_NOTIFY_COMMAND);
  let notifyCommand: WatchNotifyCommandConfig | undefined;
  if (rawNotifyCommand !== undefined) {
    const command = rawNotifyCommand.trim();
    if (!command) {
      throw new Error(`${ENV_WATCH_NOTIFY_COMMAND} must not be empty when watch is enabled`);
    }
    notifyCommand = {
      command,
      timeoutMs: parsePositiveIntegerEnv(
        ENV_WATCH_NOTIFY_TIMEOUT_MS,
        DEFAULT_NOTIFY_TIMEOUT_MS,
      ),
      retry: resolveRetryConfig(
        ENV_WATCH_NOTIFY_RETRY_ATTEMPTS,
        ENV_WATCH_NOTIFY_RETRY_DELAY_MS,
      ),
    };
  }

  if (!webhook && !notifyCommand) {
    throw new Error(
      `${ENV_WATCH_ENABLED}=true requires ${ENV_WATCH_WEBHOOK_URL} or ${ENV_WATCH_NOTIFY_COMMAND}`,
    );
  }

  return {
    enabled: true,
    pollIntervalSeconds,
    webhook,
    notifyCommand,
  };
}

// ── Loading ──

/**
 * Load and validate configuration from the compact HYPERMAIL_* environment
 * contract, then apply selected CLI overrides.
 */
export function loadConfig(cliOverrides: CliOverrides = {}): LoadConfigResult {
  const warnings: string[] = [];

  const transport = cliOverrides.transport ?? parseTransportEnv() ?? DEFAULT_TRANSPORT;
  const http = resolveHttpConfig(transport, cliOverrides, warnings);
  const tools = resolveToolsConfig();
  const providers = resolveProvidersConfig();
  const watch = resolveWatchConfig();
  const dataDir = cliOverrides.dataDir ?? optionalEnvString(ENV_DATA_DIR);

  if (!optionalEnvString(ENV_KEY)) {
    warnings.push(
      `${ENV_KEY} is not set; a local generated key will be used. Set ${ENV_KEY} explicitly for portable hosted deployments.`,
    );
  }

  return {
    config: {
      dataDir,
      transport,
      http,
      tools,
      providers,
      watch,
    },
    warnings,
  };
}
