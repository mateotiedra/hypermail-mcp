import { describe, expect, it } from "vitest";

import { applyExactTextEdit, errMsg } from "./shared.js";

describe("errMsg", () => {
  it("normalizes known missing Gmail config errors for MCP users", () => {
    expect(errMsg(new Error("HYPERMAIL_GMAIL_CLIENT_ID is required for Gmail OAuth"))).toBe(
      "Missing Gmail OAuth configuration: set HYPERMAIL_GMAIL_CLIENT_ID before adding a Gmail account.",
    );
  });

  it("passes through unrelated errors", () => {
    expect(errMsg(new Error("boom"))).toBe("boom");
  });
});

describe("applyExactTextEdit", () => {
  it("replaces one selected section and preserves the rest", () => {
    expect(
      applyExactTextEdit(
        "<p>hello</p><blockquote>history</blockquote>",
        "<p>hello</p>",
        "<p>updated</p>",
      ),
    ).toBe("<p>updated</p><blockquote>history</blockquote>");
  });

  it("throws when the selected section is not found", () => {
    expect(() => applyExactTextEdit("<p>hello</p>", "missing", "new")).toThrow(
      "old_text was not found",
    );
  });

  it("throws when the selected section matches multiple places", () => {
    expect(() => applyExactTextEdit("<p>x</p><p>x</p>", "<p>x</p>", "new")).toThrow(
      "old_text matched multiple sections",
    );
  });
});
