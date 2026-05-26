import { z } from "zod";
import type { ResolvedTools } from "../config.js";
import { markdownToHtml } from "../markdown-to-html.js";

/** JSON-stringify a value into a single MCP text content block. */
export function ok(
  data: unknown,
  structuredContent?: Record<string, unknown>,
) {
  const result: {
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: Record<string, unknown>;
  } = {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
  if (structuredContent !== undefined) {
    result.structuredContent = structuredContent;
  }
  return result;
}

export function fail(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ── shared schemas ──

/** Enum matching {@link import("../providers/types.js").ProviderId}. */
export const providerIdEnum = z.enum(["outlook", "imap", "gmail"]);

export const emailAddrSchema = z.object({
  address: z.string().email(),
  name: z.string().optional(),
});

export const emailAddrOutputSchema = z.object({
  name: z.string().optional(),
  address: z.string(),
});

export const accountSummaryOutputSchema = z.object({
  email: z.string(),
  provider: providerIdEnum,
  displayName: z.string().optional(),
  addedAt: z.string(),
  hasSignature: z.boolean(),
  hasStyle: z.boolean(),
});

export const styleOutputSchema = z.object({
  fontFamily: z.string().optional(),
  fontSize: z.string().optional(),
  fontColor: z.string().optional(),
});

/** Full account record including tokens, signature, and style. */
export const accountFullOutputSchema = z.object({
  email: z.string(),
  provider: providerIdEnum,
  displayName: z.string().optional(),
  tokens: z.record(z.string(), z.unknown()),
  addedAt: z.string(),
  signature: z.string().optional(),
  style: styleOutputSchema.optional(),
});

export const emailSummaryOutputSchema = z.object({
  id: z.string(),
  subject: z.string(),
  from: emailAddrOutputSchema.optional(),
  to: z.array(emailAddrOutputSchema).optional(),
  receivedAt: z.string().optional(),
  preview: z.string().optional(),
  isRead: z.boolean().optional(),
  hasAttachments: z.boolean().optional(),
  folder: z.string().optional(),
});

export const attachmentMetaOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  contentType: z.string().optional(),
  size: z.number().optional(),
});

export const folderInfoOutputSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  parentFolderId: z.string().optional(),
  childFolderCount: z.number(),
  totalItemCount: z.number(),
  unreadItemCount: z.number(),
});

// ── body composition helpers ──

export interface ComposeBodyInput {
  body: string;
  format: "html" | "markdown";
  signature?: string;
  style?: { fontFamily?: string; fontSize?: string; fontColor?: string };
  includeSignature: boolean;
}

export function composeBody(
  input: ComposeBodyInput,
): { body: string; isHtml: boolean } {
  const { body, format, signature, style, includeSignature } = input;

  // Convert markdown to HTML first, then proceed as HTML
  const htmlBody = format === "markdown" ? markdownToHtml(body) : body;

  const hasSignature = includeSignature && !!signature;
  const hasStyle = !!(
    style &&
    (style.fontFamily || style.fontSize || style.fontColor)
  );

  if (!hasSignature && !hasStyle) {
    return { body: htmlBody, isHtml: true };
  }

  const styleAttr = hasStyle ? buildStyleAttr(style!) : "";
  let result = hasStyle
    ? `<div style="${styleAttr}">${htmlBody}</div>`
    : htmlBody;
  if (hasSignature) result += `\n<div class="signature">${signature}</div>`;
  return { body: result, isHtml: true };
}

export function buildStyleAttr(style: {
  fontFamily?: string;
  fontSize?: string;
  fontColor?: string;
}): string {
  const parts: string[] = [];
  if (style.fontFamily) parts.push(`font-family: ${style.fontFamily}`);
  if (style.fontSize) parts.push(`font-size: ${style.fontSize}`);
  if (style.fontColor) parts.push(`color: ${style.fontColor}`);
  return parts.join("; ");
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}

// ── tool filtering ──

/** Returns true when `name` should be registered given the tool filtering config. */
export function shouldRegister(
  name: string,
  tools: ResolvedTools,
): boolean {
  if (tools.enabledTools) {
    return tools.enabledTools.has(name);
  }
  if (tools.disabledTools) {
    return !tools.disabledTools.has(name);
  }
  return true;
}
