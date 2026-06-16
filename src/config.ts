// ── Types ──

export type Transport = "stdio" | "http";

export interface HttpConfig {
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
  /** Maximum number of delivery attempts (default: 5). */
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

export interface WatchNotifyCommandConfig {
  /** Shell command that receives new-email JSON on stdin. */
  command: string;
  /** Maximum time in ms before the child process is killed (default: 30000). */
  timeoutMs: number;
  /** Retry configuration for failed command executions. */
  retry: WatchRetryConfig;
}

export interface WatchConfig {
  /** Whether the email poll loop is enabled. */
  enabled: boolean;
  /** Seconds between inbox polls (default: 10). */
  pollIntervalSeconds: number;
  /** Webhook delivery configuration. */
  webhook?: WatchWebhookConfig;
  /** Shell-command delivery configuration. */
  notifyCommand?: WatchNotifyCommandConfig;
}

/** Fully resolved application configuration. */
export interface AppConfig {
  dataDir?: string;
  transport: Transport;
  http: HttpConfig;
  tools?: ToolsConfig;
  providers?: ProvidersConfig;
  watch?: WatchConfig;
}

export interface LoadConfigResult {
  config: AppConfig;
  warnings: string[];
}

/** CLI flags that can override env values. */
export interface CliOverrides {
  transport?: Transport;
  port?: number;
  host?: string;
  dataDir?: string;
}

// ── Known tool names ──

/**
 * Every tool that {@link registerTools} may register.
 * Used for validation — typos in HYPERMAIL_TOOLS_* are caught at startup.
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
