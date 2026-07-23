import { parseInlineImages } from "../shared/inline-images.js";
import type { EmailAddress, EmailSummary, FolderInfo } from "../types.js";
import { graphWebLinkFields } from "./web-links.js";

export interface InlineAttachment {
  "@odata.type": string;
  name: string;
  contentType: string;
  contentId: string;
  contentBytes: string;
  isInline: boolean;
}

/**
 * Scans HTML for data:image/...;base64,... URIs, extracts the raw base64
 * data, assigns unique contentIds, and returns the transformed body
 * (with src="cid:..." references) plus an array of inline fileAttachment
 * objects ready for the Graph API.
 *
 * Delegates the HTML parsing to the shared {@link parseInlineImages} and
 * then wraps each image in an Outlook-specific `@odata.type` attachment.
 *
 * Pass-through when there are no matches — returns the original body with
 * an empty attachments array.
 */
export function convertInlineImages(body: string): {
  body: string;
  attachments: InlineAttachment[];
} {
  const { body: transformed, images } = parseInlineImages(body);
  const attachments: InlineAttachment[] = images.map((img) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: img.filename,
    contentType: img.contentType,
    contentId: img.cid,
    contentBytes: img.contentBytes,
    isInline: true,
  }));
  return { body: transformed, attachments };
}

export interface GraphRecipient {
  emailAddress?: { name?: string; address?: string };
}

export interface GraphMessage {
  id: string;
  subject?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  bodyPreview?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  webLink?: string;
  parentFolderId?: string;
  body?: { contentType?: "text" | "html"; content?: string };
}

export interface GraphAttachment {
  id: string;
  name: string;
  contentType?: string;
  size?: number;
}

export interface GraphFolder {
  id: string;
  displayName: string;
  parentFolderId?: string;
  childFolderCount: number;
  totalItemCount: number;
  unreadItemCount: number;
}

export function mapFolder(f: GraphFolder): FolderInfo {
  return {
    id: f.id,
    displayName: f.displayName,
    parentFolderId: f.parentFolderId,
    childFolderCount: f.childFolderCount,
    totalItemCount: f.totalItemCount,
    unreadItemCount: f.unreadItemCount,
  };
}

export function mapRecipient(r: GraphRecipient): EmailAddress {
  return {
    name: r.emailAddress?.name,
    address: r.emailAddress?.address ?? "",
  };
}

export function mapSummary(m: GraphMessage, folder?: string): EmailSummary {
  return {
    id: m.id,
    subject: m.subject ?? "",
    from: m.from ? mapRecipient(m.from) : undefined,
    to: (m.toRecipients ?? []).map(mapRecipient),
    receivedAt: m.receivedDateTime,
    preview: m.bodyPreview,
    isRead: m.isRead,
    hasAttachments: m.hasAttachments,
    ...graphWebLinkFields(m.webLink),
    folder,
  };
}

export function toRecipient(a: EmailAddress): GraphRecipient {
  return { emailAddress: { name: a.name, address: a.address } };
}

export function clampLimit(v: number | undefined, dflt: number, max: number): number {
  if (!v || v <= 0) return dflt;
  return Math.min(v, max);
}
