import { startServer } from "./server.js";
import { loadConfig } from "./config.js";
import { generateKey, helpText, parseArgs } from "./cli-args.js";

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.command === "generate-key") {
    process.stdout.write(generateKey() + "\n");
    return;
  }

  if (opts.help) {
    process.stdout.write(helpText());
    return;
  }

  const { config, warnings } = loadConfig(opts.overrides);
  for (const warning of warnings) {
    process.stderr.write(`[hypermail-mcp] warning: ${warning}\n`);
  }

  await startServer({ config });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[hypermail-mcp] fatal:", err);
  process.exit(1);
});
