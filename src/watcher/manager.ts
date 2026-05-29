import type { AccountStore, AccountRecord } from "../store/account-store.js";
import type { Registry } from "../providers/registry.js";
import type { EmailSummary } from "../providers/types.js";

// ── types ──

export interface WatchNotification {
  type: "new_emails" | "auth_failure";
  account: string;
  /** New emails since last poll. Only present for type: "new_emails". */
  emails?: EmailSummary[];
  /** Error message. Only present for type: "auth_failure". */
  error?: string;
  /** ISO timestamp of when this notification was created. */
  timestamp: string;
}

export interface WatcherManagerOptions {
  registry: Registry;
  store: AccountStore;
  /** Polling interval per account, in seconds. */
  pollIntervalSeconds: number;
  /**
   * Called when a push notification should be sent to the connected client.
   * May be called even when no SSE session is active — the callback should
   * handle that gracefully (e.g. by catching send errors).
   */
  onNotification: (notification: WatchNotification) => void;
  /**
   * Shared in-memory buffer of pending notifications. The watcher appends
   * new entries; the check_notifications tool drains them via splice(0).
   */
  buffer: WatchNotification[];
}

// ── manager ──

export class WatcherManager {
  private readonly opts: WatcherManagerOptions;
  private timers: ReturnType<typeof setInterval>[] = [];
  private running = false;
  /** Per-account inflight guards to prevent overlapping polls. */
  private readonly inflight = new Map<string, boolean>();

  constructor(opts: WatcherManagerOptions) {
    this.opts = opts;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    const accounts = this.opts.store.listAccounts();
    for (const account of accounts) {
      this.schedulePoll(account);
    }
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  // ── internals ──

  private schedulePoll(account: AccountRecord): void {
    // Run immediately on start, then on interval.
    this.pollAccount(account).catch(() => {
      /* errors surfaced via notifications */
    });

    const timer = setInterval(() => {
      if (!this.running) return;
      this.pollAccount(account).catch(() => {
        /* errors surfaced via notifications */
      });
    }, this.opts.pollIntervalSeconds * 1000);

    this.timers.push(timer);
  }

  private async pollAccount(account: AccountRecord): Promise<void> {
    const key = account.email.toLowerCase();
    if (this.inflight.get(key)) return;
    this.inflight.set(key, true);

    try {
      const { provider } = this.opts.registry.resolveByEmail(account.email);
      const lastSeen = account.lastSeenAt;
      const limit = 25;
      let skip = 0;
      const newEmails: EmailSummary[] = [];
      let newestTimestamp = lastSeen ?? "";

      // Paginate through the inbox until we hit the lastSeen boundary.
      let hitBoundary = false;
      while (true) {
        const { items, hasMore } = await provider.listEmails(account, {
          folder: "inbox",
          limit,
          skip,
        });

        for (const item of items) {
          if (!item.receivedAt) continue;
          if (lastSeen && item.receivedAt <= lastSeen) {
            hitBoundary = true;
            break;
          }
          newEmails.push(item);
          if (item.receivedAt > newestTimestamp) {
            newestTimestamp = item.receivedAt;
          }
        }

        if (hitBoundary || !hasMore) break;
        skip += limit;
      }

      if (!lastSeen) {
        // First poll: set baseline from newest email, don't notify.
        if (newEmails.length > 0) {
          newestTimestamp = newEmails[0]!.receivedAt!;
        }
      } else if (newEmails.length > 0) {
        // Subsequent poll: notify about new emails.
        this.enqueue({
          type: "new_emails",
          account: account.email,
          emails: newEmails,
          timestamp: new Date().toISOString(),
        });
      }

      // Persist updated lastSeenAt if it changed.
      if (newestTimestamp !== (lastSeen ?? "")) {
        await this.opts.store.upsertAccount({
          ...account,
          lastSeenAt: newestTimestamp || undefined,
        });
      }
    } catch (err: unknown) {
      this.enqueue({
        type: "auth_failure",
        account: account.email,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
    } finally {
      this.inflight.delete(key);
    }
  }

  private enqueue(notification: WatchNotification): void {
    this.opts.buffer.push(notification);
    // Also try push delivery — may fail silently if no SSE connection.
    try {
      this.opts.onNotification(notification);
    } catch {
      /* push not available; tool-based polling fallback will deliver it */
    }
  }
}
