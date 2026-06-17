import { randomBytes } from "node:crypto";

import type { CliOverrides } from "./config.js";

export type ParsedArgs = {
  command?: "generate-key";
  help: boolean;
  overrides: CliOverrides;
};

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv[0] === "generate-key") {
    if (argv.length > 1) {
      throw new Error(`Unknown argument for generate-key: ${argv[1]}`);
    }
    return { command: "generate-key", help: false, overrides: {} };
  }

  const out: ParsedArgs = {
    help: false,
    overrides: {},
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    switch (arg) {
      case "--http":
        out.overrides.transport = "http";
        break;
      case "--port": {
        const value = readValue(argv, i, "--port");
        out.overrides.port = Number(value);
        i++;
        break;
      }
      case "--host": {
        const value = readValue(argv, i, "--host");
        out.overrides.host = value;
        i++;
        break;
      }
      case "--data-dir": {
        const value = readValue(argv, i, "--data-dir");
        out.overrides.dataDir = value;
        i++;
        break;
      }
      case "-h":
      case "--help":
        out.help = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return out;
}

export function generateKey(): string {
  return randomBytes(32).toString("base64");
}

export function helpText(): string {
  return `hypermail-mcp — unified email MCP server

Usage:
  hypermail-mcp [options]
  hypermail-mcp generate-key

Options:
  --http              Run as Streamable HTTP server (default: stdio)
  --port <n>          HTTP port (default: 3000)
  --host <addr>       HTTP bind address (default: 127.0.0.1)
  --data-dir <path>   Where to store the encrypted accounts file
  -h, --help          Show this help

Configuration:
  Configure the server with flat HYPERMAIL_* environment variables.
  CLI flags override environment values for this invocation only.

Core environment variables:
  HYPERMAIL_DATA_DIR
  HYPERMAIL_KEY
  HYPERMAIL_TRANSPORT=stdio|http
  HYPERMAIL_HTTP_PORT
  HYPERMAIL_HTTP_HOST
  HYPERMAIL_TOOLS_ENABLED
  HYPERMAIL_TOOLS_DISABLED

Provider environment variables:
  HYPERMAIL_OUTLOOK_CLIENT_ID
  HYPERMAIL_OUTLOOK_TENANT_ID
  HYPERMAIL_GMAIL_CLIENT_ID
  HYPERMAIL_GMAIL_CLIENT_SECRET
  HYPERMAIL_GMAIL_REDIRECT_URI

Watcher environment variables:
  HYPERMAIL_WATCH_ENABLED=true|false
  HYPERMAIL_WATCH_POLL_SECONDS
  HYPERMAIL_WATCH_WEBHOOK_URL
  HYPERMAIL_WATCH_NOTIFY_COMMAND
  HYPERMAIL_WATCH_NOTIFY_TIMEOUT_MS

Example:
  HYPERMAIL_TRANSPORT=http \\
  HYPERMAIL_HTTP_PORT=8080 \\
  HYPERMAIL_OUTLOOK_CLIENT_ID=... \\
  HYPERMAIL_DATA_DIR=/data/hypermail \\
  hypermail-mcp
`;
}
