import { randomUUID } from "node:crypto";

/** A generic inline image extracted from an HTML body. */
export interface InlineImage {
  /** The generated Content-ID (without "cid:" prefix). */
  cid: string;
  /** Raw base64 content bytes (without the data:image/...;base64, prefix). */
  contentBytes: string;
  /** Full MIME type, e.g. "image/png". */
  contentType: string;
  /** Suggested filename, e.g. "signature-image.png". */
  filename: string;
}

/**
 * Parse an HTML body for `data:image/<subtype>;base64,<payload>` URIs inside
 * `src="..."` attributes. Each match is replaced with a `cid:<uuid>` reference,
 * and the extracted base64 data is collected into a flat image array.
 *
 * This is provider-agnostic — each provider wraps the result into its own
 * attachment format (e.g. Outlook `@odata.type` objects or nodemailer
 * `cid` attachments).
 */
export function parseInlineImages(html: string): {
  body: string;
  images: InlineImage[];
} {
  const images: InlineImage[] = [];
  // Match src="data:image/<subtype>;base64,<payload>"
  // Supports png, jpg, jpeg, gif, svg+xml, webp, bmp, etc.
  const re = /src="data:image\/([\w+]+);base64,([^"]+)"/gi;

  const transformed = html.replace(re, (_fullMatch, mimeSubtype, b64) => {
    const contentId = `sig-img-${randomUUID()}`;
    const ext =
      mimeSubtype.toLowerCase().replace(/\+/g, "-") === "svg-xml"
        ? "svg"
        : mimeSubtype.toLowerCase().replace(/\+/g, "-");
    images.push({
      cid: contentId,
      contentBytes: b64,
      contentType: `image/${mimeSubtype}`,
      filename: `signature-image.${ext}`,
    });
    return `src="cid:${contentId}"`;
  });

  return { body: transformed, images };
}
