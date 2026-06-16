import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { homedir } from "node:os";
import path from "node:path";

import { KEY_LEN, parseEnvKey, resolveDataDir, resolveKey } from "./crypto.js";

const MANAGED_KEYS = [
  "HYPERMAIL_DATA_DIR",
  "HYPERMAIL_KEY",
  "HYPERMAIL_MCP_DATA_DIR",
  "HYPERMAIL_MCP_KEY",
  "XDG_DATA_HOME",
];

function cleanEnv() {
  for (const key of MANAGED_KEYS) delete process.env[key];
}

describe("storage config resolution", () => {
  beforeEach(cleanEnv);
  afterEach(cleanEnv);

  it("uses explicit dataDir exactly as passed", () => {
    expect(resolveDataDir("relative/data")).toBe("relative/data");
    expect(resolveDataDir("~/hypermail")).toBe("~/hypermail");
  });

  it("uses HYPERMAIL_DATA_DIR when explicit dataDir is absent", () => {
    process.env.HYPERMAIL_DATA_DIR = "/env/data";
    expect(resolveDataDir()).toBe("/env/data");
  });

  it("ignores legacy HYPERMAIL_MCP_DATA_DIR", () => {
    process.env.HYPERMAIL_MCP_DATA_DIR = "/old/data";
    expect(resolveDataDir()).toBe(path.join(homedir(), ".local", "share", "hypermail-mcp"));
  });

  it("defaults to XDG data home when available", () => {
    process.env.XDG_DATA_HOME = "/xdg/data";
    expect(resolveDataDir()).toBe("/xdg/data/hypermail-mcp");
  });
});

describe("key parsing", () => {
  beforeEach(cleanEnv);
  afterEach(cleanEnv);

  it("accepts 32-byte hex keys", () => {
    const key = parseEnvKey("a".repeat(64));
    expect(key).toHaveLength(KEY_LEN);
  });

  it("accepts 32-byte base64 keys", () => {
    const raw = Buffer.alloc(KEY_LEN, 7);
    const key = parseEnvKey(raw.toString("base64"));
    expect(key?.equals(raw)).toBe(true);
  });

  it("derives passphrases to 32 bytes", () => {
    const key = parseEnvKey("not-a-32-byte-key");
    expect(key).toHaveLength(KEY_LEN);
  });

  it("resolveKey uses HYPERMAIL_KEY", async () => {
    const raw = Buffer.alloc(KEY_LEN, 9);
    process.env.HYPERMAIL_KEY = raw.toString("base64");
    const key = await resolveKey("/unused");
    expect(key.equals(raw)).toBe(true);
  });
});
