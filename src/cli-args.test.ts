import { describe, it, expect } from "vitest";

import { generateKey, helpText, parseArgs } from "./cli-args.js";

describe("parseArgs", () => {
  it("parses selected CLI overrides", () => {
    const parsed = parseArgs([
      "--http",
      "--port",
      "8080",
      "--host",
      "0.0.0.0",
      "--data-dir",
      "/data",
    ]);

    expect(parsed).toEqual({
      help: false,
      version: false,
      overrides: {
        transport: "http",
        port: 8080,
        host: "0.0.0.0",
        dataDir: "/data",
      },
    });
  });

  it("parses help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("parses generate-key subcommand", () => {
    expect(parseArgs(["generate-key"]).command).toBe("generate-key");
  });

  it("parses version", () => {
    expect(parseArgs(["--version"]).version).toBe(true);
  });

  it("rejects --config", () => {
    expect(() => parseArgs(["--config", "hypermail-config.json"])).toThrow(
      "Unknown option: --config",
    );
  });

  it("rejects unknown flags", () => {
    expect(() => parseArgs(["--bogus"])).toThrow("Unknown option: --bogus");
  });

  it("rejects missing flag values", () => {
    expect(() => parseArgs(["--port"])).toThrow("--port requires a value");
  });
});

describe("generateKey", () => {
  it("outputs a base64-encoded 32-byte key", () => {
    const key = generateKey();
    const decoded = Buffer.from(key, "base64");
    expect(decoded).toHaveLength(32);
    expect(decoded.toString("base64")).toBe(key);
  });
});

describe("helpText", () => {
  it("documents env-only configuration without --config", () => {
    const text = helpText();
    expect(text).toContain("--version");
    expect(text).toContain("HYPERMAIL_TRANSPORT=stdio|http");
    expect(text).toContain("HYPERMAIL_DATA_DIR");
    expect(text).not.toContain("--config");
    expect(text).not.toContain("hypermail-config.json");
  });
});
