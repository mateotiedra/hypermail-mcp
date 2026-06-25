import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AccountStore, type AccountRecord } from "./account-store.js";

const key = Buffer.alloc(32, 7);

function account(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    email: "a@example.com",
    provider: "outlook",
    tokens: { initial: true },
    addedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function withStore<T>(fn: (store: AccountStore) => Promise<T>): Promise<T> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "hypermail-account-store-"));
  try {
    const store = await AccountStore.open({ dataDir, key });
    return await fn(store);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

describe("AccountStore", () => {
  it("preserves token and checkpoint fields across concurrent field updates", async () => {
    await withStore(async (store) => {
      await store.upsertAccount(account({
        newEmailCheckpoint: {
          receivedAt: "2026-01-01T00:00:00.000Z",
          deliveredIdsAtReceivedAt: ["old"],
        },
      }));

      await Promise.all([
        store.updateTokens("a@example.com", { refreshed: 1 }),
        store.updateNewEmailCheckpoint("a@example.com", {
          receivedAt: "2026-01-02T00:00:00.000Z",
          deliveredIdsAtReceivedAt: ["m1"],
        }),
      ]);

      const updated = store.getAccount("a@example.com");
      expect(updated?.tokens).toEqual({ refreshed: 1 });
      expect(updated?.newEmailCheckpoint).toEqual({
        receivedAt: "2026-01-02T00:00:00.000Z",
        deliveredIdsAtReceivedAt: ["m1"],
      });
    });
  });

  it("unions delivered IDs when advancing at the same receivedAt", async () => {
    await withStore(async (store) => {
      await store.upsertAccount(account({
        newEmailCheckpoint: {
          receivedAt: "2026-01-01T00:00:00.000Z",
          deliveredIdsAtReceivedAt: ["a", "b"],
        },
      }));

      await store.updateNewEmailCheckpoint("a@example.com", {
        receivedAt: "2026-01-01T00:00:00.000Z",
        deliveredIdsAtReceivedAt: ["b", "c"],
      });

      expect(store.getAccount("a@example.com")?.newEmailCheckpoint).toEqual({
        receivedAt: "2026-01-01T00:00:00.000Z",
        deliveredIdsAtReceivedAt: ["a", "b", "c"],
      });
    });
  });

  it("replaces delivered IDs when advancing to a newer receivedAt", async () => {
    await withStore(async (store) => {
      await store.upsertAccount(account({
        newEmailCheckpoint: {
          receivedAt: "2026-01-01T00:00:00.000Z",
          deliveredIdsAtReceivedAt: ["old"],
        },
      }));

      await store.updateNewEmailCheckpoint("a@example.com", {
        receivedAt: "2026-01-02T00:00:00.000Z",
        deliveredIdsAtReceivedAt: ["new"],
      });

      expect(store.getAccount("a@example.com")?.newEmailCheckpoint).toEqual({
        receivedAt: "2026-01-02T00:00:00.000Z",
        deliveredIdsAtReceivedAt: ["new"],
      });
    });
  });

  it("does not create accounts from field updates", async () => {
    await withStore(async (store) => {
      await expect(store.updateTokens("missing@example.com", { refreshed: 1 }))
        .resolves.toBeUndefined();
      await expect(store.updateNewEmailCheckpoint("missing@example.com", {
        receivedAt: "2026-01-01T00:00:00.000Z",
        deliveredIdsAtReceivedAt: ["m1"],
      })).resolves.toBeUndefined();

      expect(store.listAccounts()).toEqual([]);
    });
  });

  it("keeps upsertAccount available for account creation", async () => {
    await withStore(async (store) => {
      await store.upsertAccount(account());
      await store.updateNewEmailCheckpoint("a@example.com", {
        receivedAt: "2026-01-01T00:00:00.000Z",
        deliveredIdsAtReceivedAt: ["m1"],
      });
      await store.updateTokens("a@example.com", { refreshed: true });

      expect(store.getAccount("a@example.com")).toMatchObject({
        email: "a@example.com",
        provider: "outlook",
        tokens: { refreshed: true },
        newEmailCheckpoint: {
          receivedAt: "2026-01-01T00:00:00.000Z",
          deliveredIdsAtReceivedAt: ["m1"],
        },
      });
    });
  });
});
