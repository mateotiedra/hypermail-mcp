import { spawn } from "node:child_process";
import type { EmailFull } from "../providers/types.js";
import type { WatchConfig } from "../config.js";

/**
 * Execute the configured notification command with a new-email JSON payload on
 * stdin. Supports exponential backoff retry — mirrors {@link postWebhook}.
 *
 * Returns `true` if the command exited with code 0, `false` if all retries
 * were exhausted or the command timed out.
 */
export async function runNotifyCommand(
  email: EmailFull,
  config: WatchConfig,
): Promise<boolean> {
  if (!config.notifyCommand) return false;

  const { command, timeoutMs, retry } = config.notifyCommand;
  const maxAttempts = retry.maxAttempts;
  const baseDelayMs = retry.baseDelayMs;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * (2 ** (attempt - 1));
      await sleep(delay);
    }

    try {
      const ok = await spawnWithTimeout(
        command,
        JSON.stringify(email),
        timeoutMs,
      );

      if (ok) return true;

      // eslint-disable-next-line no-console
      console.error(
        `[hypermail-watch] notify command ${email.id} attempt ${attempt + 1}/${maxAttempts}: non-zero exit code`,
      );
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error(
        `[hypermail-watch] notify command ${email.id} attempt ${attempt + 1}/${maxAttempts}: ${String(err)}`,
      );
    }
  }

  // eslint-disable-next-line no-console
  console.error(
    `[hypermail-watch] notify command delivery failed after ${maxAttempts} retries for ${email.id}`,
  );
  return false;
}

// ── helpers ──

/**
 * Spawn the configured shell command, pipe `stdinData` to stdin, and resolve
 * when the child exits or the timeout fires.
 *
 * Timeout kills the child with SIGTERM and resolves `false`. A non-zero exit
 * code also resolves `false` (retry is handled by the caller).
 */
function spawnWithTimeout(
  command: string,
  stdinData: string,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    // Timeout guard — SIGTERM the child and move on.
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      if (stderr) {
        // eslint-disable-next-line no-console
        console.error(`[hypermail-watch] notify command timed out after ${timeoutMs}ms. stderr:\n${stderr}`);
      }
      resolve(false);
    }, timeoutMs);

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (stderr && code !== 0) {
        // eslint-disable-next-line no-console
        console.error(`[hypermail-watch] notify command stderr:\n${stderr}`);
      }
      resolve(code === 0);
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      // eslint-disable-next-line no-console
      console.error(`[hypermail-watch] notify command spawn error: ${err.message}`);
      resolve(false);
    });

    // Pipe the full Email JSON to stdin and close the stream.
    child.stdin?.end(stdinData);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
