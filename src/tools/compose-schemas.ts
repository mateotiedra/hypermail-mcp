import { z } from "zod";

import { emailAddrSchema } from "./shared.js";

export const sendEmailSchema = z.object({
  account: z.string().email(),
  to: z.array(emailAddrSchema).min(1),
  cc: z.array(emailAddrSchema).optional(),
  bcc: z.array(emailAddrSchema).optional(),
  subject: z.string(),
  body: z.string(),
  format: z
    .enum(["html", "markdown"])
    .describe(
      "Body format. 'html' sends the body as-is (must be valid HTML). " +
        "'markdown' converts the body from Markdown to HTML for clean rendering on the recipient side.",
    ),
  include_signature: z
    .boolean()
    .describe(
      "Whether to append the account's saved HTML signature to the email. " +
        "If true, don't include a signature in the body param to avoid double signature. " +
        "Returns an error if true but no signature is configured for this account.",
    ),
  inReplyTo: z
    .union([z.string(), z.literal(false)])
    .describe(
      "Message ID to reply to. When set, sends as a threaded reply " +
        "which includes the quoted thread history automatically. " +
        "Set to `false` for a new email (not a reply).",
    ),
  replyAll: z
    .boolean()
    .default(false)
    .optional()
    .describe(
      "When true and `inReplyTo` is set, reply to all recipients " +
        "instead of just the sender.",
    ),
  forwardMessageId: z
    .string()
    .optional()
    .describe(
      "Message ID to forward. When set, sends as a forward of the " +
        "specified message, preserving the original content. " +
        "Mutually exclusive with `inReplyTo`.",
    ),
  attachments: z
    .array(
      z.object({
        filePath: z.string().min(1).describe("Absolute path to a local file"),
        name: z
          .string()
          .optional()
          .describe("Attachment filename. Defaults to the file's basename."),
      }),
    )
    .optional()
    .describe(
      "File attachments to include. The server reads the files from " +
        "disk and base64-encodes them automatically.",
    ),
});

export type SendEmailArgs = z.infer<typeof sendEmailSchema>;

export const editDraftSchema = z.object({
  account: z.string().email(),
  id: z.string().min(1).describe("Draft message ID to edit"),
  to: z.array(emailAddrSchema).optional(),
  cc: z.array(emailAddrSchema).optional(),
  bcc: z.array(emailAddrSchema).optional(),
  subject: z.string().optional(),
  old_text: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Exact current HTML section to replace in the draft body. " +
        "Copy this from `draftHtml` or from `read_email` with format='html'. " +
        "Must match exactly once; unselected content is preserved.",
    ),
  new_text: z
    .string()
    .optional()
    .describe(
      "Replacement content for `old_text`. The replacement is composed " +
        "using `format` and `include_signature`, then inserted exactly " +
        "where `old_text` matched.",
    ),
  body: z
    .string()
    .optional()
    .describe(
      "Deprecated alias for `new_text`. Body-only full replacement is " +
        "not supported; provide `old_text` with this field.",
    ),
  format: z
    .enum(["html", "markdown"])
    .optional()
    .describe(
      "Replacement format. Only meaningful when `new_text` or deprecated " +
        "`body` is also provided. 'html' inserts the replacement as-is " +
        "(must be valid HTML). 'markdown' converts the replacement from Markdown to HTML.",
    ),
  include_signature: z
    .boolean()
    .optional()
    .describe(
      "Whether to append the account's saved HTML signature to the " +
        "replacement section. If true, don't include a signature in " +
        "`new_text`/`body`. Only meaningful when replacement content is provided. " +
        "Returns an error if true but no signature is configured for this account.",
    ),
  new_attachments: z
    .array(
      z.object({
        filePath: z.string().min(1).describe("Absolute path to a local file"),
        name: z
          .string()
          .optional()
          .describe("Attachment filename. Defaults to the file's basename."),
      }),
    )
    .optional()
    .describe(
      "New file attachments to add to the draft. The server reads " +
        "the files from disk and base64-encodes them automatically.",
    ),
  remove_attachments: z
    .array(z.string().min(1))
    .optional()
    .describe("Attachment IDs to remove from the draft. Get attachment IDs from read_email."),
});

export type EditDraftArgs = z.infer<typeof editDraftSchema>;
