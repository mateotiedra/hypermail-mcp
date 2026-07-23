import { simpleParser } from "mailparser";
import type { ParsedMail } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { describe, expect, it, vi } from "vitest";

import type { AccountRecord } from "../../store/account-store.js";
import type { ImapClientFactory } from "./client.js";
import {
  markRead,
  moveEmail,
  saveDraft,
  sendDraft,
  sendEmail,
  trashEmail,
  updateDraft,
} from "./write-ops.js";
import { IMAP_WEB_URL_UNAVAILABLE_REASON } from "./helpers.js";

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

async function originalDraftSource(html = "<p>Original body</p>"): Promise<string> {
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const message = new MailComposer({
      from: "User <user@example.com>",
      to: "Original To <original-to@example.com>",
      cc: "Original Cc <original-cc@example.com>",
      bcc: "Original Bcc <original-bcc@example.com>",
      subject: "Original subject",
      html,
      attachments: [{ filename: "original.txt", content: "original attachment" }],
    }).compile();
    message.keepBcc = true;
    message.build((err: Error | null, buf: Buffer) =>
      err ? reject(err) : resolve(buf),
    );
  });

  return raw.toString("utf-8");
}

async function textOnlyDraftSource(text: string): Promise<string> {
  const raw = await new Promise<Buffer>((resolve, reject) => {
    new MailComposer({
      from: "Original <original@example.com>",
      to: "User <user@example.com>",
      subject: "Original subject",
      text,
    }).compile().build((err: Error | null, buf: Buffer) =>
      err ? reject(err) : resolve(buf),
    );
  });

  return raw.toString("utf-8");
}

function addresses(recipients: ParsedMail["to"]): string[] {
  return (recipients ? (Array.isArray(recipients) ? recipients : [recipients]) : [])
    .flatMap(({ value }) => value)
    .map((recipient) => recipient.address ?? "");
}

function replyHistoryDraftClient(source: string, uid = 125) {
  let appendedRaw = "";
  const append = vi.fn(async (_folder, raw: string) => {
    appendedRaw = raw;
    return { uid };
  });
  const list = vi.fn(async () => []);
  const client = {
    run: vi.fn(async (fn) => fn({ append, list })),
    withMailbox: vi.fn(async (_folder, fn) =>
      fn({
        fetchOne: async () => ({
          envelope: { messageId: "<original@example.com>" },
          source,
        }),
      }),
    ),
  };

  return { client, getAppendedRaw: () => appendedRaw };
}

describe("IMAP draft write operations", () => {
  it("appends a simple draft directly to Drafts", async () => {
    const append = vi.fn(async () => ({ uid: 123 }));
    const list = vi.fn(async () => []);
    const client = {
      run: vi.fn(async (fn) => fn({ append, list })),
      withMailbox: vi.fn(),
    };

    const result = await saveDraft(clientsFor(client), account, {
      to: [{ address: "recipient@example.com" }],
      subject: "Draft subject",
      body: "<p>Hello</p>",
      isHtml: true,
      inReplyTo: false,
    });

    expect(result).toEqual({
      id: "Drafts/123",
      webUrlUnavailableReason: IMAP_WEB_URL_UNAVAILABLE_REASON,
    });
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
    const list = vi.fn(async () => []);
    const client = {
      run: vi.fn(async (fn) => fn({ append, list })),
      withMailbox: vi.fn(),
    };

    const result = await saveDraft(clientsFor(client), account, {
      to: [{ address: "recipient@example.com" }],
      subject: "Draft subject",
      body: "<p>Hello</p>",
      isHtml: true,
      inReplyTo: false,
    });

    expect(result).toEqual({
      id: "Drafts/124",
      webUrlUnavailableReason: IMAP_WEB_URL_UNAVAILABLE_REASON,
    });
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
    const list = vi.fn(async () => []);
    const client = {
      run: vi.fn(async (fn) => fn({ append, list })),
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

  it("preserves referenced message content in saved reply drafts", async () => {
    const source = await originalDraftSource(
      "<p>Clearly identifiable referenced HTML body content</p>",
    );
    const { client, getAppendedRaw } = replyHistoryDraftClient(source);

    const result = await saveDraft(clientsFor(client), account, {
      to: [{ address: "recipient@example.com" }],
      subject: "Reply draft",
      body: "<p>Composed response content</p>",
      isHtml: true,
      inReplyTo: "INBOX/9",
    });

    const draft = await simpleParser(getAppendedRaw());
    expect(result).toEqual({
      id: "Drafts/125",
      webUrlUnavailableReason: IMAP_WEB_URL_UNAVAILABLE_REASON,
    });
    expect(client.withMailbox).toHaveBeenCalledWith("INBOX", expect.any(Function));
    expect(draft.inReplyTo).toBe("<original@example.com>");
    expect(draft.references).toBe("<original@example.com>");
    expect(draft.html).toContain("Composed response content");
    expect(draft.html).toContain("Clearly identifiable referenced HTML body content");
    expect(getAppendedRaw()).not.toMatch(/(?<!\r)\n|\r(?!\n)/);
  });

  it("quotes a text-only message in an empty HTML reply draft", async () => {
    const source = await textOnlyDraftSource("Identifiable referenced plain text");
    const { client, getAppendedRaw } = replyHistoryDraftClient(source, 126);

    await saveDraft(clientsFor(client), account, {
      to: [{ address: "recipient@example.com" }],
      subject: "Reply draft",
      body: "",
      isHtml: true,
      inReplyTo: "INBOX/9",
    });

    const draft = await simpleParser(getAppendedRaw());
    expect(draft.html).toContain("Identifiable referenced plain text");
  });

  it("quotes referenced content in plaintext reply drafts", async () => {
    const source = await textOnlyDraftSource("Identifiable referenced plain text");
    const { client, getAppendedRaw } = replyHistoryDraftClient(source, 127);

    await saveDraft(clientsFor(client), account, {
      to: [{ address: "recipient@example.com" }],
      subject: "Reply draft",
      body: "New plaintext response",
      isHtml: false,
      inReplyTo: "INBOX/9",
    });

    const draft = await simpleParser(getAppendedRaw());
    expect(draft.text).toContain("New plaintext response");
    expect(draft.text).toContain("Identifiable referenced plain text");
  });

  it("embeds forwarded message content in saved IMAP drafts", async () => {
    let appendedRaw = "";
    const append = vi.fn(async (_folder, raw: string) => {
      appendedRaw = raw;
      return { uid: 125 };
    });
    const list = vi.fn(async () => []);
    const client = {
      run: vi.fn(async (fn) => fn({ append, list })),
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

    expect(result).toEqual({
      id: "Drafts/125",
      webUrlUnavailableReason: IMAP_WEB_URL_UNAVAILABLE_REASON,
    });
    expect(client.withMailbox).toHaveBeenCalledWith("Archive", expect.any(Function));
    expect(appendedRaw).toContain("Forwarded message");
    expect(appendedRaw).toContain("ORIGINAL");
  });

  it("uses the advertised Drafts special-use mailbox", async () => {
    const append = vi.fn(async () => ({ uid: 126 }));
    const list = vi.fn(async () => [
      { path: "INBOX" },
      { path: "INBOX/Drafts", specialUse: "\\Drafts" },
    ]);
    const client = {
      run: vi.fn(async (fn) => fn({ append, list })),
      withMailbox: vi.fn(),
    };

    const result = await saveDraft(clientsFor(client), account, {
      to: [{ address: "recipient@example.com" }],
      subject: "Draft subject",
      body: "<p>Hello</p>",
      isHtml: true,
      inReplyTo: false,
    });

    expect(result).toEqual({
      id: "INBOX/Drafts/126",
      webUrlUnavailableReason: IMAP_WEB_URL_UNAVAILABLE_REASON,
    });
    expect(append).toHaveBeenCalledWith(
      "INBOX/Drafts",
      expect.stringContaining("Draft subject"),
      ["\\Draft"],
    );
  });

  it("preserves recipients and attachments when updating only a draft body", async () => {
    const source = await originalDraftSource();
    let appendedRaw = "";
    const append = vi.fn(async (_folder, raw: string) => {
      appendedRaw = raw;
      return { uid: 101 };
    });
    const messageDelete = vi.fn();
    const client = {
      withMailbox: vi.fn(async (_folder, fn) =>
        fn({
          fetchOne: async () => ({
            source,
            envelope: { subject: "Original subject" },
          }),
          append,
          messageDelete,
        }),
      ),
    };

    await updateDraft(clientsFor(client), account, "Drafts/5", {
      body: "<p>Updated body</p>",
      isHtml: true,
    });

    const updated = await simpleParser(appendedRaw);
    expect(addresses(updated.to)).toEqual(["original-to@example.com"]);
    expect(addresses(updated.cc)).toEqual(["original-cc@example.com"]);
    expect(addresses(updated.bcc)).toEqual(["original-bcc@example.com"]);
    expect(updated.html).toContain("Updated body");
    expect(updated.attachments).toHaveLength(1);
    expect(updated.attachments[0]).toMatchObject({
      filename: "original.txt",
      content: Buffer.from("original attachment"),
    });
  });

  it("changes only supplied To recipients while retaining the draft body and attachments", async () => {
    const source = await originalDraftSource("<p>Original\nbody</p>");
    const parsedSource = await simpleParser(source);
    expect(parsedSource.html).toContain("\n");
    let appendedRaw = "";
    const append = vi.fn(async (_folder, raw: string) => {
      appendedRaw = raw;
      return { uid: 102 };
    });
    const client = {
      withMailbox: vi.fn(async (_folder, fn) =>
        fn({
          fetchOne: async () => ({
            source,
            envelope: { subject: "Original subject" },
          }),
          append,
          messageDelete: vi.fn(),
        }),
      ),
    };

    await updateDraft(clientsFor(client), account, "Drafts/5", {
      to: [{ address: "new-to@example.com" }],
    });

    const updated = await simpleParser(appendedRaw);
    expect(addresses(updated.to)).toEqual(["new-to@example.com"]);
    expect(updated.html).toContain("Original\nbody");
    expect(updated.attachments).toHaveLength(1);
    expect(updated.attachments[0]?.filename).toBe("original.txt");
    expect(appendedRaw).not.toMatch(/(?<!\r)\n/);
  });

  it("overrides each existing recipient field when recipients are supplied", async () => {
    const source = await originalDraftSource();
    let appendedRaw = "";
    const append = vi.fn(async (_folder, raw: string) => {
      appendedRaw = raw;
      return { uid: 103 };
    });
    const client = {
      withMailbox: vi.fn(async (_folder, fn) =>
        fn({
          fetchOne: async () => ({
            source,
            envelope: { subject: "Original subject" },
          }),
          append,
          messageDelete: vi.fn(),
        }),
      ),
    };

    await updateDraft(clientsFor(client), account, "Drafts/5", {
      to: [{ address: "replacement-to@example.com" }],
      cc: [{ address: "replacement-cc@example.com" }],
      bcc: [{ address: "replacement-bcc@example.com" }],
    });

    const updated = await simpleParser(appendedRaw);
    expect(addresses(updated.to)).toEqual(["replacement-to@example.com"]);
    expect(addresses(updated.cc)).toEqual(["replacement-cc@example.com"]);
    expect(addresses(updated.bcc)).toEqual(["replacement-bcc@example.com"]);
  });

  it("does not delete the original when the replacement draft cannot be read", async () => {
    const source = await originalDraftSource();
    const fetchOne = vi.fn(async (uid: number) => {
      if (uid === 5) {
        return { source, envelope: { subject: "Original subject" } };
      }
      return undefined;
    });
    const append = vi.fn(async () => ({ uid: 104 }));
    const messageDelete = vi.fn();
    const client = {
      withMailbox: vi.fn(async (_folder, fn) =>
        fn({ fetchOne, append, messageDelete }),
      ),
    };

    await expect(
      updateDraft(clientsFor(client), account, "Drafts/5", {
        body: "replacement body",
        isHtml: false,
      }),
    ).rejects.toThrow();

    expect(fetchOne.mock.calls.map(([uid]) => uid)).toContain(104);
    expect(messageDelete).not.toHaveBeenCalled();
  });

  it("adds the unavailable-link reason to send and draft-send results", async () => {
    const transporter = { sendMail: vi.fn(async () => ({ messageId: "<sent@example.com>" })) };
    const sendClient = {
      getTransporter: () => transporter,
      run: vi.fn(async (fn) => fn({ append: vi.fn() })),
    };
    const sent = await sendEmail(clientsFor(sendClient), account, {
      to: [{ address: "recipient@example.com" }],
      subject: "Subject",
      body: "Body",
      inReplyTo: false,
    });
    expect(sent).toEqual({
      id: "<sent@example.com>",
      webUrlUnavailableReason: IMAP_WEB_URL_UNAVAILABLE_REASON,
    });

    const draftClient = {
      getTransporter: () => transporter,
      withMailbox: vi.fn(async (_folder, fn) => fn({
        fetchOne: vi.fn(async () => ({ source: "raw draft" })),
        messageMove: vi.fn(),
      })),
    };
    const draftSent = await sendDraft(clientsFor(draftClient), account, "Drafts/5");
    expect(draftSent).toEqual({
      id: "<sent@example.com>",
      webUrlUnavailableReason: IMAP_WEB_URL_UNAVAILABLE_REASON,
    });
  });

  it("uses UIDPLUS destination IDs for moves and preserves the source ID without a map", async () => {
    const mappedMove = vi.fn(async () => ({ uidMap: new Map([[5, 42]]) }));
    const mappedClient = {
      withMailbox: vi.fn(async (_folder, fn) => fn({ messageMove: mappedMove })),
    };
    await expect(moveEmail(clientsFor(mappedClient), account, "INBOX/5", "archive")).resolves.toEqual({
      id: "Archive/42",
      webUrlUnavailableReason: IMAP_WEB_URL_UNAVAILABLE_REASON,
    });

    const unmappedMove = vi.fn(async () => false);
    const unmappedClient = {
      withMailbox: vi.fn(async (_folder, fn) => fn({ messageMove: unmappedMove })),
    };
    const moved = await moveEmail(clientsFor(unmappedClient), account, "INBOX/5", "Archive");
    expect(moved).toEqual({
      id: "INBOX/5",
      webUrlUnavailableReason: IMAP_WEB_URL_UNAVAILABLE_REASON,
    });
    expect(JSON.stringify(moved)).not.toContain("imap://");
  });

  it("returns unavailable-link references for trash and read-state mutations", async () => {
    const messageMove = vi.fn(async () => ({ uidMap: new Map([[5, 12]]) }));
    const trashClient = {
      run: vi.fn(async (fn) => fn({ list: vi.fn(async () => [{ path: "Deleted", specialUse: "\\Trash" }]) })),
      withMailbox: vi.fn(async (_folder, fn) => fn({ messageMove })),
    };
    await expect(trashEmail(clientsFor(trashClient), account, "INBOX/5")).resolves.toEqual({
      id: "Deleted/12",
      webUrlUnavailableReason: IMAP_WEB_URL_UNAVAILABLE_REASON,
    });

    const messageFlagsAdd = vi.fn();
    const markClient = {
      withMailbox: vi.fn(async (_folder, fn) => fn({ messageFlagsAdd })),
    };
    await expect(markRead(clientsFor(markClient), account, "INBOX/5", true)).resolves.toEqual({
      id: "INBOX/5",
      webUrlUnavailableReason: IMAP_WEB_URL_UNAVAILABLE_REASON,
    });
  });
});
