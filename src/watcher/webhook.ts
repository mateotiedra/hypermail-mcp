import type { EmailFull } from "../providers/types.js";
import type { WatchConfig } from "../config.js";

/** Post a new-email event to the configured webhook URL with exponential
 *  backoff retry. Returns `true` if delivery succeeded, `false` if all
 *  retries were exhausted. */
export async function postWebhook(
  email: EmailFull,
  config: WatchConfig,
): Promise<boolean> {
  if (!config.webhook) return false;

  const { url, retry } = config.webhook;
  const maxAttempts = retry.maxAttempts;
  const baseDelayMs = retry.baseDelayMs;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * (2 ** (attempt - 1));
      await sleep(delay);
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(email),
      });

      if (res.ok) return true;

      // eslint-disable-next-line no-console
      console.error(
        `[hypermail-watch] webhook POST ${email.id} attempt ${attempt + 1}/${maxAttempts}: HTTP ${res.status}`,
      );
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      // eslint-disable-next-line no-console
      console.error(
        `[hypermail-watch] webhook POST ${email.id} attempt ${attempt + 1}/${maxAttempts}: ${code || String(err)}`,
      );
    }
  }

  // eslint-disable-next-line no-console
  console.error(
    `[hypermail-watch] webhook delivery failed after ${maxAttempts} retries for ${email.id}`,
  );
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
