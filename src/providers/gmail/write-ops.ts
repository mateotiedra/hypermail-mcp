import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";

import MailComposer from "nodemailer/lib/mail-composer/index.js";

import type { AccountRecord } from "../../store/account-store.js";
import type {
  CreateFolderInput,
  DraftUpdateInput,
  EmailAddress,
  FolderInfo,
  SendInput,
} from "../types.js";
import {
  GmailClientFactory,
} from "./client.js";
import {
  base64urlEncode,
  buildRawMessage,
  mapFolder,
  mapHeaderAddr,
  findHeader,
  resolveLabel,
  resolveLabelsForMove,
} from "./helpers.js";

/**
 * Write operations for Gmail — send, draft, move, mark, folders.
 */

export async function sendEmail(
  clients: GmailClientFactory,
  account: AccountRecord,
  msg: SendInput,
): Promise<{ id: string }> {
  const { gmail } = clients.get(account);

  let threadId: string | undefined;
  let rawBody: { raw: string };

  if (msg.forwardMessageId) {
    const fwdRes = await gmail.users.messages.get({
      userId: "me",
      id: msg.forwardMessageId,
      format: "raw",
    });
    threadId = fwdRes.data.threadId ?? undefined;
    const fwdRaw = fwdRes.data.raw;
    if (fwdRaw) {
      const fwdStr = Buffer.from(
        fwdRaw.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf-8");

      const divider =
        '\n\n<div style="line-height:12px"><br></div>\n\n' +
        '<div style="border-left:2px solid #ccc; padding-left:8px; ' +
        'margin-left:0; color:#666">\n' +
        "---------- Forwarded message ---------<br>" +
        fwdStr +
        "\n</div>";

      const combinedMsg = { ...msg, body: msg.body + divider };
      rawBody = await buildRawMessage(account, combinedMsg);
    } else {
      rawBody = await buildRawMessage(account, msg);
    }
  } else {
    rawBody = await buildRawMessage(account, msg);

    if (msg.inReplyTo) {
      try {
        const refRes = await gmail.users.messages.get({
          userId: "me",
          id: msg.inReplyTo,
          format: "minimal",
        });
        threadId = refRes.data.threadId ?? undefined;
      } catch {
        /* proceed without threading */
      }
    }
  }

  const sendRes = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: rawBody.raw,
      threadId,
    },
  });

  return { id: sendRes.data.id ?? "" };
}

export async function saveDraft(
  clients: GmailClientFactory,
  account: AccountRecord,
  msg: SendInput,
): Promise<{ id: string }> {
  const { gmail } = clients.get(account);
  const { raw } = await buildRawMessage(account, msg);

  let threadId: string | undefined;
  if (msg.inReplyTo) {
    try {
      const refRes = await gmail.users.messages.get({
        userId: "me",
        id: msg.inReplyTo,
        format: "minimal",
      });
      threadId = refRes.data.threadId ?? undefined;
    } catch {
      /* proceed without threading */
    }
  }

  const draftRes = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: { raw, threadId },
    },
  });

  return { id: draftRes.data.message?.id ?? draftRes.data.id ?? "" };
}

export async function updateDraft(
  clients: GmailClientFactory,
  account: AccountRecord,
  id: string,
  update: DraftUpdateInput,
): Promise<{ id: string }> {
  const { gmail } = clients.get(account);

  const draftRes = await gmail.users.drafts.get({
    userId: "me",
    id,
    format: "raw",
  });

  const existingMessage = draftRes.data.message;
  if (!existingMessage?.raw) {
    throw new Error(`draft not found: ${id}`);
  }

  const existingHeaders = existingMessage.payload?.headers ?? [];
  const origSubject = findHeader(existingHeaders, "Subject") ?? "";

  const rawStr = Buffer.from(
    existingMessage.raw.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf-8");

  // Extract existing To/CC recipients from headers
  const existingTo = update.to ?? mapHeaderAddr(findHeader(existingHeaders, "To"));
  const existingCc = update.cc ?? mapHeaderAddr(findHeader(existingHeaders, "Cc"));
  const existingBcc = update.bcc ?? mapHeaderAddr(findHeader(existingHeaders, "Bcc"));

  const { raw } = await buildRawMessage(account, {
    to: existingTo,
    subject: update.subject ?? origSubject,
    body: update.body ?? "",
    isHtml: update.isHtml,
    inReplyTo: false,
    cc: existingCc.length > 0 ? existingCc : undefined,
    bcc: existingBcc.length > 0 ? existingBcc : undefined,
  });

  const updated = await gmail.users.drafts.update({
    userId: "me",
    id,
    requestBody: {
      message: {
        raw,
        threadId: existingMessage.threadId ?? undefined,
      },
    },
  });

  return { id: updated.data.message?.id ?? updated.data.id ?? id };
}

export async function moveEmail(
  clients: GmailClientFactory,
  account: AccountRecord,
  id: string,
  destinationId: string,
): Promise<void> {
  const { gmail } = clients.get(account);
  const { addLabelIds, removeLabelIds } =
    resolveLabelsForMove(destinationId);

  await gmail.users.messages.modify({
    userId: "me",
    id,
    requestBody: { addLabelIds, removeLabelIds },
  });
}

export async function sendDraft(
  clients: GmailClientFactory,
  account: AccountRecord,
  id: string,
): Promise<{ id: string }> {
  const { gmail } = clients.get(account);
  const res = await gmail.users.drafts.send({
    userId: "me",
    requestBody: { id },
  });
  return { id: res.data.id ?? id };
}

export async function addAttachmentToDraft(
  clients: GmailClientFactory,
  account: AccountRecord,
  draftId: string,
  name: string,
  contentBytes: string,
  contentType?: string,
): Promise<{
  id: string;
  attachment: { id: string; name: string; contentType?: string };
}> {
  const { gmail } = clients.get(account);

  const draftRes = await gmail.users.drafts.get({
    userId: "me",
    id: draftId,
    format: "raw",
  });

  const existingMessage = draftRes.data.message;
  if (!existingMessage?.raw) {
    throw new Error(`draft not found: ${draftId}`);
  }

  const rawStr = Buffer.from(
    existingMessage.raw.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf-8");

  const newRawStr = await new Promise<string>((resolve, reject) => {
    const mc = new MailComposer({
      raw: rawStr,
      attachments: [
        {
          filename: name,
          content: Buffer.from(contentBytes, "base64"),
          contentType: contentType ?? "application/octet-stream",
        },
      ],
    });
    mc.compile().build((err: Error | null, buf: Buffer) => {
      if (err) reject(err);
      else resolve(buf.toString("utf-8"));
    });
  });

  const updated = await gmail.users.drafts.update({
    userId: "me",
    id: draftId,
    requestBody: {
      message: {
        raw: base64urlEncode(Buffer.from(newRawStr, "utf-8")),
        threadId: existingMessage.threadId ?? undefined,
      },
    },
  });

  return {
    id: updated.data.message?.id ?? updated.data.id ?? draftId,
    attachment: {
      id: randomUUID(),
      name,
      contentType: contentType ?? "application/octet-stream",
    },
  };
}

export async function markRead(
  clients: GmailClientFactory,
  account: AccountRecord,
  id: string,
  isRead: boolean,
): Promise<void> {
  const { gmail } = clients.get(account);
  await gmail.users.messages.modify({
    userId: "me",
    id,
    requestBody: {
      removeLabelIds: isRead ? ["UNREAD"] : undefined,
      addLabelIds: isRead ? undefined : ["UNREAD"],
    },
  });
}

export async function createFolder(
  clients: GmailClientFactory,
  account: AccountRecord,
  input: CreateFolderInput,
): Promise<FolderInfo> {
  const { gmail } = clients.get(account);
  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: input.displayName,
      messageListVisibility: "show",
      labelListVisibility: "labelShow",
    },
  });
  return mapFolder(created.data);
}

export async function renameFolder(
  clients: GmailClientFactory,
  account: AccountRecord,
  folderId: string,
  newName: string,
): Promise<FolderInfo> {
  const { gmail } = clients.get(account);
  const updated = await gmail.users.labels.patch({
    userId: "me",
    id: folderId,
    requestBody: { name: newName },
  });
  return mapFolder(updated.data);
}

export async function deleteFolder(
  clients: GmailClientFactory,
  account: AccountRecord,
  folderId: string,
): Promise<void> {
  const { gmail } = clients.get(account);
  await gmail.users.labels.delete({
    userId: "me",
    id: folderId,
  });
}
