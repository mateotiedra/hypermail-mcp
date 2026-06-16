import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, resolveTools } from "./config.js";

// ── Env isolation helpers ──

/** All env vars that our tests might touch. */
const MANAGED_KEYS = [
  "HYPERMAIL_DATA_DIR",
  "HYPERMAIL_KEY",
  "HYPERMAIL_TRANSPORT",
  "HYPERMAIL_HTTP_PORT",
  "HYPERMAIL_HTTP_HOST",
  "HYPERMAIL_TOOLS_DISABLED",
  "HYPERMAIL_TOOLS_ENABLED",
  "HYPERMAIL_OUTLOOK_CLIENT_ID",
  "HYPERMAIL_OUTLOOK_TENANT_ID",
  "HYPERMAIL_GMAIL_CLIENT_ID",
  "HYPERMAIL_GMAIL_CLIENT_SECRET",
  "HYPERMAIL_GMAIL_REDIRECT_URI",
  "HYPERMAIL_WATCH_ENABLED",
  "HYPERMAIL_WATCH_POLL_SECONDS",
  "HYPERMAIL_WATCH_WEBHOOK_URL",
  "HYPERMAIL_WATCH_WEBHOOK_RETRY_ATTEMPTS",
  "HYPERMAIL_WATCH_WEBHOOK_RETRY_DELAY_MS",
  "HYPERMAIL_WATCH_NOTIFY_COMMAND",
  "HYPERMAIL_WATCH_NOTIFY_TIMEOUT_MS",
  "HYPERMAIL_WATCH_NOTIFY_RETRY_ATTEMPTS",
  "HYPERMAIL_WATCH_NOTIFY_RETRY_DELAY_MS",
  // legacy names that should be ignored
  "HYPERMAIL_MCP_DATA_DIR",
  "HYPERMAIL_MCP_KEY",
  "HYPERMAIL_HTTP_ENABLED",
  "HYPERMAIL_PROVIDERS_OUTLOOK_CLIENT_ID",
  "HYPERMAIL_PROVIDERS_OUTLOOK_TENANT_ID",
  "HYPERMAIL_PROVIDERS_GMAIL_CLIENT_ID",
  "HYPERMAIL_PROVIDERS_GMAIL_CLIENT_SECRET",
  "HYPERMAIL_PROVIDERS_GMAIL_REDIRECT_URI",
  "HYPERMAIL_WATCH_POLL_INTERVAL",
  "HYPERMAIL_WATCH_SCRIPT_PATH",
  "MS_CLIENT_ID",
  "MS_TENANT_ID",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
];

function cleanEnv() {
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }
}

function load() {
  return loadConfig().config;
}

describe("loadConfig — env-only resolution", () => {
  beforeEach(() => {
    cleanEnv();
  });

  afterEach(() => {
    cleanEnv();
  });

  it("returns safe defaults when nothing is configured", () => {
    const { config, warnings } = loadConfig();
    expect(config.transport).toBe("stdio");
    expect(config.http.port).toBe(3000);
    expect(config.http.host).toBe("127.0.0.1");
    expect(config.tools).toBeUndefined();
    expect(config.providers).toBeUndefined();
    expect(config.watch).toBeUndefined();
    expect(config.dataDir).toBeUndefined();
    expect(warnings).toContain(
      "HYPERMAIL_KEY is not set; a local generated key will be used. Set HYPERMAIL_KEY explicitly for portable hosted deployments.",
    );
  });

  it("resolves transport and HTTP settings from compact env vars", () => {
    process.env.HYPERMAIL_TRANSPORT = "http";
    process.env.HYPERMAIL_HTTP_PORT = "8080";
    process.env.HYPERMAIL_HTTP_HOST = "0.0.0.0";
    const cfg = load();
    expect(cfg.transport).toBe("http");
    expect(cfg.http.port).toBe(8080);
    expect(cfg.http.host).toBe("0.0.0.0");
  });

  it("accepts transport case-insensitively", () => {
    process.env.HYPERMAIL_TRANSPORT = "HTTP";
    expect(load().transport).toBe("http");
  });

  it("throws on invalid transport values", () => {
    process.env.HYPERMAIL_TRANSPORT = "websocket";
    expect(() => loadConfig()).toThrow("HYPERMAIL_TRANSPORT");
  });

  it("uses CLI overrides after env parsing", () => {
    process.env.HYPERMAIL_TRANSPORT = "stdio";
    process.env.HYPERMAIL_HTTP_PORT = "9090";
    process.env.HYPERMAIL_HTTP_HOST = "127.0.0.1";
    const cfg = loadConfig({
      transport: "http",
      port: 7070,
      host: "0.0.0.0",
    }).config;
    expect(cfg.transport).toBe("http");
    expect(cfg.http.port).toBe(7070);
    expect(cfg.http.host).toBe("0.0.0.0");
  });

  it("warns and falls back for invalid HTTP host/port when HTTP is selected", () => {
    process.env.HYPERMAIL_TRANSPORT = "http";
    process.env.HYPERMAIL_HTTP_PORT = "99999";
    process.env.HYPERMAIL_HTTP_HOST = "";
    const { config, warnings } = loadConfig();
    expect(config.http.port).toBe(3000);
    expect(config.http.host).toBe("127.0.0.1");
    expect(warnings).toContain("Invalid HYPERMAIL_HTTP_PORT; using default HTTP port 3000.");
    expect(warnings).toContain("Invalid HYPERMAIL_HTTP_HOST; using default HTTP host 127.0.0.1.");
  });

  it("does not warn about invalid HTTP values while stdio is selected", () => {
    process.env.HYPERMAIL_HTTP_PORT = "bad";
    const { config, warnings } = loadConfig();
    expect(config.transport).toBe("stdio");
    expect(config.http.port).toBe(3000);
    expect(warnings.some((w) => w.includes("HYPERMAIL_HTTP_PORT"))).toBe(false);
  });

  it("parses HYPERMAIL_TOOLS_DISABLED", () => {
    process.env.HYPERMAIL_TOOLS_DISABLED = "send_email,draft_email";
    const cfg = load();
    expect(cfg.tools?.disabled).toEqual(["send_email", "draft_email"]);
    expect(cfg.tools?.enabled).toBeUndefined();
  });

  it("parses HYPERMAIL_TOOLS_ENABLED", () => {
    process.env.HYPERMAIL_TOOLS_ENABLED = "list_emails,read_email";
    const cfg = load();
    expect(cfg.tools?.enabled).toEqual(["list_emails", "read_email"]);
    expect(cfg.tools?.disabled).toBeUndefined();
  });

  it("treats empty tool lists as no filtering", () => {
    process.env.HYPERMAIL_TOOLS_ENABLED = "";
    process.env.HYPERMAIL_TOOLS_DISABLED = "   ";
    expect(load().tools).toBeUndefined();
  });

  it("throws when both non-empty tool lists are set", () => {
    process.env.HYPERMAIL_TOOLS_DISABLED = "send_email";
    process.env.HYPERMAIL_TOOLS_ENABLED = "list_emails";
    expect(() => loadConfig()).toThrow("mutually exclusive");
  });

  it("throws on unknown tool names", () => {
    process.env.HYPERMAIL_TOOLS_DISABLED = "nonexistent_tool";
    expect(() => loadConfig()).toThrow(
      'Unknown tool "nonexistent_tool" in HYPERMAIL_TOOLS_DISABLED',
    );
  });

  it("resolves Outlook provider settings from new env vars", () => {
    process.env.HYPERMAIL_OUTLOOK_CLIENT_ID = "ocid";
    process.env.HYPERMAIL_OUTLOOK_TENANT_ID = "otnt";
    const cfg = load();
    expect(cfg.providers?.outlook?.clientId).toBe("ocid");
    expect(cfg.providers?.outlook?.tenantId).toBe("otnt");
  });

  it("resolves Gmail provider settings from new env vars", () => {
    process.env.HYPERMAIL_GMAIL_CLIENT_ID = "gcid";
    process.env.HYPERMAIL_GMAIL_CLIENT_SECRET = "gsec";
    process.env.HYPERMAIL_GMAIL_REDIRECT_URI = "https://example.com/oauth/gmail/callback";
    const cfg = load();
    expect(cfg.providers?.gmail?.clientId).toBe("gcid");
    expect(cfg.providers?.gmail?.clientSecret).toBe("gsec");
    expect(cfg.providers?.gmail?.redirectUri).toBe("https://example.com/oauth/gmail/callback");
  });

  it("ignores legacy provider env vars", () => {
    process.env.HYPERMAIL_PROVIDERS_OUTLOOK_CLIENT_ID = "old-outlook";
    process.env.HYPERMAIL_PROVIDERS_GMAIL_CLIENT_ID = "old-gmail";
    process.env.MS_CLIENT_ID = "legacy-ms-cid";
    process.env.GOOGLE_CLIENT_ID = "legacy-google-cid";
    const cfg = load();
    expect(cfg.providers).toBeUndefined();
  });

  it("does not create watch config unless explicitly enabled", () => {
    expect(load().watch).toBeUndefined();
    process.env.HYPERMAIL_WATCH_ENABLED = "false";
    expect(load().watch).toBeUndefined();
  });

  it("requires a watcher delivery target when enabled", () => {
    process.env.HYPERMAIL_WATCH_ENABLED = "true";
    expect(() => loadConfig()).toThrow("requires HYPERMAIL_WATCH_WEBHOOK_URL or HYPERMAIL_WATCH_NOTIFY_COMMAND");
  });

  it("resolves webhook watcher config", () => {
    process.env.HYPERMAIL_WATCH_ENABLED = "true";
    process.env.HYPERMAIL_WATCH_POLL_SECONDS = "60";
    process.env.HYPERMAIL_WATCH_WEBHOOK_URL = "https://hooks.example.com/email";
    process.env.HYPERMAIL_WATCH_WEBHOOK_RETRY_ATTEMPTS = "3";
    process.env.HYPERMAIL_WATCH_WEBHOOK_RETRY_DELAY_MS = "500";
    const cfg = load();
    expect(cfg.watch?.enabled).toBe(true);
    expect(cfg.watch?.pollIntervalSeconds).toBe(60);
    expect(cfg.watch?.webhook?.url).toBe("https://hooks.example.com/email");
    expect(cfg.watch?.webhook?.retry.maxAttempts).toBe(3);
    expect(cfg.watch?.webhook?.retry.baseDelayMs).toBe(500);
  });

  it("resolves notify-command watcher config", () => {
    process.env.HYPERMAIL_WATCH_ENABLED = "true";
    process.env.HYPERMAIL_WATCH_NOTIFY_COMMAND = "node ./notify.js --flag";
    process.env.HYPERMAIL_WATCH_NOTIFY_TIMEOUT_MS = "2000";
    process.env.HYPERMAIL_WATCH_NOTIFY_RETRY_ATTEMPTS = "2";
    process.env.HYPERMAIL_WATCH_NOTIFY_RETRY_DELAY_MS = "250";
    const cfg = load();
    expect(cfg.watch?.notifyCommand?.command).toBe("node ./notify.js --flag");
    expect(cfg.watch?.notifyCommand?.timeoutMs).toBe(2000);
    expect(cfg.watch?.notifyCommand?.retry.maxAttempts).toBe(2);
    expect(cfg.watch?.notifyCommand?.retry.baseDelayMs).toBe(250);
  });

  it("strictly parses watcher booleans", () => {
    process.env.HYPERMAIL_WATCH_ENABLED = "yes";
    expect(() => loadConfig()).toThrow('HYPERMAIL_WATCH_ENABLED must be either "true" or "false"');
  });

  it("validates watcher URL syntax", () => {
    process.env.HYPERMAIL_WATCH_ENABLED = "true";
    process.env.HYPERMAIL_WATCH_WEBHOOK_URL = "not-a-url";
    expect(() => loadConfig()).toThrow("valid http(s) URL");
  });

  it("validates watcher positive integers", () => {
    process.env.HYPERMAIL_WATCH_ENABLED = "true";
    process.env.HYPERMAIL_WATCH_WEBHOOK_URL = "https://hooks.example.com/email";
    process.env.HYPERMAIL_WATCH_POLL_SECONDS = "0";
    expect(() => loadConfig()).toThrow("HYPERMAIL_WATCH_POLL_SECONDS must be a positive integer");
  });

  it("resolves dataDir from HYPERMAIL_DATA_DIR", () => {
    process.env.HYPERMAIL_DATA_DIR = "/custom/data";
    const cfg = load();
    expect(cfg.dataDir).toBe("/custom/data");
  });

  it("CLI dataDir overrides env", () => {
    process.env.HYPERMAIL_DATA_DIR = "/env/data";
    const cfg = loadConfig({ dataDir: "/cli/data" }).config;
    expect(cfg.dataDir).toBe("/cli/data");
  });

  it("ignores legacy HYPERMAIL_MCP_DATA_DIR", () => {
    process.env.HYPERMAIL_MCP_DATA_DIR = "/old/data";
    expect(load().dataDir).toBeUndefined();
  });
});

describe("resolveTools", () => {
  beforeEach(() => {
    cleanEnv();
  });

  afterEach(() => {
    cleanEnv();
  });

  it("returns null sets when tools is undefined", () => {
    const resolved = resolveTools(load());
    expect(resolved.enabledTools).toBeNull();
    expect(resolved.disabledTools).toBeNull();
  });

  it("returns enabledTools set when tools.enabled is present", () => {
    process.env.HYPERMAIL_TOOLS_ENABLED = "list_emails,search_emails";
    const resolved = resolveTools(load());
    expect(resolved.enabledTools?.has("list_emails")).toBe(true);
    expect(resolved.enabledTools?.has("search_emails")).toBe(true);
    expect(resolved.disabledTools).toBeNull();
  });

  it("returns disabledTools set when tools.disabled is present", () => {
    process.env.HYPERMAIL_TOOLS_DISABLED = "send_email";
    const resolved = resolveTools(load());
    expect(resolved.disabledTools?.has("send_email")).toBe(true);
    expect(resolved.enabledTools).toBeNull();
  });
});
