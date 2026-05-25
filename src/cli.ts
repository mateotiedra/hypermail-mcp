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
  All server settings (data dir, HTTP, tool filtering, provider credentials)
  live in hypermail-config.json. Pass it via --config.

Example hypermail-config.json:
  {
    "dataDir": "/path/to/data",
    "http": { "enabled": false },
    "tools": { "disabled": ["send_email"] },
    "providers": {
      "outlook": { "clientId": "\${MS_CLIENT_ID}", "tenantId": "\${MS_TENANT_ID}" }
    }
  }
`;
  process.stdout.write(msg);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
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
