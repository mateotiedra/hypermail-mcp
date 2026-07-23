import { describe, expect, it, vi } from "vitest";

import type { AccountRecord } from "../../store/account-store.js";
import type { GmailClientFactory } from "./client.js";
import { listEmails, readAttachment, readEmail, searchEmails } from "./read-ops.js";

const account: AccountRecord = {
  email: "user@example.com",
  provider: "gmail",
  tokens: {},
  addedAt: "2026-01-01T00:00:00.000Z",
};

function clientsFor(gmail: unknown): GmailClientFactory {
  return {
    get: () => ({ gmail }),
  } as unknown as GmailClientFactory;
}

describe("Gmail search", () => {
  it("preserves query-only searches", async () => {
    const list = vi.fn().mockResolvedValue({ data: {} });

    await searchEmails(
      clientsFor({ users: { messages: { list } } }),
      account,
      { query: "has:attachment" },
    );

    expect(list).toHaveBeenCalledWith({
      userId: "me",
      q: "has:attachment",
      maxResults: 25,
    });
  });

  it("builds ANDed structured filters with CC-or-BCC matching", async () => {
    const list = vi.fn().mockResolvedValue({ data: {} });

    await searchEmails(
      clientsFor({ users: { messages: { list } } }),
      account,
      {
        query: "is:unread",
        from: "sender@example.com",
        to: "recipient@example.com",
        cc: "copy@example.com",
      },
    );

    expect(list).toHaveBeenCalledWith({
      userId: "me",
      q: 'is:unread from:"sender@example.com" to:"recipient@example.com" (cc:"copy@example.com" OR bcc:"copy@example.com")',
      maxResults: 25,
    });
  });

  it("escapes structured values and forwards the requested limit", async () => {
    const list = vi.fn().mockResolvedValue({ data: {} });

    await searchEmails(
      clientsFor({ users: { messages: { list } } }),
      account,
      { from: 'a"b\\c@example.com', limit: 7 },
    );

    expect(list).toHaveBeenCalledWith({
      userId: "me",
      q: 'from:"a\\"b\\\\c@example.com"',
      maxResults: 7,
    });
  });

  it("hydrates search results with message metadata", async () => {
    const list = vi.fn().mockResolvedValue({
      data: { messages: [{ id: "message-1" }] },
    });
    const get = vi.fn().mockResolvedValue({
      data: {
        labelIds: ["INBOX"],
        internalDate: "1735689600000",
        payload: {
          headers: [
            { name: "From", value: "Sender <sender@example.com>" },
            { name: "To", value: "recipient@example.com" },
            { name: "Subject", value: "Subject" },
          ],
        },
      },
    });

    const result = await searchEmails(
      clientsFor({ users: { messages: { list, get } } }),
      account,
      { to: "recipient@example.com" },
    );

    expect(get).toHaveBeenCalledWith({
      userId: "me",
      id: "message-1",
      format: "metadata",
      metadataHeaders: ["From", "Subject", "To", "Date"],
    });
    expect(result).toEqual([
      expect.objectContaining({
        id: "message-1",
        subject: "Subject",
        from: { name: "Sender", address: "sender@example.com" },
        to: [{ address: "recipient@example.com" }],
        isRead: true,
        webUrl: "https://mail.google.com/mail/u/?authuser=user%40example.com#all/message-1",
      }),
    ]);
  });
});

describe("Gmail native web links", () => {
  const encodedAccount: AccountRecord = { ...account, email: "user+tag@example.com" };

  it("adds account-aware links to listed and full messages", async () => {
    const list = vi.fn().mockResolvedValue({ data: { messages: [{ id: "message-1" }] } });
    const get = vi.fn().mockResolvedValue({
      data: {
        labelIds: ["INBOX"],
        payload: { headers: [{ name: "Subject", value: "Subject" }] },
      },
    });
    const clients = clientsFor({ users: { messages: { list, get } } });

    const listed = await listEmails(clients, encodedAccount, { limit: 1 });
    expect(listed.items[0]?.webUrl).toBe(
      "https://mail.google.com/mail/u/?authuser=user%2Btag%40example.com#all/message-1",
    );

    const full = await readEmail(clients, encodedAccount, "message-2");
    expect(full.webUrl).toBe(
      "https://mail.google.com/mail/u/?authuser=user%2Btag%40example.com#all/message-2",
    );
  });

  it("adds the parent message link to attachment results", async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        payload: {
          parts: [{
            filename: "report.txt",
            mimeType: "text/plain",
            body: { attachmentId: "attachment-1" },
          }],
        },
      },
    });
    const attachmentGet = vi.fn().mockResolvedValue({
      data: { data: Buffer.from("contents").toString("base64url") },
    });

    const result = await readAttachment(
      clientsFor({ users: { messages: { get, attachments: { get: attachmentGet } } } }),
      encodedAccount,
      "message-1",
      "attachment-1",
    );

    expect(result.webUrl).toBe(
      "https://mail.google.com/mail/u/?authuser=user%2Btag%40example.com#all/message-1",
    );
  });
});
