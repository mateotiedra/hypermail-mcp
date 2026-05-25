import { describe, it, expect } from "vitest";
import {
  encodeId,
  decodeId,
  resolveFolder,
  clampLimit,
  findAttachments,
  findPartByType,
  mapEnvelopeAddr,
  mapSummary,
  ImapEnvelope,
  BodyNode,
} from "./helpers.js";
import { isImapTokens, extractTokens, ImapTokens } from "./client.js";
import type { AccountRecord } from "../../store/account-store.js";

// ---------- ID encoding ----------

describe("encodeId / decodeId", () => {
  it("encodes folder + uid into a composite ID", () => {
    expect(encodeId("INBOX", 42)).toBe("INBOX/42");
    expect(encodeId("Drafts", 7)).toBe("Drafts/7");
  });

  it("round-trips correctly", () => {
    const id = encodeId("INBOX/subfolder", 123);
    const { folder, uid } = decodeId(id);
    expect(folder).toBe("INBOX/subfolder");
    expect(uid).toBe(123);
  });

  it("decodes ID with folder containing slashes", () => {
    const { folder, uid } = decodeId("Projects/2024/456");
    expect(folder).toBe("Projects/2024");
    expect(uid).toBe(456);
  });

  it("throws on invalid ID format", () => {
    expect(() => decodeId("nouid")).toThrow("invalid message ID");
    expect(() => decodeId("INBOX/abc")).toThrow("invalid message UID");
    expect(() => decodeId("INBOX/0")).toThrow("invalid message UID");
  });
});

// ---------- well-known folder mapping ----------

describe("resolveFolder", () => {
  it("maps well-known names to IMAP paths", () => {
    expect(resolveFolder("archive")).toBe("Archive");
    expect(resolveFolder("deleteditems")).toBe("Trash");
    expect(resolveFolder("inbox")).toBe("INBOX");
    expect(resolveFolder("drafts")).toBe("Drafts");
    expect(resolveFolder("sentitems")).toBe("Sent");
    expect(resolveFolder("junkemail")).toBe("Junk");
    expect(resolveFolder("outbox")).toBe("Outbox");
  });

  it("is case-insensitive", () => {
    expect(resolveFolder("INBOX")).toBe("INBOX");
    expect(resolveFolder("Inbox")).toBe("INBOX");
  });

  it("passes through unknown names", () => {
    expect(resolveFolder("CustomFolder")).toBe("CustomFolder");
  });
});

// ---------- clampLimit ----------

describe("clampLimit", () => {
  it("returns default when undefined or zero", () => {
    expect(clampLimit(undefined, 25, 100)).toBe(25);
    expect(clampLimit(0, 25, 100)).toBe(25);
  });

  it("returns value when within range", () => {
    expect(clampLimit(50, 25, 100)).toBe(50);
  });

  it("clamps at max", () => {
    expect(clampLimit(200, 25, 100)).toBe(100);
  });
});

// ---------- body structure ----------

describe("findAttachments", () => {
  it("finds attachment-disposition parts", () => {
    const node: BodyNode = {
      type: "multipart/mixed",
      childNodes: [
        { type: "text/plain", part: "1" },
        {
          type: "application/pdf",
          part: "2",
          disposition: "attachment",
          dispositionParameters: { filename: "report.pdf" },
          size: 1024,
        },
      ],
    };
    const attachments = findAttachments(node);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.name).toBe("report.pdf");
    expect(attachments[0]!.part).toBe("2");
    expect(attachments[0]!.contentType).toBe("application/pdf");
    expect(attachments[0]!.size).toBe(1024);
  });

  it("finds inline image parts (non-text, non-multipart, no disposition)", () => {
    const node: BodyNode = {
      type: "multipart/related",
      childNodes: [
        { type: "text/html", part: "1" },
        { type: "image/png", part: "2", parameters: { name: "logo.png" } },
      ],
    };
    const attachments = findAttachments(node);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.name).toBe("logo.png");
  });

  it("does not classify text/* as attachment even without disposition", () => {
    const node: BodyNode = {
      type: "multipart/alternative",
      childNodes: [
        { type: "text/plain", part: "1" },
        { type: "text/html", part: "2" },
      ],
    };
    expect(findAttachments(node)).toHaveLength(0);
  });

  it("returns empty array for text-only messages", () => {
    const node: BodyNode = { type: "text/plain", part: "1" };
    expect(findAttachments(node)).toHaveLength(0);
  });
});

describe("findPartByType", () => {
  it("finds text/plain part", () => {
    const node: BodyNode = {
      type: "multipart/alternative",
      childNodes: [
        { type: "text/plain", part: "1" },
        { type: "text/html", part: "2" },
      ],
    };
    expect(findPartByType(node, "text/plain")).toBe("1");
    expect(findPartByType(node, "text/html")).toBe("2");
  });

  it("returns root for single-part match", () => {
    const node: BodyNode = { type: "text/plain" };
    expect(findPartByType(node, "text/plain")).toBe("1");
  });

  it("returns undefined when not found", () => {
    const node: BodyNode = { type: "text/plain" };
    expect(findPartByType(node, "text/html")).toBeUndefined();
  });

  it("searches recursively", () => {
    const node: BodyNode = {
      type: "multipart/mixed",
      childNodes: [
        {
          type: "multipart/alternative",
          childNodes: [
            { type: "text/plain", part: "1" },
            { type: "text/html", part: "2" },
          ],
        },
        { type: "application/pdf", part: "3", disposition: "attachment" },
      ],
    };
    expect(findPartByType(node, "text/html")).toBe("2");
  });
});

// ---------- envelope mapping ----------

describe("mapEnvelopeAddr", () => {
  it("maps with name and address", () => {
    const result = mapEnvelopeAddr({ name: "Alice", address: "alice@example.com" });
    expect(result).toEqual({ name: "Alice", address: "alice@example.com" });
  });

  it("maps with only address", () => {
    const result = mapEnvelopeAddr({ address: "bob@example.com" });
    expect(result).toEqual({ name: undefined, address: "bob@example.com" });
  });

  it("defaults address to empty string", () => {
    const result = mapEnvelopeAddr({ name: "No Email" });
    expect(result).toEqual({ name: "No Email", address: "" });
  });
});

describe("mapSummary", () => {
  it("maps a full envelope to EmailSummary", () => {
    const env: ImapEnvelope = {
      subject: "Hello",
      date: new Date("2025-01-15T10:00:00Z"),
      from: [{ name: "Sender", address: "sender@test.com" }],
      to: [{ name: "Recipient", address: "rec@test.com" }],
    };
    const flags = new Set(["\\Seen"]);
    const summary = mapSummary(42, "INBOX", env, flags);

    expect(summary.id).toBe("INBOX/42");
    expect(summary.subject).toBe("Hello");
    expect(summary.from).toEqual({ name: "Sender", address: "sender@test.com" });
    expect(summary.to).toEqual([{ name: "Recipient", address: "rec@test.com" }]);
    expect(summary.isRead).toBe(true);
    expect(summary.folder).toBe("INBOX");
  });

  it("defaults isRead to false when \\Seen flag is absent", () => {
    const env: ImapEnvelope = { subject: "Test" };
    const summary = mapSummary(1, "Sent", env, new Set());
    expect(summary.isRead).toBe(false);
  });

  it("handles missing from", () => {
    const env: ImapEnvelope = { subject: "No From" };
    const summary = mapSummary(5, "INBOX", env);
    expect(summary.from).toBeUndefined();
  });

  it("handles empty to array", () => {
    const env: ImapEnvelope = { subject: "No To" };
    const summary = mapSummary(3, "INBOX", env);
    expect(summary.to).toEqual([]);
  });
});

// ---------- token validation ----------

describe("isImapTokens", () => {
  const validTokens: ImapTokens = {
    host: "imap.example.com",
    port: 993,
    secure: true,
    user: "user@example.com",
    password: "secret",
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    smtpSecure: false,
  };

  it("returns true for valid tokens", () => {
    expect(isImapTokens(validTokens)).toBe(true);
  });

  it("returns false for non-objects", () => {
    expect(isImapTokens(null)).toBe(false);
    expect(isImapTokens(undefined)).toBe(false);
    expect(isImapTokens("string")).toBe(false);
  });

  it("returns false when required fields are missing", () => {
    expect(isImapTokens({ host: "h", port: 993, user: "u", password: "p", smtpHost: "s", smtpPort: 587 })).toBe(true); // secure/smtpSecure optional
    expect(isImapTokens({ host: "h", port: 993, secure: true, password: "p", smtpHost: "s", smtpPort: 587 })).toBe(false); // missing user
    expect(isImapTokens({ host: "h", port: 993, secure: true, user: "u", password: "p", smtpPort: 587 })).toBe(false); // missing smtpHost
    expect(isImapTokens({ port: 993, secure: true, user: "u", password: "p", smtpHost: "s", smtpPort: 587 })).toBe(false); // missing host
  });
});

describe("extractTokens", () => {
  it("extracts valid tokens from account", () => {
    const account: AccountRecord = {
      email: "user@example.com",
      provider: "imap",
      tokens: {
        host: "imap.example.com",
        port: 993,
        secure: true,
        user: "user@example.com",
        password: "secret",
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpSecure: false,
      },
      addedAt: "2025-01-01T00:00:00Z",
    };
    const tokens = extractTokens(account);
    expect(tokens.host).toBe("imap.example.com");
    expect(tokens.port).toBe(993);
  });

  it("throws on invalid tokens", () => {
    const account: AccountRecord = {
      email: "user@example.com",
      provider: "imap",
      tokens: { invalid: true },
      addedAt: "2025-01-01T00:00:00Z",
    };
    expect(() => extractTokens(account)).toThrow("missing or corrupted");
  });
});
