import { describe, expect, it } from "vitest";

import {
  applyExactTextEdit,
  emailReferenceOutputSchema,
  emailSummaryOutputSchema,
  errMsg,
} from "./shared.js";

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

describe("email web link schemas", () => {
  it("accepts a native web URL on email results", () => {
    expect(
      emailSummaryOutputSchema.parse({
        id: "message-1",
        subject: "Subject",
        webUrl: "https://mail.example.com/message/1",
      }),
    ).toEqual({
      id: "message-1",
      subject: "Subject",
      webUrl: "https://mail.example.com/message/1",
    });
  });

  it("accepts a per-email unavailable reason", () => {
    expect(
      emailReferenceOutputSchema.parse({
        id: "message-1",
        webUrlUnavailableReason: "Native webmail links are unavailable.",
      }),
    ).toEqual({
      id: "message-1",
      webUrlUnavailableReason: "Native webmail links are unavailable.",
    });
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
