import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";

import MailComposer from "nodemailer/lib/mail-composer/index.js";

import type { AccountRecord } from "../../store/account-store.js";
import type {
  CreateFolderInput,
  DraftUpdateInput,
  EmailAddress,
  EmailReference,
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
  gmailMessageWebLink,
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
): Promise<EmailReference> {
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

  const messageId = sendRes.data.id;
  return { id: messageId ?? "", ...gmailMessageWebLink(account, messageId) };
}

export async function saveDraft(
  clients: GmailClientFactory,
  account: AccountRecord,
  msg: SendInput,
): Promise<EmailReference> {
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

  const messageId = draftRes.data.message?.id;
  return {
    id: messageId ?? draftRes.data.id ?? "",
    ...gmailMessageWebLink(account, messageId),
  };
}

export async function updateDraft(
  clients: GmailClientFactory,
  account: AccountRecord,
  id: string,
  update: DraftUpdateInput,
): Promise<EmailReference> {
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

  const messageId = updated.data.message?.id;
  return {
    id: messageId ?? updated.data.id ?? id,
    ...gmailMessageWebLink(account, messageId),
  };
}

export function isTrashDestination(destinationId: string): boolean {
  const lower = destinationId.toLowerCase();
  return lower === "deleteditems" || lower === "trash";
}

export async function moveEmail(
  clients: GmailClientFactory,
  account: AccountRecord,
  id: string,
  destinationId: string,
): Promise<EmailReference> {
  if (isTrashDestination(destinationId)) {
    return trashEmail(clients, account, id);
  }

  const { gmail } = clients.get(account);
  const { addLabelIds, removeLabelIds } =
    resolveLabelsForMove(destinationId);

  await gmail.users.messages.modify({
    userId: "me",
    id,
    requestBody: { addLabelIds, removeLabelIds },
  });
  return { id, ...gmailMessageWebLink(account, id) };
}

export async function trashEmail(
  clients: GmailClientFactory,
  account: AccountRecord,
  id: string,
): Promise<EmailReference> {
  const { gmail } = clients.get(account);
  const res = await gmail.users.messages.trash({
    userId: "me",
    id,
  });
  const messageId = res.data.id ?? id;
  return { id: messageId, ...gmailMessageWebLink(account, messageId) };
}

export async function sendDraft(
  clients: GmailClientFactory,
  account: AccountRecord,
  id: string,
): Promise<EmailReference> {
  const { gmail } = clients.get(account);
  const res = await gmail.users.drafts.send({
    userId: "me",
    requestBody: { id },
  });
  const messageId = res.data.id;
  return {
    id: messageId ?? id,
    ...gmailMessageWebLink(account, messageId),
  };
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

export async function removeAttachmentFromDraft(
  clients: GmailClientFactory,
  account: AccountRecord,
  draftId: string,
  attachmentId: string,
): Promise<void> {
  const { gmail } = clients.get(account);

  // Get the draft with full payload to find the attachment part
  const fullDraft = await gmail.users.drafts.get({
    userId: "me",
    id: draftId,
    format: "full",
  });

  const message = fullDraft.data.message;
  if (!message?.payload) {
    throw new Error(`draft not found: ${draftId}`);
  }

  // Walk the payload parts to find the attachment with matching attachmentId
  let targetFilename: string | undefined;
  let targetMimeType: string | undefined;

  function findAttachment(parts: any[] | undefined): boolean {
    if (!parts) return false;
    for (const part of parts) {
      if (part.body?.attachmentId === attachmentId) {
        targetFilename = part.filename ?? undefined;
        targetMimeType = part.mimeType ?? undefined;
        return true;
      }
      if (part.parts && findAttachment(part.parts)) {
        return true;
      }
    }
    return false;
  }

  if (!findAttachment(message.payload.parts)) {
    throw new Error(`attachment not found: ${attachmentId}`);
  }

  // Get the raw message
  const rawDraft = await gmail.users.drafts.get({
    userId: "me",
    id: draftId,
    format: "raw",
  });

  const rawStr = Buffer.from(
    rawDraft.data.message!.raw!.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf-8");

  // Parse and remove the attachment from the MIME message
  const newRawStr = removeMimeAttachment(rawStr, targetFilename, targetMimeType);

  // Update the draft with the modified message
  await gmail.users.drafts.update({
    userId: "me",
    id: draftId,
    requestBody: {
      message: {
        raw: base64urlEncode(Buffer.from(newRawStr, "utf-8")),
        threadId: message.threadId ?? undefined,
      },
    },
  });
}

/**
 * Remove a specific attachment from a raw MIME message.
 * Uses boundary-based parsing to identify and remove the matching part.
 */
function removeMimeAttachment(
  rawMime: string,
  targetFilename: string | undefined,
  targetMimeType: string | undefined,
): string {
  // Extract boundary from Content-Type header
  const boundaryMatch = rawMime.match(/boundary="?([^";]+)"?/i);
  if (!boundaryMatch) {
    // Not a multipart message, can't remove attachment
    return rawMime;
  }

  const boundary = boundaryMatch[1];
  const delimiter = `--${boundary}`;

  // Split by boundary
  const parts = rawMime.split(delimiter);

  // Filter out the part matching the target attachment
  const filtered = parts.filter((part) => {
    if (!part.trim() || part.trim() === "--") {
      return true; // Keep preamble and closing delimiter
    }

    // Check if this part is the target attachment
    const contentDispMatch = targetFilename &&
      part.match(new RegExp(`Content-Disposition:.*?filename="?${escapeRegex(targetFilename)}"?`, "i"));

    const contentTypeMatch = targetMimeType &&
      part.match(new RegExp(`Content-Type:\s*${escapeRegex(targetMimeType)}`, "i"));

    // If both filename and mime type are specified, both must match
    // If only one is specified, that one must match
    if (targetFilename && targetMimeType) {
      return !(contentDispMatch && contentTypeMatch);
    } else if (targetFilename) {
      return !contentDispMatch;
    } else if (targetMimeType) {
      return !contentTypeMatch;
    }

    return true; // No target specified, keep all parts
  });

  return filtered.join(delimiter);
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function markRead(
  clients: GmailClientFactory,
  account: AccountRecord,
  id: string,
  isRead: boolean,
): Promise<EmailReference> {
  const { gmail } = clients.get(account);
  await gmail.users.messages.modify({
    userId: "me",
    id,
    requestBody: {
      removeLabelIds: isRead ? ["UNREAD"] : undefined,
      addLabelIds: isRead ? undefined : ["UNREAD"],
    },
  });
  return { id, ...gmailMessageWebLink(account, id) };
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
