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
  redirectUri: z.string().optional(),
});

const providersConfigSchema = z.object({
  outlook: outlookProviderSchema.optional(),
  gmail: gmailProviderSchema.optional(),
});

const watchRetrySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10).default(5),
  baseDelayMs: z.number().int().min(100).default(1000),
});

const watchWebhookSchema = z.object({
  url: z.string(),
  retry: watchRetrySchema.optional(),
});

const watchScriptSchema = z.object({
  path: z.string(),
  timeoutMs: z.number().int().min(1000).default(30000),
  retry: watchRetrySchema.optional(),
});

const watchConfigSchema = z.object({
  enabled: z.boolean().default(false),
  pollIntervalSeconds: z.number().int().min(10).max(3600).default(10),
  webhook: watchWebhookSchema.optional(),
  script: watchScriptSchema.optional(),
});

export const rawConfigSchema = z.object({
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
  redirectUri?: string;
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

export interface WatchScriptConfig {
  /** Absolute path to a script that receives new-email JSON on stdin. */
  path: string;
  /** Maximum time in ms before the child process is killed (default: 30000). */
  timeoutMs: number;
  /** Retry configuration for failed script executions. */
  retry?: WatchRetryConfig;
}

export interface WatchConfig {
  /** Whether the email poll loop is enabled (default: false). */
  enabled: boolean;
  /** Seconds between inbox polls (min 10, default 10). */
  pollIntervalSeconds: number;
  /** Webhook delivery configuration. */
  webhook?: WatchWebhookConfig;
  /** Script-based delivery configuration — spawns a child process per new email. */
  script?: WatchScriptConfig;
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
  "check_notifications",
] as const;

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

// ── Re-exports ──

export { loadConfig } from "./config/load.js";
