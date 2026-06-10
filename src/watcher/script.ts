import { spawn } from "node:child_process";
import type { EmailFull } from "../providers/types.js";
import type { WatchConfig } from "../config.js";

/**
 * Execute the configured script with a new-email JSON payload on stdin.
 * Supports exponential backoff retry — mirrors {@link postWebhook}.
 *
 * Returns `true` if the script exited with code 0, `false` if all retries
 * were exhausted or the script timed out.
 */
export async function runScript(
  email: EmailFull,
  config: WatchConfig,
): Promise<boolean> {
  if (!config.script) return false;

  const { path: scriptPath, timeoutMs, retry } = config.script;
  const maxAttempts = retry?.maxAttempts ?? 5;
  const baseDelayMs = retry?.baseDelayMs ?? 1000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * (2 ** (attempt - 1));
      await sleep(delay);
    }

    try {
      const ok = await spawnWithTimeout(
        scriptPath,
        JSON.stringify(email),
        timeoutMs,
      );

      if (ok) return true;

      // eslint-disable-next-line no-console
      console.error(
        `[hypermail-watch] script ${email.id} attempt ${attempt + 1}/${maxAttempts}: non-zero exit code`,
      );
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error(
        `[hypermail-watch] script ${email.id} attempt ${attempt + 1}/${maxAttempts}: ${String(err)}`,
      );
    }
  }

  // eslint-disable-next-line no-console
  console.error(
    `[hypermail-watch] script delivery failed after ${maxAttempts} retries for ${email.id}`,
  );
  return false;
}

// ── helpers ──

/**
 * Spawn `node <scriptPath>`, pipe `stdinData` to stdin, and resolve when the
 * child exits or the timeout fires.
 *
 * Timeout kills the child with SIGTERM and resolves `false`. A non-zero exit
 * code also resolves `false` (retry is handled by the caller).
 */
function spawnWithTimeout(
  scriptPath: string,
  stdinData: string,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("node", [scriptPath], {
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
        console.error(`[hypermail-watch] script timed out after ${timeoutMs}ms. stderr:\n${stderr}`);
      }
      resolve(false);
    }, timeoutMs);

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (stderr && code !== 0) {
        // eslint-disable-next-line no-console
        console.error(`[hypermail-watch] script stderr:\n${stderr}`);
      }
      resolve(code === 0);
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      // eslint-disable-next-line no-console
      console.error(`[hypermail-watch] script spawn error: ${err.message}`);
      resolve(false);
    });

    // Pipe the full Email JSON to stdin and close the stream.
    child.stdin?.end(stdinData);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
