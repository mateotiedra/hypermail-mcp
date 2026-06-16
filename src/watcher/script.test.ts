import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WatchConfig } from "../config.js";
import type { EmailFull } from "../providers/types.js";
import { runNotifyCommand } from "./script.js";

const email: EmailFull = {
  id: "msg-1",
  subject: "Hello",
};

function config(command?: string, timeoutMs = 1000): WatchConfig {
  return {
    enabled: true,
    pollIntervalSeconds: 10,
    notifyCommand: command
      ? {
          command,
          timeoutMs,
          retry: { maxAttempts: 1, baseDelayMs: 1 },
        }
      : undefined,
  };
}

describe("runNotifyCommand", () => {
  let dir: string;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "hypermail-notify-test-"));
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns false when no notify command is configured", async () => {
    await expect(runNotifyCommand(email, config())).resolves.toBe(false);
  });

  it("runs the shell command with EmailFull JSON on stdin", async () => {
    const script = path.join(dir, "notify.js");
    const out = path.join(dir, "email.json");
    writeFileSync(
      script,
      "const fs = require('fs'); let data = ''; process.stdin.on('data', c => data += c); process.stdin.on('end', () => fs.writeFileSync(process.argv[2], data));",
    );

    const command = `node ${JSON.stringify(script)} ${JSON.stringify(out)}`;
    await expect(runNotifyCommand(email, config(command))).resolves.toBe(true);

    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual(email);
  });

  it("returns false for non-zero exit codes", async () => {
    await expect(
      runNotifyCommand(email, config("node -e \"process.exit(2)\"")),
    ).resolves.toBe(false);
  });

  it("returns false on timeout", async () => {
    await expect(
      runNotifyCommand(email, config("node -e \"setTimeout(() => {}, 1000)\"", 20)),
    ).resolves.toBe(false);
  });
});
