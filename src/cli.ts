import { randomBytes } from "node:crypto";

import { startServer } from "./server.js";
import { loadConfig } from "./config.js";
import { createSoloPlugin } from "./mode/solo.js";
import type { ModePlugin } from "./mode/types.js";

type ParsedArgs = {
  mode: "solo" | "multi";
  http: boolean;
  port: number;
  host: string;
  dataDir?: string;
  config?: string;
  agentsConfig?: string;
  help: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    mode: "solo",
    http: false,
    port: 3000,
    host: "127.0.0.1",
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--mode":
        out.mode = String(argv[++i] ?? "solo") as "solo" | "multi";
        break;
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
      case "--agents-config":
        out.agentsConfig = String(argv[++i] ?? "");
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
  --mode <solo|multi>  Operation mode (default: solo)
                        solo:  file-based stores, no DB, no auth
                        multi: PostgreSQL-backed, x-api-key auth, admin API
  --http               Run as Streamable HTTP server (default: stdio)
  --port <n>           HTTP port (default: 3000)
  --host <addr>        HTTP bind address (default: 127.0.0.1)
  --data-dir <path>    Where to store data files (solo mode)
                        (default: $HYPERMAIL_MCP_DATA_DIR or ~/.hypermail-mcp)
  --config <path>      Path to hypermail-config.json
  --agents-config <path>  Path to agents.yaml (solo mode only)
  -h, --help           Show this help

Multi mode env vars:
  DATABASE_URL              PostgreSQL connection string (required)
  HYPERMAIL_ENCRYPTION_KEY  Encryption key for OAuth tokens (required)
  HYPERMAIL_ADMIN_KEY       Admin API bearer token (optional — no admin API if unset)
`;
  process.stdout.write(msg);
}

function validateMultiMode(): void {
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.error(
      "Fatal: --mode multi requires DATABASE_URL env var.\n" +
        "Set it to a PostgreSQL connection string, e.g.\n" +
        "  export DATABASE_URL='postgresql://user:pass@localhost:5432/hypermail'",
    );
    process.exit(1);
  }
  if (!process.env.HYPERMAIL_ENCRYPTION_KEY) {
    // eslint-disable-next-line no-console
    console.error(
      "Fatal: --mode multi requires HYPERMAIL_ENCRYPTION_KEY env var.\n" +
        "Generate one with: openssl rand -hex 32",
    );
    process.exit(1);
  }
}

async function createPlugin(opts: ParsedArgs): Promise<ModePlugin> {
  if (opts.mode === "multi") {
    validateMultiMode();
    // Multi plugin will be imported dynamically (Phase 4)
    const { createMultiPlugin } = await import("./mode/multi.js");
    return createMultiPlugin();
  }

  // Solo mode
  return createSoloPlugin({
    agentsConfigPath: opts.agentsConfig,
  });
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

  // Multi mode implicitly enables HTTP
  const httpEnabled = opts.http || opts.mode === "multi";

  const config = loadConfig(opts.config, {
    http: httpEnabled,
    port: opts.port,
    host: opts.host,
    dataDir: opts.dataDir,
    agentsConfig: opts.agentsConfig,
  });

  const plugin = await createPlugin(opts);

  await startServer({ config, plugin });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[hypermail-mcp] fatal:", err);
  process.exit(1);
});
