import { describe, expect, it, vi } from "vitest";

import type { AccountRecord } from "../../store/account-store.js";
import type { ImapClientFactory } from "./client.js";
import { searchEmails } from "./read-ops.js";

const account: AccountRecord = {
  email: "user@example.com",
  provider: "imap",
  displayName: "User",
  tokens: {},
  addedAt: "2026-01-01T00:00:00.000Z",
};

function clientsFor(client: unknown): ImapClientFactory {
  return { get: () => client } as unknown as ImapClientFactory;
}

function searchClient(uids: number[] = []) {
  const search = vi.fn(async () => uids);
  const fetchAll = vi.fn(async (ids: number[]) =>
    ids.map((uid) => ({
      uid,
      envelope: { subject: `Message ${uid}` },
      flags: new Set(uid === 9 ? ["\\Seen"] : []),
    })),
  );
  const client = {
    withMailbox: vi.fn(async (_mailbox, fn) => fn({ search, fetchAll })),
  };

  return { client, search, fetchAll };
}

describe("IMAP search operations", () => {
  it("combines supplied criteria in one search", async () => {
    const { client, search } = searchClient();

    await searchEmails(clientsFor(client), account, {
      query: "invoice",
      from: "sender@example.com",
      to: "recipient@example.com",
      cc: "copied@example.com",
    });

    expect(client.withMailbox).toHaveBeenCalledWith("INBOX", expect.any(Function));
    expect(search).toHaveBeenCalledWith(
      {
        text: "invoice",
        from: "sender@example.com",
        to: "recipient@example.com",
        or: [{ cc: "copied@example.com" }, { bcc: "copied@example.com" }],
      },
      { uid: true },
    );
  });

  it("searches public CC against both IMAP CC and BCC fields", async () => {
    const { client, search } = searchClient();

    await searchEmails(clientsFor(client), account, { cc: "copied@example.com" });

    expect(search).toHaveBeenCalledWith(
      { or: [{ cc: "copied@example.com" }, { bcc: "copied@example.com" }] },
      { uid: true },
    );
  });

  it("searches with structured criteria when no text query is supplied", async () => {
    const { client, search } = searchClient();

    await searchEmails(clientsFor(client), account, { from: "sender@example.com" });

    expect(search).toHaveBeenCalledWith(
      { from: "sender@example.com" },
      { uid: true },
    );
  });

  it("keeps descending UID results, limit behavior, and summary mapping", async () => {
    const { client, search, fetchAll } = searchClient([3, 9, 1]);

    const result = await searchEmails(clientsFor(client), account, {
      query: "status",
      limit: 2,
    });

    expect(search).toHaveBeenCalledWith({ text: "status" }, { uid: true });
    expect(fetchAll).toHaveBeenCalledWith(
      [9, 3],
      { envelope: true, flags: true },
      { uid: true },
    );
    expect(result).toEqual([
      expect.objectContaining({ id: "INBOX/9", subject: "Message 9", isRead: true }),
      expect.objectContaining({ id: "INBOX/3", subject: "Message 3", isRead: false }),
    ]);
  });
});
