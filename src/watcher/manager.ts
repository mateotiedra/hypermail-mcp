import type { AccountRecord } from "../store/account-store.js";
import type { IAccountStore } from "../mode/types.js";
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
  store: IAccountStore;
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
  /**
   * Optional list of email addresses to watch. When provided, only these
   * accounts are polled. When omitted, all stored accounts are polled
   * (stdio mode / legacy behavior).
   */
  accountFilter?: string[];
}

// ── manager ──

export class WatcherManager {
  private readonly opts: WatcherManagerOptions;
  private timers: ReturnType<typeof setInterval>[] = [];
  private running = false;
  /** Per-account inflight guards to prevent overlapping polls. */
  private readonly inflight = new Map<string, boolean>();
  /** Accounts with active polling timers (lowercased email). */
  private readonly tracked = new Set<string>();

  constructor(opts: WatcherManagerOptions) {
    this.opts = opts;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // Initial scan — schedule polling for all matching accounts.
    this.scanAccounts();

    // Periodic re-scan to pick up accounts added after start().
    const rescanTimer = setInterval(() => {
      if (!this.running) return;
      this.scanAccounts();
    }, this.opts.pollIntervalSeconds * 1000);
    this.timers.push(rescanTimer);
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.tracked.clear();
  }

  // ── internals ──

  private async scanAccounts(): Promise<void> {
    let accounts = await this.opts.store.listAccounts();
    if (this.opts.accountFilter) {
      const filter = new Set(this.opts.accountFilter.map((e) => e.toLowerCase()));
      accounts = accounts.filter((a) => filter.has(a.email.toLowerCase()));
    }
    for (const account of accounts) {
      this.schedulePoll(account);
    }
  }

  private schedulePoll(account: AccountRecord): void {
    const key = account.email.toLowerCase();
    if (this.tracked.has(key)) return;
    this.tracked.add(key);

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
      const { provider } = await this.opts.registry.resolveByEmail(account.email);
      const seenIds = new Set(account.lastSeenIds ?? []);
      const isFirstPoll = !account.lastSeenAt && !account.lastSeenIds?.length;
      const limit = 25;
      const MAX_PAGES = 5;
      let skip = 0;
      let pageCount = 0;
      const newEmails: EmailSummary[] = [];
      let newestTimestamp = account.lastSeenAt ?? "";

      // Paginate through inbox until we hit a previously seen email ID
      // or exhaust available pages.
      let hitBoundary = false;
      while (pageCount < MAX_PAGES) {
        const { items, hasMore } = await provider.listEmails(account, {
          folder: "inbox",
          limit,
          skip,
        });
        pageCount++;

        for (const item of items) {
          if (!item.receivedAt) continue;
          if (seenIds.has(item.id)) {
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

      // First poll: set baseline silently. Subsequent polls: notify.
      if (!isFirstPoll && newEmails.length > 0) {
        this.enqueue({
          type: "new_emails",
          account: account.email,
          emails: newEmails,
          timestamp: new Date().toISOString(),
        });
      }

      // Persist updated state: prepend new IDs to lastSeenIds (cap 200),
      // update lastSeenAt. On empty-inbox first poll, mark current time
      // as baseline so future polls exit first-poll mode.
      if (isFirstPoll && newEmails.length === 0 && !newestTimestamp) {
        newestTimestamp = new Date().toISOString();
      }
      const newIds = newEmails.map((e) => e.id);
      const updatedLastSeenIds = [
        ...newIds,
        ...(account.lastSeenIds ?? []),
      ].slice(0, 200);

      try {
        await this.opts.store.upsertAccount({
          ...account,
          lastSeenAt: newestTimestamp || undefined,
          lastSeenIds: updatedLastSeenIds,
        });
      } catch (storeErr) {
        // eslint-disable-next-line no-console
        console.error(
          "[hypermail-mcp] failed to persist poll state for",
          account.email,
          ":",
          storeErr instanceof Error ? storeErr.message : String(storeErr),
        );
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
