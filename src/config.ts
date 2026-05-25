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

const providersConfigSchema = z.object({
  outlook: outlookProviderSchema.optional(),
});

const rawConfigSchema = z.object({
  dataDir: z.string().optional(),
  http: httpConfigSchema.optional(),
  tools: toolsConfigSchema.optional(),
  providers: providersConfigSchema.optional(),
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

export interface ProvidersConfig {
  outlook?: OutlookProviderConfig;
}

/** Fully resolved application configuration (after ${VAR} expansion and CLI merge). */
export interface AppConfig {
  dataDir?: string;
  http: HttpConfig;
  tools?: ToolsConfig;
  providers?: ProvidersConfig;
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
] as const;

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

  // Manual validations that go beyond zod's capabilities
  if (parsed.tools) {
    if (parsed.tools.disabled && parsed.tools.enabled) {
      throw new Error(
        "tools.disabled and tools.enabled are mutually exclusive — use one or the other",
      );
    }
    if (parsed.tools.enabled !== undefined && parsed.tools.enabled.length === 0) {
      throw new Error(
        "tools.enabled is empty — at least one tool must be listed. " +
          "To enable all tools, omit the tools section entirely.",
      );
    }
    validateToolNames(parsed.tools.disabled, "tools.disabled");
    validateToolNames(parsed.tools.enabled, "tools.enabled");
  }

  // Merge CLI overrides on top of config file values
  const http: HttpConfig = {
    enabled: cliOverrides.http ?? parsed.http?.enabled ?? false,
    port: cliOverrides.port ?? parsed.http?.port ?? 3000,
    host: cliOverrides.host ?? parsed.http?.host ?? "127.0.0.1",
  };

  return {
    dataDir:
      cliOverrides.dataDir ??
      parsed.dataDir ??
      process.env.HYPERMAIL_MCP_DATA_DIR,
    http,
    tools: parsed.tools
      ? { disabled: parsed.tools.disabled, enabled: parsed.tools.enabled }
      : undefined,
    providers: parsed.providers as ProvidersConfig | undefined,
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
