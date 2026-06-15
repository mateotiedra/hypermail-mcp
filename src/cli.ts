import { randomBytes } from "node:crypto";

import { startServer } from "./server.js";
import { loadConfig } from "./config.js";

type ParsedArgs = {
  http: boolean;
  port: number;
  host: string;
  dataDir?: string;
  config?: string;
  help: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    http: false,
    port: 3000,
    host: "127.0.0.1",
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--http":
        out.http = true;
        break;
      case "--port":
        out.port = Number(argv[++i] ?? "3000");
        break;
      case "--host":
        out.host = String(argv[++i] ?? "127.0.0.1");
        break;
      case "--data-dir":
        out.dataDir = String(argv[++i] ?? "");
        break;
      case "--config":
        out.config = String(argv[++i] ?? "");
        break;
      case "-h":
      case "--help":
        out.help = true;
        break;
      default:
        if (a && a.startsWith("--")) {
          // ignore unknown flags rather than crashing — keeps the CLI forgiving
          // when embedded in MCP host configs.
        }
    }
  }
  return out;
}

function printHelp(): void {
  const msg = `hypermail-mcp — unified email MCP server

Usage:
  hypermail-mcp [options]

Options:
  --http              Run as Streamable HTTP server (default: stdio)
  --port <n>          HTTP port (default: 3000)
  --host <addr>       HTTP bind address (default: 127.0.0.1)
  --data-dir <path>   Where to store the encrypted accounts file
                      (default: $HYPERMAIL_MCP_DATA_DIR or ~/.hypermail-mcp)
  --config <path>     Path to hypermail-config.json
  -h, --help          Show this help

Configuration:
  All settings can be provided via environment variables — no config file
  required. Use hypermail-config.json for advanced scenarios.

  Environment variables:

  HYPERMAIL_MCP_DATA_DIR              Data directory (string)
  HYPERMAIL_HTTP_ENABLED              Enable HTTP mode (bool: true/false/1/0)
  HYPERMAIL_HTTP_PORT                 HTTP port (number)
  HYPERMAIL_HTTP_HOST                 HTTP bind address (string)
  HYPERMAIL_TOOLS_DISABLED            Comma-separated tool names to disable
  HYPERMAIL_TOOLS_ENABLED             Comma-separated tool names to enable
  HYPERMAIL_PROVIDERS_OUTLOOK_CLIENT_ID   Outlook OAuth client ID (string)
  HYPERMAIL_PROVIDERS_OUTLOOK_TENANT_ID   Outlook tenant ID (string)
  HYPERMAIL_PROVIDERS_GMAIL_CLIENT_ID     Gmail OAuth client ID (string)
  HYPERMAIL_PROVIDERS_GMAIL_CLIENT_SECRET Gmail OAuth client secret (string)
  HYPERMAIL_WATCH_ENABLED             Enable inbox polling (bool)
  HYPERMAIL_WATCH_POLL_INTERVAL       Poll interval in seconds (number)
  HYPERMAIL_WATCH_WEBHOOK_URL         Webhook URL for new-email events (string)
  HYPERMAIL_WATCH_WEBHOOK_RETRY_MAX_ATTEMPTS  Retry max attempts (number)
  HYPERMAIL_WATCH_WEBHOOK_RETRY_BASE_DELAY_MS Retry base delay ms (number)
  HYPERMAIL_MCP_KEY                   Encryption master key (hex or base64)

  Priority: CLI flags > config file > env vars > defaults.

  Example (env-only, no config file):
    HYPERMAIL_HTTP_ENABLED=true \\
    HYPERMAIL_HTTP_PORT=8080 \\
    HYPERMAIL_PROVIDERS_OUTLOOK_CLIENT_ID=abc123 \\
    HYPERMAIL_PROVIDERS_OUTLOOK_TENANT_ID=common \\
    HYPERMAIL_MCP_DATA_DIR=/data/hypermail \\
    hypermail-mcp --http

  Example hypermail-config.json:
    {
      "dataDir": "/path/to/data",
      "http": { "enabled": false },
      "tools": { "disabled": ["send_email"] },
      "providers": {
        "outlook": {
          "clientId": "\${HYPERMAIL_PROVIDERS_OUTLOOK_CLIENT_ID}",
          "tenantId": "\${HYPERMAIL_PROVIDERS_OUTLOOK_TENANT_ID}"
        },
        "gmail": {
          "clientId": "\${HYPERMAIL_PROVIDERS_GMAIL_CLIENT_ID}",
          "clientSecret": "\${HYPERMAIL_PROVIDERS_GMAIL_CLIENT_SECRET}"
        }
      }
    }
`;
  process.stdout.write(msg);
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  // Subcommand: generate-key
  if (rawArgs[0] === "generate-key") {
    const key = `hm_sk_${randomBytes(32).toString("hex")}`;
    process.stdout.write(key + "\n");
    return;
  }

  const opts = parseArgs(rawArgs);
  if (opts.help) {
    printHelp();
    return;
  }

  const config = loadConfig(opts.config, {
    http: opts.http,
    port: opts.port,
    host: opts.host,
    dataDir: opts.dataDir,
  });

  await startServer({ config });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[hypermail-mcp] fatal:", err);
  process.exit(1);
});
