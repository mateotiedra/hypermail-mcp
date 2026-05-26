import { marked } from "marked";

/** Convert Markdown string to HTML. */
export function markdownToHtml(md: string): string {
  return marked.parse(md, { async: false }) as string;
}
