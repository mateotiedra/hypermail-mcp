import { describe, expect, it } from "vitest";

import { errMsg } from "./shared.js";

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
