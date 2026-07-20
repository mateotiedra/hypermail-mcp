import { describe, expect, it, vi } from "vitest";

import { registerBrowseTools } from "./browse.js";
import type { ResolvedTools } from "../config.js";
import type { EmailProvider, EmailSummary } from "../providers/types.js";
import type { Registry } from "../providers/registry.js";
import type { AccountRecord, AccountStore } from "../store/account-store.js";

const tools: ResolvedTools = {
  enabledTools: new Set(["search_emails"]),
  disabledTools: null,
};

interface SearchArgs {
  account?: string;
  query?: string;
  from?: string;
  to?: string;
  cc?: string;
  limit?: number;
}

type Handler = (args: SearchArgs) => Promise<unknown>;
type InputSchema = { parse(input: unknown): SearchArgs };

function account(email: string): AccountRecord {
  return {
    email,
    provider: "imap",
    tokens: {},
    addedAt: "2026-01-01T00:00:00.000Z",
  };
}

function summary(id: string, subject = id): EmailSummary {
  return { id, subject };
}

function store(accounts: AccountRecord[]): AccountStore {
  return {
    listAccounts: vi.fn(() => accounts),
  } as unknown as AccountStore;
}

function provider(items: EmailSummary[] = []): EmailProvider {
  return {
    id: "imap",
    searchEmails: vi.fn(async () => items),
  } as unknown as EmailProvider;
}

function registry(accounts: AccountRecord[], providers: Record<string, EmailProvider>): Registry {
  const byEmail = new Map(accounts.map((rec) => [rec.email, rec]));
  return {
    resolveByEmail: vi.fn((email: string) => {
      const rec = byEmail.get(email);
      if (!rec) throw new Error(`no account registered for "${email}"`);
      return { account: rec, provider: providers[rec.email] };
    }),
  } as unknown as Registry;
}

function registerHandler(store: AccountStore, reg: Registry): Handler {
  let handler: Handler | undefined;
  let inputSchema: InputSchema | undefined;
  const server = {
    registerTool: vi.fn((name: string, config: { inputSchema: InputSchema }, cb: Handler) => {
      if (name === "search_emails") {
        handler = cb;
        inputSchema = config.inputSchema;
      }
    }),
  };

  registerBrowseTools(server as never, { store, registry: reg, tools });
  if (!handler || !inputSchema) throw new Error("search_emails was not registered");
  const registeredHandler = handler;
  const registeredSchema = inputSchema;
  return (args) => registeredHandler(registeredSchema.parse(args));
}

function structured(result: unknown): Record<string, unknown> {
  return (result as { structuredContent: Record<string, unknown> }).structuredContent;
}

describe("search_emails", () => {
  it("routes an explicit account to one provider and annotates returned items", async () => {
    const a = account("a@example.com");
    const b = account("b@example.com");
    const providerA = provider([summary("a1", "hello")]);
    const providerB = provider([summary("b1", "hello")]);
    const reg = registry([a, b], {
      [a.email]: providerA,
      [b.email]: providerB,
    });
    const handler = registerHandler(store([a, b]), reg);

    const data = structured(await handler({ account: a.email, query: "hello", limit: 5 }));

    expect(reg.resolveByEmail).toHaveBeenCalledTimes(1);
    expect(reg.resolveByEmail).toHaveBeenCalledWith(a.email);
    expect(providerA.searchEmails).toHaveBeenCalledWith(a, {
      query: "hello",
      limit: 5,
    });
    expect(providerB.searchEmails).not.toHaveBeenCalled();
    expect(data).toEqual({
      account: a.email,
      count: 1,
      items: [{ id: "a1", subject: "hello", account: a.email }],
      errors: [],
    });
  });

  it("supports structured-only filters and trims their values", async () => {
    const a = account("a@example.com");
    const providerA = provider();
    const handler = registerHandler(store([a]), registry([a], {
      [a.email]: providerA,
    }));

    await handler({ account: a.email, from: " Alain ", to: " user@example.com ", cc: " Copy " });

    expect(providerA.searchEmails).toHaveBeenCalledWith(a, {
      from: "Alain",
      to: "user@example.com",
      cc: "Copy",
    });
  });

  it("combines free text and structured filters in one options object", async () => {
    const a = account("a@example.com");
    const providerA = provider();
    const handler = registerHandler(store([a]), registry([a], {
      [a.email]: providerA,
    }));

    await handler({ account: a.email, query: "invoice", from: "sender@example.com" });

    expect(providerA.searchEmails).toHaveBeenCalledWith(a, {
      query: "invoice",
      from: "sender@example.com",
    });
  });

  it("rejects calls without a non-empty search criterion", () => {
    const handler = registerHandler(store([]), registry([], {}));

    expect(() => handler({})).toThrow("at least one of query, from, to, or cc is required");
    expect(() => handler({ query: "   " })).toThrow();
  });

  it("searches all accounts in parallel when account is omitted", async () => {
    const a = account("a@example.com");
    const b = account("b@example.com");
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const providerA = provider();
    const providerB = provider();
    vi.mocked(providerA.searchEmails).mockImplementation(async () => {
      started.push(a.email);
      await gate;
      return [summary("a1")];
    });
    vi.mocked(providerB.searchEmails).mockImplementation(async () => {
      started.push(b.email);
      await gate;
      return [summary("b1")];
    });
    const handler = registerHandler(store([a, b]), registry([a, b], {
      [a.email]: providerA,
      [b.email]: providerB,
    }));

    const result = handler({ query: "invoice", limit: 10 });
    await Promise.resolve();

    expect(started).toEqual([a.email, b.email]);
    release();
    const data = structured(await result);

    expect(providerA.searchEmails).toHaveBeenCalledWith(a, {
      query: "invoice",
      limit: 10,
    });
    expect(providerB.searchEmails).toHaveBeenCalledWith(b, {
      query: "invoice",
      limit: 10,
    });
    expect(data).toEqual({
      account: "all",
      accounts: [a.email, b.email],
      count: 2,
      items: [
        { id: "a1", subject: "a1", account: a.email },
        { id: "b1", subject: "b1", account: b.email },
      ],
      errors: [],
    });
  });

  it("reports per-account errors without discarding successful results", async () => {
    const a = account("a@example.com");
    const b = account("b@example.com");
    const providerA = provider([summary("a1")]);
    const providerB = provider();
    vi.mocked(providerB.searchEmails).mockRejectedValue(new Error("search failed"));
    const handler = registerHandler(store([a, b]), registry([a, b], {
      [a.email]: providerA,
      [b.email]: providerB,
    }));

    const data = structured(await handler({ query: "invoice" }));

    expect(data).toEqual({
      account: "all",
      accounts: [a.email, b.email],
      count: 1,
      items: [{ id: "a1", subject: "a1", account: a.email }],
      errors: [{ account: b.email, message: "search failed" }],
    });
  });

  it("fails clearly when all-account search has no registered accounts", async () => {
    const handler = registerHandler(store([]), registry([], {}));

    const result = await handler({ query: "invoice" });

    expect(result).toMatchObject({
      isError: true,
      content: [
        { type: "text", text: "no accounts registered. Call add_account first." },
      ],
    });
  });
});
