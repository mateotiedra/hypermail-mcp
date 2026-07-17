import type { AccountRecord } from "../../store/account-store.js";
import type { SendInput } from "../types.js";
import { ImapClient } from "./client.js";
import { decodeId, ImapEnvelope } from "./helpers.js";
import { simpleParser, type ParsedMail } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer/index.js";

export function formatAddresses(addresses: Array<{ name?: string; address: string }>): string {
  return addresses
    .map((address) =>
      address.name ? `"${address.name}" <${address.address}>` : address.address,
    )
    .join(", ");
}

export function addressText(address: ParsedMail["to"]): string | undefined {
  return Array.isArray(address)
    ? address.map((entry) => entry.text).join(", ")
    : address?.text;
}

export async function buildMailOptions(
  client: ImapClient,
  account: AccountRecord,
  msg: SendInput,
  messageId?: string,
): Promise<import("nodemailer").SendMailOptions> {
  const mailOptions: import("nodemailer").SendMailOptions = {
    from: `${account.displayName ?? ""} <${account.email}>`,
    to: msg.to
      .map((a) => (a.name ? `"${a.name}" <${a.address}>` : a.address))
      .join(", "),
    subject: msg.subject,
    attachDataUrls: true,
  };

  if (msg.isHtml) {
    mailOptions.html = msg.body;
  } else {
    mailOptions.text = msg.body;
  }

  if (msg.cc && msg.cc.length > 0) {
    mailOptions.cc = msg.cc
      .map((a) => (a.name ? `"${a.name}" <${a.address}>` : a.address))
      .join(", ");
  }
  if (msg.bcc && msg.bcc.length > 0) {
    mailOptions.bcc = msg.bcc
      .map((a) => (a.name ? `"${a.name}" <${a.address}>` : a.address))
      .join(", ");
  }

  if (msg.attachments && msg.attachments.length > 0) {
    mailOptions.attachments = msg.attachments.map((att) => ({
      filename: att.name,
      content: Buffer.from(att.contentBytes, "base64"),
      contentType: att.contentType,
    }));
  }

  if (messageId) {
    mailOptions.messageId = messageId;
  }

  await applyReferenceMessage(client, mailOptions, msg);
  return mailOptions;
}

async function applyReferenceMessage(
  client: ImapClient,
  mailOptions: import("nodemailer").SendMailOptions,
  msg: SendInput,
): Promise<void> {
  if (!msg.inReplyTo && !msg.forwardMessageId) return;

  const refId = msg.inReplyTo || msg.forwardMessageId;
  if (!refId) return;

  try {
    const { folder: refFolder, uid: refUid } = decodeId(refId);
    const refMsg = (await client.withMailbox(refFolder, async (imap) => {
      return imap.fetchOne(
        refUid,
        { envelope: true, source: true },
        { uid: true },
      );
    })) as { envelope?: ImapEnvelope; source?: string | ArrayBuffer };

    const source = refMsg?.source
      ? typeof refMsg.source === "string"
        ? Buffer.from(refMsg.source, "utf-8")
        : Buffer.from(refMsg.source)
      : undefined;

    if (refMsg?.envelope) {
      const env = refMsg.envelope as ImapEnvelope;
      if (msg.inReplyTo && env.messageId && !msg.forwardMessageId) {
        mailOptions.inReplyTo = env.messageId;
        mailOptions.references = env.messageId;
      }
    }

    if (msg.inReplyTo && source) {
      const parsed = await simpleParser(source);
      if (mailOptions.html !== undefined) {
        const referencedHtml =
          parsed.html === false
            ? parsed.textAsHtml ??
              `<pre>${(parsed.text ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")}</pre>`
            : parsed.html ?? parsed.textAsHtml;
        mailOptions.html = `${mailOptions.html}\n\n<div style="line-height:12px"><br></div>\n\n<blockquote>${referencedHtml ?? ""}</blockquote>`;
      } else if (mailOptions.text !== undefined) {
        const referencedText = (parsed.text ?? "").replace(/^/gm, "> ");
        mailOptions.text = `${mailOptions.text}\n\n---------- Original message ---------\n${referencedText}`;
      }
    }

    if (msg.forwardMessageId && source) {
      const sourceStr = source.toString("utf-8");
      const divider =
        '\n\n<div style="line-height:12px"><br></div>\n\n' +
        '<div style="border-left:2px solid #ccc; padding-left:8px; ' +
        'margin-left:0; color:#666">\n' +
        "---------- Forwarded message ---------<br>" +
        sourceStr +
        "\n</div>";
      if (mailOptions.html) {
        mailOptions.html = `${mailOptions.html}${divider}`;
      } else if (mailOptions.text) {
        mailOptions.text = `${mailOptions.text}\n\n---------- Forwarded message ---------\n${sourceStr}`;
      }
    }
  } catch {
    /* If we can't fetch the referenced message, proceed without threading. */
  }
}

export async function buildRawMessage(
  client: ImapClient,
  account: AccountRecord,
  msg: SendInput,
  messageId?: string,
  keepBcc = false,
): Promise<string> {
  const mailOptions = await buildMailOptions(client, account, msg, messageId);

  return new Promise<string>((resolve, reject) => {
    const mc = new MailComposer(mailOptions);
    const compiled = mc.compile();
    compiled.keepBcc = keepBcc;
    compiled.build((err: Error | null, buf: Buffer) => {
      if (err) reject(err);
      else resolve(normalizeBodyLineEndings(buf.toString("utf-8")));
    });
  });
}

export function normalizeBodyLineEndings(value: string): string;
export function normalizeBodyLineEndings(value: undefined): undefined;
export function normalizeBodyLineEndings(value: string | undefined): string | undefined;
export function normalizeBodyLineEndings(value: string | undefined): string | undefined {
  return value?.replace(/\r\n|\r|\n/g, "\r\n");
}
