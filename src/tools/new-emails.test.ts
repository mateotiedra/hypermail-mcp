import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { registerNewEmailTool } from "./new-emails.js";
import { AccountStore, type AccountRecord, type NewEmailClaimCandidate } from "../store/account-store.js";
import type { EmailProvider, EmailSummary } from "../providers/types.js";
import type { Registry } from "../providers/registry.js";
import type { ResolvedTools } from "../config.js";

const tools: ResolvedTools = { enabledTools: null, disabledTools: null };

type Handler = (args: { account?: string; limit?: number }) => Promise<unknown>;

function account(email: string, checkpoint?: AccountRecord["newEmailCheckpoint"]): AccountRecord {
  return {
    email,
    provider: "imap",
    tokens: {},
    addedAt: "2026-01-01T00:00:00.000Z",
    newEmailCheckpoint: checkpoint,
  };
}

function summary(id: string, receivedAt: string, subject = id): EmailSummary {
  return { id, subject, receivedAt, folder: "inbox" };
}

function normalizeTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => id.length > 0))];
}

function mergeCheckpoint(
  current: AccountRecord["newEmailCheckpoint"],
  incoming: AccountRecord["newEmailCheckpoint"],
): AccountRecord["newEmailCheckpoint"] {
  const currentAt = normalizeTimestamp(current?.receivedAt);
  const incomingAt = normalizeTimestamp(incoming?.receivedAt);
  if (!incomingAt) return currentAt
    ? { receivedAt: currentAt, deliveredIdsAtReceivedAt: uniqueIds(current?.deliveredIdsAtReceivedAt ?? []) }
    : undefined;
  if (!currentAt || incomingAt > currentAt) {
    return { receivedAt: incomingAt, deliveredIdsAtReceivedAt: uniqueIds(incoming?.deliveredIdsAtReceivedAt ?? []) };
  }
  if (incomingAt < currentAt) {
    return { receivedAt: currentAt, deliveredIdsAtReceivedAt: uniqueIds(current?.deliveredIdsAtReceivedAt ?? []) };
  }
  return {
    receivedAt: currentAt,
    deliveredIdsAtReceivedAt: uniqueIds([
      ...(current?.deliveredIdsAtReceivedAt ?? []),
      ...(incoming?.deliveredIdsAtReceivedAt ?? []),
    ]),
  };
}

function isDelivered(
  checkpoint: AccountRecord["newEmailCheckpoint"],
  receivedAt: string,
  ids: string[],
): boolean {
  const checkpointAt = normalizeTimestamp(checkpoint?.receivedAt);
  if (!checkpointAt) return false;
  if (receivedAt < checkpointAt) return true;
  if (receivedAt > checkpointAt) return false;
  const delivered = new Set(checkpoint?.deliveredIdsAtReceivedAt ?? []);
  return ids.some((id) => delivered.has(id));
}

function memoryStore(initial: AccountRecord[]): AccountStore {
  const records = new Map(initial.map((rec) => [rec.email, { ...rec }]));
  return {
    listAccounts: vi.fn(() => Array.from(records.values()).map((rec) => ({ ...rec }))),
    getAccount: vi.fn((email: string) => {
      const rec = records.get(email.toLowerCase());
      return rec ? { ...rec } : undefined;
    }),
    upsertAccount: vi.fn(async (rec: AccountRecord) => {
      records.set(rec.email.toLowerCase(), { ...rec });
      return { ...rec };
    }),
    updateTokens: vi.fn(async (email: string, tokens: AccountRecord["tokens"]) => {
      const rec = records.get(email.toLowerCase());
      if (!rec) return undefined;
      const next = { ...rec, tokens };
      records.set(email.toLowerCase(), next);
      return { ...next };
    }),
    updateNewEmailCheckpoint: vi.fn(async (
      email: string,
      checkpoint: NonNullable<AccountRecord["newEmailCheckpoint"]>,
    ) => {
      const rec = records.get(email.toLowerCase());
      if (!rec) return undefined;
      const merged = mergeCheckpoint(rec.newEmailCheckpoint, checkpoint);
      const next = { ...rec, newEmailCheckpoint: merged };
      records.set(email.toLowerCase(), next);
      return { ...next };
    }),
    claimNewEmails: vi.fn(async (email: string, candidates: NewEmailClaimCandidate[]) => {
      const rec = records.get(email.toLowerCase());
      if (!rec) return [];
      let checkpoint = rec.newEmailCheckpoint;
      const claimed: string[] = [];
      const ordered = [...candidates].sort((a, b) => {
        const byTimestamp = (normalizeTimestamp(a.receivedAt) ?? a.receivedAt)
          .localeCompare(normalizeTimestamp(b.receivedAt) ?? b.receivedAt);
        if (byTimestamp !== 0) return byTimestamp;
        return a.summaryId.localeCompare(b.summaryId);
      });
      for (const candidate of ordered) {
        const receivedAt = normalizeTimestamp(candidate.receivedAt);
        if (!receivedAt) continue;
        const ids = uniqueIds([candidate.summaryId, ...candidate.ids]);
        if (isDelivered(checkpoint, receivedAt, ids)) continue;
        claimed.push(candidate.summaryId);
        checkpoint = mergeCheckpoint(checkpoint, {
          receivedAt,
          deliveredIdsAtReceivedAt: ids,
        });
      }
      records.set(email.toLowerCase(), { ...rec, newEmailCheckpoint: checkpoint });
      return claimed;
    }),
  } as unknown as AccountStore;
}

function provider(
  items: EmailSummary[],
  opts: { failList?: boolean; failReadIds?: string[]; body?: string } = {},
): EmailProvider {
  return {
    id: "imap",
    listEmails: vi.fn(async (_account: AccountRecord, listOpts) => {
      if (opts.failList) throw new Error("list failed");
      const skip = listOpts.skip ?? 0;
      const limit = listOpts.limit ?? 25;
      return {
        items: items.slice(skip, skip + limit),
        hasMore: skip + limit < items.length,
      };
    }),
    readEmail: vi.fn(async (_account: AccountRecord, id: string) => {
      if (opts.failReadIds?.includes(id)) throw new Error(`read failed: ${id}`);
      const match = items.find((item) => item.id === id) ?? summary(id, "2026-01-01T00:00:00.000Z");
      return {
        ...match,
        bodyText: opts.body ?? `body ${id}`,
        attachments: [{ id: "att-1", name: "file.txt", size: 12 }],
      };
    }),
  } as unknown as EmailProvider;
}

function registry(accounts: AccountRecord[], providers: Record<string, EmailProvider>): Registry {
  const byEmail = new Map(accounts.map((rec) => [rec.email, rec]));
  return {
    resolveByEmail: vi.fn((email: string) => {
      const rec = byEmail.get(email.toLowerCase());
      if (!rec) throw new Error(`no account registered for "${email}"`);
      return { account: rec, provider: providers[rec.email] };
    }),
  } as unknown as Registry;
}

function registerHandler(store: AccountStore, reg: Registry): Handler {
  let handler: Handler | undefined;
  const server = {
    registerTool: vi.fn((_name: string, _config: unknown, cb: Handler) => {
      handler = cb;
    }),
  };
  registerNewEmailTool(server as never, { store, registry: reg, tools });
  if (!handler) throw new Error("handler was not registered");
  return handler;
}

function structured(result: unknown): Record<string, unknown> {
  return (result as { structuredContent: Record<string, unknown> }).structuredContent;
}

describe("get_new_emails", () => {
  it("returns an error when no accounts are registered", async () => {
    const store = memoryStore([]);
    const handler = registerHandler(store, registry([], {}));

    const result = await handler({});

    expect(result).toMatchObject({
      isError: true,
      content: [
        { type: "text", text: "no accounts registered. Call add_account first." },
      ],
    });
  });

  it("initializes a missing checkpoint to the newest inbox timestamp", async () => {
    const acct = account("a@example.com");
    const store = memoryStore([acct]);
    const prov = provider([
      summary("newest", "2026-01-02T00:00:00.000Z"),
      summary("older", "2026-01-01T00:00:00.000Z"),
    ]);
    const handler = registerHandler(store, registry([acct], { [acct.email]: prov }));

    const data = structured(await handler({ account: acct.email }));

    expect(data).toMatchObject({ count: 0, emails: [], errors: [] });
    expect(store.updateNewEmailCheckpoint).toHaveBeenCalledWith(acct.email, {
      receivedAt: "2026-01-02T00:00:00.000Z",
      deliveredIdsAtReceivedAt: ["newest"],
    });
    expect(prov.readEmail).not.toHaveBeenCalled();
  });

  it("returns oldest unseen emails first and advances through the returned batch", async () => {
    const acct = account("a@example.com", {
      receivedAt: "2026-01-01T00:00:00.000Z",
      deliveredIdsAtReceivedAt: ["cursor"],
    });
    const store = memoryStore([acct]);
    const prov = provider([
      summary("3", "2026-01-04T00:00:00.000Z"),
      summary("2", "2026-01-03T00:00:00.000Z"),
      summary("1", "2026-01-02T00:00:00.000Z"),
      summary("cursor", "2026-01-01T00:00:00.000Z"),
    ]);
    const handler = registerHandler(store, registry([acct], { [acct.email]: prov }));

    const data = structured(await handler({ account: acct.email, limit: 2 }));

    expect((data.emails as Array<{ id: string }>).map((email) => email.id)).toEqual(["1", "2"]);
    expect(store.getAccount(acct.email)?.newEmailCheckpoint).toEqual({
      receivedAt: "2026-01-03T00:00:00.000Z",
      deliveredIdsAtReceivedAt: ["2"],
    });
  });

  it("returns empty when no initialized-account emails are new", async () => {
    const acct = account("a@example.com", {
      receivedAt: "2026-01-02T00:00:00.000Z",
      deliveredIdsAtReceivedAt: ["newest"],
    });
    const store = memoryStore([acct]);
    const prov = provider([summary("newest", "2026-01-02T00:00:00.000Z")]);
    const handler = registerHandler(store, registry([acct], { [acct.email]: prov }));

    const data = structured(await handler({ account: acct.email }));

    expect(data).toMatchObject({ count: 0, emails: [], errors: [] });
    expect(prov.readEmail).not.toHaveBeenCalled();
    expect(store.updateNewEmailCheckpoint).not.toHaveBeenCalled();
  });

  it("defaults limit to 10", async () => {
    const acct = account("a@example.com", {
      receivedAt: "2026-01-01T00:00:00.000Z",
      deliveredIdsAtReceivedAt: [],
    });
    const store = memoryStore([acct]);
    const items = Array.from({ length: 11 }, (_, idx) =>
      summary(String(11 - idx), `2026-01-${String(12 - idx).padStart(2, "0")}T00:00:00.000Z`),
    );
    const prov = provider(items);
    const handler = registerHandler(store, registry([acct], { [acct.email]: prov }));

    const data = structured(await handler({ account: acct.email }));

    expect(data.count).toBe(10);
    expect((data.emails as Array<{ id: string }>).map((email) => email.id)).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
    ]);
  });

  it("uses same-timestamp delivered IDs to drain ties without repeats", async () => {
    const acct = account("a@example.com", {
      receivedAt: "2026-01-01T00:00:00.000Z",
      deliveredIdsAtReceivedAt: ["a"],
    });
    const store = memoryStore([acct]);
    const prov = provider([
      summary("c", "2026-01-01T00:00:00.000Z"),
      summary("b", "2026-01-01T00:00:00.000Z"),
      summary("a", "2026-01-01T00:00:00.000Z"),
    ]);
    const handler = registerHandler(store, registry([acct], { [acct.email]: prov }));

    const data = structured(await handler({ account: acct.email, limit: 1 }));

    expect((data.emails as Array<{ id: string }>).map((email) => email.id)).toEqual(["b"]);
    expect(store.claimNewEmails).toHaveBeenLastCalledWith(acct.email, [{
      summaryId: "b",
      receivedAt: "2026-01-01T00:00:00.000Z",
      ids: ["b", "b"],
    }]);
    expect(store.getAccount(acct.email)?.newEmailCheckpoint?.deliveredIdsAtReceivedAt).toEqual(["a", "b"]);
  });

  it("applies all-account limit globally and reports partial errors", async () => {
    const a = account("a@example.com", { receivedAt: "2026-01-01T00:00:00.000Z", deliveredIdsAtReceivedAt: [] });
    const b = account("b@example.com", { receivedAt: "2026-01-01T00:00:00.000Z", deliveredIdsAtReceivedAt: [] });
    const c = account("c@example.com", { receivedAt: "2026-01-01T00:00:00.000Z", deliveredIdsAtReceivedAt: [] });
    const store = memoryStore([a, b, c]);
    const providers = {
      [a.email]: provider([summary("a1", "2026-01-03T00:00:00.000Z")]),
      [b.email]: provider([summary("b1", "2026-01-02T00:00:00.000Z")]),
      [c.email]: provider([], { failList: true }),
    };
    const handler = registerHandler(store, registry([a, b, c], providers));

    const data = structured(await handler({ limit: 1 }));

    expect((data.emails as Array<{ account: string; id: string }>)).toMatchObject([
      { account: b.email, id: "b1" },
    ]);
    expect(data.errors).toEqual([{ account: c.email, message: "list failed" }]);
  });

  it("fails a single-account call and does not advance when a selected read fails", async () => {
    const checkpoint = { receivedAt: "2026-01-01T00:00:00.000Z", deliveredIdsAtReceivedAt: [] };
    const acct = account("a@example.com", checkpoint);
    const store = memoryStore([acct]);
    const prov = provider([summary("1", "2026-01-02T00:00:00.000Z")], { failReadIds: ["1"] });
    const handler = registerHandler(store, registry([acct], { [acct.email]: prov }));

    const result = await handler({ account: acct.email });

    expect(result).toMatchObject({ isError: true });
    expect(store.claimNewEmails).not.toHaveBeenCalled();
  });

  it("supports limit 0 without reading or advancing initialized accounts", async () => {
    const acct = account("a@example.com", {
      receivedAt: "2026-01-01T00:00:00.000Z",
      deliveredIdsAtReceivedAt: [],
    });
    const store = memoryStore([acct]);
    const prov = provider([summary("1", "2026-01-02T00:00:00.000Z")]);
    const handler = registerHandler(store, registry([acct], { [acct.email]: prov }));

    const data = structured(await handler({ account: acct.email, limit: 0 }));

    expect(data).toMatchObject({ count: 0, emails: [], errors: [] });
    expect(prov.readEmail).not.toHaveBeenCalled();
    expect(store.updateNewEmailCheckpoint).not.toHaveBeenCalled();
  });

  it("claims concurrent hydrated candidates only once across store instances", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "hypermail-new-emails-"));
    try {
      const base = await AccountStore.open({ dataDir, key: Buffer.alloc(32, 7) });
      const acct = await base.upsertAccount(account("a@example.com", {
        receivedAt: "2026-01-01T00:00:00.000Z",
        deliveredIdsAtReceivedAt: ["cursor"],
      }));
      const items = [
        summary("new", "2026-01-02T00:00:00.000Z"),
        summary("cursor", "2026-01-01T00:00:00.000Z"),
      ];

      let readCount = 0;
      let releaseReads!: () => void;
      const bothRead = new Promise<void>((resolve) => {
        releaseReads = resolve;
      });
      const blockedProvider = (): EmailProvider => ({
        id: "imap",
        listEmails: vi.fn(async (_account: AccountRecord, listOpts) => {
          const skip = listOpts.skip ?? 0;
          const limit = listOpts.limit ?? 25;
          return {
            items: items.slice(skip, skip + limit),
            hasMore: skip + limit < items.length,
          };
        }),
        readEmail: vi.fn(async (_account: AccountRecord, id: string) => {
          readCount += 1;
          if (readCount === 2) releaseReads();
          await bothRead;
          const match = items.find((item) => item.id === id)!;
          return { ...match, bodyText: `body ${id}` };
        }),
      } as unknown as EmailProvider);

      const storeA = await AccountStore.open({ dataDir, key: Buffer.alloc(32, 7) });
      const storeB = await AccountStore.open({ dataDir, key: Buffer.alloc(32, 7) });
      const registryFor = (store: AccountStore, prov: EmailProvider): Registry => ({
        get: vi.fn(() => prov),
        resolveByEmail: vi.fn((email: string) => {
          const stored = store.getAccount(email);
          if (!stored) throw new Error(`no account registered for "${email}"`);
          return { account: stored, provider: prov };
        }),
        list: vi.fn(() => [prov]),
      } as unknown as Registry);
      const handlerA = registerHandler(storeA, registryFor(storeA, blockedProvider()));
      const handlerB = registerHandler(storeB, registryFor(storeB, blockedProvider()));

      const [first, second] = await Promise.all([
        handlerA({ account: acct.email, limit: 1 }),
        handlerB({ account: acct.email, limit: 1 }),
      ]);
      const delivered = [
        ...((structured(first).emails as Array<{ id: string }>).map((email) => email.id)),
        ...((structured(second).emails as Array<{ id: string }>).map((email) => email.id)),
      ];

      expect(delivered.filter((id) => id === "new")).toHaveLength(1);
      const reopened = await AccountStore.open({ dataDir, key: Buffer.alloc(32, 7) });
      expect(reopened.getAccount(acct.email)?.newEmailCheckpoint).toEqual({
        receivedAt: "2026-01-02T00:00:00.000Z",
        deliveredIdsAtReceivedAt: ["new"],
      });
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns markdown bodies with truncation metadata and attachment metadata only", async () => {
    const acct = account("a@example.com", {
      receivedAt: "2026-01-01T00:00:00.000Z",
      deliveredIdsAtReceivedAt: [],
    });
    const store = memoryStore([acct]);
    const prov = provider([
      { ...summary("1", "2026-01-02T00:00:00.000Z"), hasAttachments: true },
    ], { body: "x".repeat(20_001) });
    const handler = registerHandler(store, registry([acct], { [acct.email]: prov }));

    const data = structured(await handler({ account: acct.email }));
    const email = (data.emails as Array<Record<string, unknown>>)[0]!;

    expect(email.bodyFormat).toBe("markdown");
    expect((email.body as string).length).toBe(20_000);
    expect(email.bodyTruncated).toBe(true);
    expect(email.bodyOriginalLength).toBe(20_001);
    expect(email.attachments).toEqual([{ id: "att-1", name: "file.txt", size: 12 }]);
  });
});
