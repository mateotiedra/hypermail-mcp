import { describe, expect, it, vi } from "vitest";

import type { AccountRecord } from "../../store/account-store.js";
import type { ImapClientFactory } from "./client.js";
import { saveDraft } from "./write-ops.js";

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

describe("IMAP saveDraft", () => {
  it("appends a simple draft directly to Drafts", async () => {
    const append = vi.fn(async () => ({ uid: 123 }));
    const client = {
      run: vi.fn(async (fn) => fn({ append })),
      withMailbox: vi.fn(),
    };

    const result = await saveDraft(clientsFor(client), account, {
      to: [{ address: "recipient@example.com" }],
      subject: "Draft subject",
      body: "<p>Hello</p>",
      isHtml: true,
      inReplyTo: false,
    });

    expect(result).toEqual({ id: "Drafts/123" });
    expect(client.withMailbox).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledWith(
      "Drafts",
      expect.stringContaining("Draft subject"),
      ["\\Draft"],
    );
  });

  it("retries draft append without the Draft flag when flagged APPEND is rejected", async () => {
    const commandFailed = Object.assign(new Error("Command failed"), {
      responseStatus: "NO",
      responseText: "invalid flag",
    });
    const append = vi
      .fn()
      .mockRejectedValueOnce(commandFailed)
      .mockResolvedValueOnce({ uid: 124 });
    const client = {
      run: vi.fn(async (fn) => fn({ append })),
      withMailbox: vi.fn(),
    };

    const result = await saveDraft(clientsFor(client), account, {
      to: [{ address: "recipient@example.com" }],
      subject: "Draft subject",
      body: "<p>Hello</p>",
      isHtml: true,
      inReplyTo: false,
    });

    expect(result).toEqual({ id: "Drafts/124" });
    expect(append).toHaveBeenNthCalledWith(
      1,
      "Drafts",
      expect.any(String),
      ["\\Draft"],
    );
    expect(append).toHaveBeenNthCalledWith(2, "Drafts", expect.any(String));
  });

  it("includes safe IMAP response details when draft append fails", async () => {
    const commandFailed = Object.assign(new Error("Command failed"), {
      responseStatus: "NO",
      responseText: "mailbox rejected append",
      serverResponseCode: "TRYCREATE",
    });
    const append = vi.fn().mockRejectedValue(commandFailed);
    const client = {
      run: vi.fn(async (fn) => fn({ append })),
      withMailbox: vi.fn(),
    };

    await expect(
      saveDraft(clientsFor(client), account, {
        to: [{ address: "recipient@example.com" }],
        subject: "Secret subject should not be in error",
        body: "SECRET BODY SHOULD NOT BE IN ERROR",
        isHtml: true,
        inReplyTo: false,
      }),
    ).rejects.toThrow(
      "failed to save IMAP draft to Drafts: Command failed; responseStatus=NO; responseText=mailbox rejected append; serverResponseCode=TRYCREATE",
    );

    await expect(
      saveDraft(clientsFor(client), account, {
        to: [{ address: "recipient@example.com" }],
        subject: "Secret subject should not be in error",
        body: "SECRET BODY SHOULD NOT BE IN ERROR",
        isHtml: true,
        inReplyTo: false,
      }),
    ).rejects.not.toThrow("SECRET BODY");
  });

  it("embeds forwarded message content in saved IMAP drafts", async () => {
    let appendedRaw = "";
    const append = vi.fn(async (_folder, raw: string) => {
      appendedRaw = raw;
      return { uid: 125 };
    });
    const client = {
      run: vi.fn(async (fn) => fn({ append })),
      withMailbox: vi.fn(async (_folder, fn) =>
        fn({
          fetchOne: async () => ({
            envelope: { subject: "Original", messageId: "<original@example.com>" },
            source: "ORIGINAL",
          }),
        }),
      ),
    };

    const result = await saveDraft(clientsFor(client), account, {
      to: [{ address: "recipient@example.com" }],
      subject: "Forward draft",
      body: "<p>See forwarded message.</p>",
      isHtml: true,
      inReplyTo: false,
      forwardMessageId: "Archive/9",
    });

    expect(result).toEqual({ id: "Drafts/125" });
    expect(client.withMailbox).toHaveBeenCalledWith("Archive", expect.any(Function));
    expect(appendedRaw).toContain("Forwarded message");
    expect(appendedRaw).toContain("ORIGINAL");
  });
});
