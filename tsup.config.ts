import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: false,
  shims: false,
  banner: { js: "#!/usr/bin/env node" },
  // Keep the MCP SDK bundled so npx installs do not depend on a partially
  // populated nested SDK package cache at runtime. Keep optional native deps
  // external so install does not fail on platforms without them.
  noExternal: ["@modelcontextprotocol/sdk"],
  external: ["keytar"],
});
