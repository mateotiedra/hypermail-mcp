import type { AccountStore } from "../store/account-store.js";
import type { Registry } from "../providers/registry.js";
import type { WatchConfig } from "../config.js";
import type { EmailFull } from "../providers/types.js";
import { postWebhook } from "./webhook.js";

/**
 * Polls all accounts' inboxes on an interval, detects new emails via
 * {@link AccountRecord.lastSeenIds}, and emits them via the webhook HTTP
 * client.
 *
 * Instantiated once at server startup when `config.watch.enabled` is true.
 * Gated behind `HYPERMAIL_WATCH_ENABLED` or explicit config opt-in — both
 * default to off.
 */
export class WatcherManager {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: AccountStore,
    private readonly registry: Registry,
    private readonly config: WatchConfig,
  ) {}

  /** Start the poll loop. Fires immediately on the first tick, then every
   *  `pollIntervalSeconds`. Safe to call multiple times — subsequent calls
   *  are no-ops. */
  start(): void {
    if (this.intervalId !== null) return;
    this.poll(); // immediate first poll
    this.intervalId = setInterval(
      () => this.poll(),
      this.config.pollIntervalSeconds * 1000,
    );
  }

  /** Stop the poll loop and release the interval. Safe to call when already
   *  stopped. */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // ── private ──

  private async poll(): Promise<void> {
    const accounts = this.store.listAccounts();
    for (const acct of accounts) {
      try {
        await this.pollAccount(acct.email);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `[hypermail-watch] poll failed for ${acct.email}:`,
          err,
        );
      }
    }
  }

  private async pollAccount(email: string): Promise<void> {
    const { provider, account } = this.registry.resolveByEmail(email);
    const result = await provider.listEmails(account, {
      folder: "inbox",
      limit: 50,
    });

    const knownIds = [...(account.lastSeenIds ?? [])];
    const newEmails = result.items.filter((e) => !knownIds.includes(e.id));

    if (newEmails.length === 0) return;

    for (const summary of newEmails) {
      try {
        const full: EmailFull = await provider.readEmail(account, summary.id);
        await this.emit(full);
        knownIds.unshift(summary.id);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `[hypermail-watch] emission failed for ${email}/${summary.id}:`,
          err,
        );
      }
    }

    // Cap at 200 and persist through the encrypted store.
    const capped = knownIds.slice(0, 200);
    await this.store.upsertAccount({ ...account, lastSeenIds: capped });
  }

  private async emit(full: EmailFull): Promise<void> {
    await postWebhook(full, this.config);
  }
}
