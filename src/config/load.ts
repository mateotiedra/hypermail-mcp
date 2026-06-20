import type {
  AppConfig,
  CliOverrides,
  HttpConfig,
  LoadConfigResult,
  ProvidersConfig,
  ToolsConfig,
  Transport,
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
const DEFAULT_TRANSPORT: Transport = "stdio";
const DEFAULT_HTTP_PORT = 3000;
const DEFAULT_HTTP_HOST = "127.0.0.1";
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
    },
    warnings,
  };
}
