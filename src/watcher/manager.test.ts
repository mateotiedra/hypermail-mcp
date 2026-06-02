import { describe, it, expect, vi, beforeEach } from "vitest";
import { WatcherManager } from "./manager.js";
import type { AccountRecord } from "../store/account-store.js";
import type { Registry } from "../providers/registry.js";
import type {
  EmailProvider,
  EmailSummary,
  ListEmailsResult,
} from "../providers/types.js";
import type { WatchNotification } from "./manager.js";

// ── helpers ──

function mockAccount(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    email: "test@example.com",
    provider: "outlook",
    tokens: {},
    addedAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockListResult(
  items: EmailSummary[],
  hasMore = false,
): ListEmailsResult {
  return { items, hasMore };
}

function mockEmail(id: string, receivedAt: string): EmailSummary {
  return {
    id,
    subject: `Subject ${id}`,
    receivedAt,
    from: { address: "sender@example.com" },
  };
}

function mockProvider(listEmailsImpl: any): EmailProvider {
  return {
    id: "outlook",
    listEmails: listEmailsImpl,
    addAccount: vi.fn().mockRejectedValue(new Error("not implemented")),
    searchEmails: vi.fn().mockResolvedValue([]),
    readEmail: vi.fn().mockRejectedValue(new Error("not implemented")),
    readAttachment: vi.fn().mockRejectedValue(new Error("not implemented")),
    sendEmail: vi.fn().mockResolvedValue({ id: "" }),
    saveDraft: vi.fn().mockResolvedValue({ id: "" }),
    updateDraft: vi.fn().mockResolvedValue({ id: "" }),
    moveEmail: vi.fn().mockResolvedValue(undefined),
    sendDraft: vi.fn().mockResolvedValue({ id: "" }),
    addAttachmentToDraft: vi
      .fn()
      .mockRejectedValue(new Error("not implemented")),
    markRead: vi.fn().mockResolvedValue(undefined),
    listFolders: vi.fn().mockResolvedValue([]),
    createFolder: vi.fn().mockRejectedValue(new Error("not implemented")),
    renameFolder: vi.fn().mockRejectedValue(new Error("not implemented")),
    deleteFolder: vi.fn().mockRejectedValue(new Error("not implemented")),
  };
}

// Helper: returns a promise that resolves when upsertAccount is called.
// Used to synchronize tests with async pollAccount completion.
function upsertSync() {
  let resolve: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  const fn = vi.fn().mockImplementation(() => {
    resolve();
    return Promise.resolve(undefined);
  });
  return { fn, promise };
}

// ── tests ──

describe("WatcherManager.pollAccount", () => {
  let buffer: WatchNotification[];
  let onNotification: ReturnType<typeof vi.fn>;
  let storeListAccounts: ReturnType<typeof vi.fn>;
  let storeUpsert: ReturnType<typeof vi.fn>;
  let storeGetAccount: ReturnType<typeof vi.fn>;
  let listEmails: any;
  let provider: EmailProvider;
  let registry: Registry;
  /** The account record returned by listAccounts — mutated per-test. */
  let accountRec: AccountRecord;

  beforeEach(() => {
    buffer = [];
    onNotification = vi.fn();
    listEmails = vi.fn();
    provider = mockProvider(listEmails);
    accountRec = mockAccount();
    storeListAccounts = vi.fn().mockReturnValue([accountRec]);
    storeUpsert = vi.fn().mockResolvedValue(undefined);
    storeGetAccount = vi.fn().mockReturnValue(accountRec);
    registry = {
      get: vi.fn(),
      resolveByEmail: vi.fn().mockReturnValue({ provider, account: accountRec }),
      list: vi.fn(),
    };
  });

  function createWatcher(): WatcherManager {
    return new WatcherManager({
      registry,
      store: { listAccounts: storeListAccounts, upsertAccount: storeUpsert, getAccount: storeGetAccount } as any,
      pollIntervalSeconds: 60,
      onNotification,
      buffer,
    });
  }

  function startAndWaitForUpsert(): Promise<void> {
    const w = createWatcher();
    let resolve: () => void;
    const upserted = new Promise<void>((r) => {
      resolve = r;
    });
    storeUpsert.mockImplementation(() => {
      resolve();
      return Promise.resolve(undefined);
    });
    w.start();
    return upserted;
  }

  // ── 1. First poll sets baseline silently ──

  it("does not notify on first poll — sets baseline", async () => {
    listEmails.mockResolvedValueOnce(
      mockListResult([mockEmail("A", "2025-01-01T10:00:00Z")]),
    );

    await startAndWaitForUpsert();

    expect(buffer).toHaveLength(0);
    expect(onNotification).not.toHaveBeenCalled();
    // Should persist seen IDs and timestamp
    const upsertCall = storeUpsert.mock.calls[0]?.[0] as AccountRecord;
    expect(upsertCall.lastSeenIds).toEqual(["A"]);
    expect(upsertCall.lastSeenAt).toBe("2025-01-01T10:00:00Z");
  });

  // ── 2. Subsequent poll detects new email ──

  it("notifies on subsequent poll when new email arrives", async () => {
    // Simulate a previous poll by having listAccounts return an account
    // with lastSeenIds and lastSeenAt already set.
    accountRec.lastSeenAt = "2025-01-01T10:00:00Z";
    accountRec.lastSeenIds = ["A", "B"];

    listEmails.mockResolvedValueOnce(
      mockListResult([mockEmail("C", "2025-01-01T12:00:00Z")]),
    );

    await startAndWaitForUpsert();

    expect(buffer).toHaveLength(1);
    expect(buffer[0]!.type).toBe("new_emails");
    expect(buffer[0]!.emails).toEqual([
      expect.objectContaining({ id: "C" }),
    ]);
    // lastSeenIds should prepend new IDs
    const upsertCall = storeUpsert.mock.calls[0]?.[0] as AccountRecord;
    expect(upsertCall.lastSeenIds).toEqual(["C", "A", "B"]);
  });

  // ── 3. Seen ID stops pagination ──

  it("stops paginating when a seen email ID is encountered", async () => {
    accountRec.lastSeenAt = "2025-01-01T12:00:00Z";
    accountRec.lastSeenIds = ["A"];

    // Page 1: "B" (new), then "A" (seen) → should stop after "B" on this page
    listEmails.mockResolvedValueOnce(
      mockListResult(
        [
          mockEmail("B", "2025-01-01T13:00:00Z"),
          mockEmail("A", "2025-01-01T10:00:00Z"),
        ],
        false,
      ),
    );

    await startAndWaitForUpsert();

    expect(buffer).toHaveLength(1);
    // Only "B" should be notified; "A" is already seen
    expect(buffer[0]!.emails).toEqual([
      expect.objectContaining({ id: "B" }),
    ]);
    // Should NOT have fetched page 2 (boundary hit on page 1)
    expect(listEmails).toHaveBeenCalledTimes(1);
  });

  // ── 4. Same-timestamp email is NOT lost ──

  it("does not lose emails with the same receivedAt as lastSeenAt", async () => {
    // This is the critical bug fix: two emails with identical timestamps
    // should both be detected as new on the first poll after baseline.
    accountRec.lastSeenAt = "2025-01-01T10:00:00Z";
    accountRec.lastSeenIds = ["A"]; // "A" was seen previously at T=10:00

    // New poll: "B" arrives with same timestamp T=10:00 but different ID
    listEmails.mockResolvedValueOnce(
      mockListResult([mockEmail("B", "2025-01-01T10:00:00Z")]),
    );

    await startAndWaitForUpsert();

    // "B" should be detected as new even though timestamp equals lastSeenAt
    expect(buffer).toHaveLength(1);
    expect(buffer[0]!.emails).toEqual([
      expect.objectContaining({ id: "B" }),
    ]);
  });

  // ── 5. Storage error does not surface as auth_failure ──

  it("does not report auth_failure when upsert fails", async () => {
    listEmails.mockResolvedValueOnce(
      mockListResult([mockEmail("A", "2025-01-01T10:00:00Z")]),
    );

    // Storage failure — should be logged, not reported as auth_failure
    storeUpsert.mockRejectedValue(new Error("disk full"));

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const w = createWatcher();
    w.start();
    // Wait for listEmails to be called, then a tick for error handling.
    await vi.waitFor(() => {
      expect(listEmails).toHaveBeenCalled();
    });
    await new Promise((r) => setTimeout(r, 50));

    // No auth_failure notification
    const authFailures = buffer.filter((n) => n.type === "auth_failure");
    expect(authFailures).toHaveLength(0);

    // Storage error should be logged
    expect(consoleError).toHaveBeenCalledWith(
      "[hypermail-mcp] failed to persist poll state for",
      "test@example.com",
      ":",
      expect.stringContaining("disk full"),
    );

    consoleError.mockRestore();
  });

  // ── 6. Auth failure on provider error ──

  it("reports auth_failure when provider listEmails throws", async () => {
    listEmails.mockRejectedValueOnce(new Error("401 Unauthorized"));

    const w = createWatcher();
    let resolve: () => void;
    const enqueued = new Promise<void>((r) => {
      resolve = r;
    });
    // Track when buffer gets the auth_failure
    const origPush = buffer.push.bind(buffer);
    buffer.push = function (item: WatchNotification) {
      const result = origPush(item);
      if (item.type === "auth_failure") resolve();
      return result;
    };

    w.start();
    await enqueued;

    const authFailures = buffer.filter((n) => n.type === "auth_failure");
    expect(authFailures).toHaveLength(1);
    expect(authFailures[0]!.error).toContain("401 Unauthorized");
    expect(authFailures[0]!.account).toBe("test@example.com");
  });

  // ── 7. Inflight guard prevents overlapping polls ──

  it("skips overlapping polls for the same account", async () => {
    // First poll is slow (never resolves)
    let neverResolve: () => void = () => {};
    const slowPromise = new Promise<never>(() => {});
    listEmails.mockReturnValueOnce(slowPromise);

    const w = createWatcher();
    storeUpsert.mockResolvedValue(undefined);

    w.start();

    // Wait a tick for the first poll to start
    await new Promise((r) => setTimeout(r, 10));

    // Manually trigger a second poll for the same account via the scanAccounts
    // method (simulating interval re-scan). The inflight guard should skip it.
    // We call the private method via any-cast.
    (w as any).scanAccounts();

    // Only one call to listEmails (from the first poll)
    expect(listEmails).toHaveBeenCalledTimes(1);
  });

  // ── 8. Max pages cap on first poll ──

  it("caps pagination at MAX_PAGES (5) on first poll", async () => {
    // 6 pages available — should stop after 5
    listEmails.mockResolvedValue(
      mockListResult(
        [mockEmail("X", "2025-01-01T10:00:00Z")],
        true, // hasMore = true
      ),
    );

    await startAndWaitForUpsert();

    // Should have called listEmails exactly 5 times
    expect(listEmails).toHaveBeenCalledTimes(5);
    // Skip should increase: 0, 25, 50, 75, 100
    const skips = listEmails.mock.calls.map(
      (c: any[]) => (c[1] as any).skip,
    );
    expect(skips).toEqual([0, 25, 50, 75, 100]);
  });

  // ── 9. Empty inbox on first poll exits first-poll mode ──

  it("sets timestamp baseline on empty-inbox first poll", async () => {
    listEmails.mockResolvedValueOnce(mockListResult([], false));

    await startAndWaitForUpsert();

    // No notification
    expect(buffer).toHaveLength(0);

    // Should persist a timestamp sentinel so next poll isn't first-poll mode
    const upsertCall = storeUpsert.mock.calls[0]?.[0] as AccountRecord;
    expect(upsertCall.lastSeenAt).toBeTruthy();
    expect(upsertCall.lastSeenIds).toEqual([]);
    // Verify it's a valid ISO timestamp
    expect(new Date(upsertCall.lastSeenAt!).getTime()).toBeGreaterThan(0);
  });
});
