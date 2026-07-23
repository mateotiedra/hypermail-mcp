import { describe, expect, it, vi } from "vitest";

import type { AccountRecord } from "../../store/account-store.js";
import type { GmailClientFactory } from "./client.js";
import {
  markRead,
  moveEmail,
  saveDraft,
  sendDraft,
  sendEmail,
  trashEmail,
  updateDraft,
} from "./write-ops.js";

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

describe("Gmail trash operations", () => {
  it("uses Gmail's native trash endpoint", async () => {
    const trash = vi.fn().mockResolvedValue({ data: {} });
    const modify = vi.fn().mockResolvedValue({});
    const clients = clientsFor({
      users: { messages: { trash, modify } },
    });

    await trashEmail(clients, account, "message-1");

    expect(trash).toHaveBeenCalledWith({ userId: "me", id: "message-1" });
    expect(modify).not.toHaveBeenCalled();
  });

  it("routes trash aliases through the native trash endpoint", async () => {
    const trash = vi.fn().mockResolvedValue({ data: {} });
    const modify = vi.fn().mockResolvedValue({});
    const clients = clientsFor({
      users: { messages: { trash, modify } },
    });

    await moveEmail(clients, account, "message-1", "deleteditems");
    await moveEmail(clients, account, "message-2", "trash");

    expect(trash).toHaveBeenCalledWith({ userId: "me", id: "message-1" });
    expect(trash).toHaveBeenCalledWith({ userId: "me", id: "message-2" });
    expect(modify).not.toHaveBeenCalled();
  });
});

describe("Gmail write-operation native web links", () => {
  const link = (id: string) =>
    `https://mail.google.com/mail/u/?authuser=user%40example.com#all/${id}`;
  const input = {
    to: [{ address: "recipient@example.com" }],
    subject: "Subject",
    body: "Body",
    inReplyTo: false as const,
  };

  it("uses resulting sent and draft message IDs while preserving draft result IDs", async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: "sent-1" } });
    const create = vi.fn().mockResolvedValue({
      data: { id: "draft-resource-1", message: { id: "draft-message-1" } },
    });
    const draftGet = vi.fn().mockResolvedValue({
      data: {
        message: {
          raw: Buffer.from("Subject: Before\r\nTo: recipient@example.com\r\n\r\nBody").toString("base64url"),
          payload: { headers: [{ name: "Subject", value: "Before" }] },
        },
      },
    });
    const update = vi.fn().mockResolvedValue({
      data: { id: "draft-resource-2", message: { id: "draft-message-2" } },
    });
    const draftSend = vi.fn().mockResolvedValue({ data: { id: "sent-draft-1" } });
    const clients = clientsFor({
      users: { messages: { send }, drafts: { create, get: draftGet, update, send: draftSend } },
    });

    await expect(sendEmail(clients, account, input)).resolves.toEqual({
      id: "sent-1", webUrl: link("sent-1"),
    });
    await expect(saveDraft(clients, account, input)).resolves.toEqual({
      id: "draft-message-1", webUrl: link("draft-message-1"),
    });
    await expect(updateDraft(clients, account, "draft-resource-1", { body: "After" })).resolves.toEqual({
      id: "draft-message-2", webUrl: link("draft-message-2"),
    });
    await expect(sendDraft(clients, account, "draft-resource-2")).resolves.toEqual({
      id: "sent-draft-1", webUrl: link("sent-draft-1"),
    });
  });

  it("links replies and forwards to the resulting sent message, not the source", async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ data: { threadId: "thread-1" } })
      .mockResolvedValueOnce({
        data: {
          threadId: "thread-2",
          raw: Buffer.from("Subject: Original\r\n\r\nBody").toString("base64url"),
        },
      });
    const send = vi.fn()
      .mockResolvedValueOnce({ data: { id: "reply-result" } })
      .mockResolvedValueOnce({ data: { id: "forward-result" } });
    const clients = clientsFor({ users: { messages: { get, send } } });

    const reply = await sendEmail(clients, account, { ...input, inReplyTo: "source-message" });
    const forward = await sendEmail(clients, account, { ...input, forwardMessageId: "forward-source" });
    expect(reply).toEqual({ id: "reply-result", webUrl: link("reply-result") });
    expect(forward).toEqual({ id: "forward-result", webUrl: link("forward-result") });
    expect(reply.webUrl).not.toContain("source-message");
    expect(forward.webUrl).not.toContain("forward-source");
  });

  it("returns stable IDs and links for move, trash, and mark operations", async () => {
    const modify = vi.fn().mockResolvedValue({ data: {} });
    const trash = vi.fn().mockResolvedValue({ data: { id: "trashed-result" } });
    const clients = clientsFor({ users: { messages: { modify, trash } } });

    await expect(moveEmail(clients, account, "message-1", "archive")).resolves.toEqual({
      id: "message-1", webUrl: link("message-1"),
    });
    await expect(trashEmail(clients, account, "message-2")).resolves.toEqual({
      id: "trashed-result", webUrl: link("trashed-result"),
    });
    await expect(markRead(clients, account, "message-3", true)).resolves.toEqual({
      id: "message-3", webUrl: link("message-3"),
    });
  });

  it("reports why a link is unavailable when Gmail returns no sent message ID", async () => {
    const send = vi.fn().mockResolvedValue({ data: {} });
    const result = await sendEmail(
      clientsFor({ users: { messages: { send } } }),
      account,
      input,
    );

    expect(result).toEqual({
      id: "",
      webUrlUnavailableReason:
        "Gmail did not return a usable resulting message ID for a native web link.",
    });
  });
});
