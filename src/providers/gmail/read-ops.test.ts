import { describe, expect, it, vi } from "vitest";

import type { AccountRecord } from "../../store/account-store.js";
import type { GmailClientFactory } from "./client.js";
import { searchEmails } from "./read-ops.js";

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
      }),
    ]);
  });
});
