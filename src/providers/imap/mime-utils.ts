import type { BodyNode } from "./helpers.js";

/**
 * MIME parsing utilities for attachment manipulation.
 */

export interface AttachmentInfo {
  filename: string;
  contentType: string;
}

/**
 * Recursively search MIME structure to find an attachment by ID.
 */
export function findAttachmentInMime(
  structure: BodyNode | BodyNode[] | undefined,
  attachmentId: string,
): AttachmentInfo | null {
  if (!structure) return null;

  // Handle multipart
  if (Array.isArray(structure)) {
    for (const part of structure) {
      const result = findAttachmentInMime(part, attachmentId);
      if (result) return result;
    }
    return null;
  }

  // Check if this part is the target attachment
  if (structure.part === attachmentId) {
    return {
      filename:
        structure.dispositionParameters?.filename ??
        structure.parameters?.name ??
        "attachment",
      contentType: structure.type ?? "application/octet-stream",
    };
  }

  // Recurse into nested parts
  if (structure.childNodes) {
    return findAttachmentInMime(structure.childNodes, attachmentId);
  }

  return null;
}

/**
 * Remove a MIME part from a message source based on filename and content type.
 */
export function removeMimePart(
  source: string,
  targetFilename: string,
  targetContentType: string,
): string {
  const lines = source.split("\r\n");
  const result: string[] = [];
  let skip = false;
  let inTargetPart = false;

  for (const line of lines) {
    const lowerLine = line.toLowerCase();

    // Check for boundary
    if (line.startsWith("--")) {
      if (inTargetPart) {
        // End of target part, stop skipping
        skip = false;
        inTargetPart = false;
      }
      result.push(line);
      continue;
    }

    // Check if this is the start of the target attachment part
    if (
      lowerLine.includes("content-disposition:") &&
      lowerLine.includes(`filename="${targetFilename.toLowerCase()}"`)
    ) {
      inTargetPart = true;
      skip = true;
      continue;
    }

    // Also check content-type match
    if (
      inTargetPart &&
      lowerLine.includes("content-type:") &&
      lowerLine.includes(targetContentType.toLowerCase())
    ) {
      skip = true;
      continue;
    }

    if (!skip) {
      result.push(line);
    }
  }

  return result.join("\r\n");
}
