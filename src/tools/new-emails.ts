import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ResolvedTools } from "../config.js";
import type { EmailProvider, EmailFull, EmailSummary } from "../providers/types.js";
import type { Registry } from "../providers/registry.js";
import type { AccountRecord, AccountStore, NewEmailClaimCandidate } from "../store/account-store.js";
import { selectBody } from "../html-to-markdown.js";
import {
  attachmentMetaOutputSchema,
  emailAddrOutputSchema,
  errMsg,
  fail,
  ok,
  shouldRegister,
} from "./shared.js";

const DEFAULT_LIMIT = 10;
const BODY_LIMIT = 20_000;
const PAGE_SIZE = 100;
const MISSING_RECEIVED_AT = "1970-01-01T00:00:00.000Z";

type NewEmailCheckpoint = NonNullable<AccountRecord["newEmailCheckpoint"]>;

interface Candidate {
  account: AccountRecord;
  summary: EmailSummary;
  timestamp: string;
}

interface AccountCandidates {
  account: AccountRecord;
  candidates: Candidate[];
}

interface NewEmailOutput {
  account: string;
  id: string;
  subject: string;
  from?: EmailFull["from"];
  to?: EmailFull["to"];
  cc?: EmailFull["cc"];
  bcc?: EmailFull["bcc"];
  receivedAt?: string;
  preview?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  folder?: string;
  attachments?: EmailFull["attachments"];
  body: string;
  bodyFormat: "markdown";
  bodyTruncated: boolean;
  bodyOriginalLength: number;
}

export function registerNewEmailTool(
  server: McpServer,
  ctx: { store: AccountStore; registry: Registry; tools: ResolvedTools },
): void {
  const { store, registry, tools } = ctx;
  if (!shouldRegister("get_new_emails", tools)) return;

  const newEmailOutputSchema = z.object({
    account: z.string(),
    id: z.string(),
    subject: z.string(),
    from: emailAddrOutputSchema.optional(),
    to: z.array(emailAddrOutputSchema).optional(),
    cc: z.array(emailAddrOutputSchema).optional(),
    bcc: z.array(emailAddrOutputSchema).optional(),
    receivedAt: z.string().optional(),
    preview: z.string().optional(),
    isRead: z.boolean().optional(),
    hasAttachments: z.boolean().optional(),
    folder: z.string().optional(),
    attachments: z.array(attachmentMetaOutputSchema).optional(),
    body: z.string(),
    bodyFormat: z.literal("markdown"),
    bodyTruncated: z.boolean(),
    bodyOriginalLength: z.number(),
  });

  const outputSchema = z.object({
    count: z.number(),
    emails: z.array(newEmailOutputSchema),
    errors: z.array(z.object({ account: z.string(), message: z.string() })),
  });

  server.registerTool(
    "get_new_emails",
    {
      description:
        "Fetch a bounded batch of inbox emails not previously returned by this tool. " +
        "Agents should call this on their own schedule. Bodies are returned as markdown and may be truncated.",
      inputSchema: z.object({
        account: z
          .string()
          .email()
          .optional()
          .describe(
            "Email account to poll. If omitted, polls all accounts with one global limit.",
          ),
        limit: z
          .number()
          .int()
          .min(0)
          .default(DEFAULT_LIMIT)
          .optional()
          .describe(
            "Maximum emails to return. Defaults to 10. Use 0 to initialize/check without fetching bodies.",
          ),
      }),
      outputSchema,
    },
    async (args) => {
      const limit = args.limit ?? DEFAULT_LIMIT;

      if (args.account) {
        try {
          const { provider, account } = registry.resolveByEmail(args.account);
          const result = await collectCandidatesForAccount(store, provider, account);
          const selected = oldestCandidatesFirst(result.candidates).slice(0, limit);
          const emails = limit === 0
            ? []
            : await hydrateAndAdvance(store, provider, result.account, selected);
          const data = { count: emails.length, emails, errors: [] };
          return ok(data, data);
        } catch (err) {
          return fail(errMsg(err));
        }
      }

      const accounts = store.listAccounts();
      if (accounts.length === 0) {
        return fail("no accounts registered. Call add_account first.");
      }

      const errors: Array<{ account: string; message: string }> = [];
      const collected: Candidate[] = [];
      const providersByEmail = new Map<string, EmailProvider>();
      const accountsByEmail = new Map<string, AccountRecord>();

      for (const stored of accounts) {
        try {
          const { provider, account } = registry.resolveByEmail(stored.email);
          const result = await collectCandidatesForAccount(store, provider, account);
          providersByEmail.set(result.account.email, provider);
          accountsByEmail.set(result.account.email, result.account);
          collected.push(...result.candidates);
        } catch (err) {
          errors.push({ account: stored.email, message: errMsg(err) });
        }
      }

      const selected = oldestCandidatesFirst(collected).slice(0, limit);
      const emails: NewEmailOutput[] = [];

      if (limit > 0) {
        const byAccount = new Map<string, Candidate[]>();
        for (const candidate of selected) {
          const items = byAccount.get(candidate.account.email) ?? [];
          items.push(candidate);
          byAccount.set(candidate.account.email, items);
        }

        for (const [email, accountCandidates] of byAccount) {
          const provider = providersByEmail.get(email);
          const account = accountsByEmail.get(email);
          if (!provider || !account) continue;
          try {
            emails.push(
              ...(await hydrateAndAdvance(
                store,
                provider,
                account,
                accountCandidates,
              )),
            );
          } catch (err) {
            errors.push({ account: email, message: errMsg(err) });
          }
        }
      }

      const orderedEmails = emails.sort(compareNewEmailOutputOldestFirst);
      const data = { count: orderedEmails.length, emails: orderedEmails, errors };
      return ok(data, data);
    },
  );
}

async function collectCandidatesForAccount(
  store: AccountStore,
  provider: EmailProvider,
  account: AccountRecord,
): Promise<AccountCandidates> {
  const checkpoint = normalizeCheckpoint(account.newEmailCheckpoint);
  if (!checkpoint) {
    await initializeCheckpoint(store, provider, account);
    return { account, candidates: [] };
  }

  const deliveredAtCheckpoint = new Set(checkpoint.deliveredIdsAtReceivedAt ?? []);
  const candidates: Candidate[] = [];
  let skip = 0;

  while (true) {
    const { items, hasMore } = await provider.listEmails(account, {
      folder: "inbox",
      limit: PAGE_SIZE,
      skip,
    });

    if (items.length === 0) break;

    let sawOlderThanCheckpoint = false;
    for (const item of items) {
      const timestamp = effectiveReceivedAt(item.receivedAt);
      const comparison = compareTimestamp(timestamp, checkpoint.receivedAt);

      if (comparison > 0) {
        candidates.push({ account, summary: item, timestamp });
      } else if (comparison === 0) {
        if (!deliveredAtCheckpoint.has(item.id)) {
          candidates.push({ account, summary: item, timestamp });
        }
      } else {
        sawOlderThanCheckpoint = true;
      }
    }

    if (sawOlderThanCheckpoint || !hasMore) break;
    skip += items.length;
  }

  return { account, candidates };
}

async function initializeCheckpoint(
  store: AccountStore,
  provider: EmailProvider,
  account: AccountRecord,
): Promise<void> {
  const { items } = await provider.listEmails(account, {
    folder: "inbox",
    limit: PAGE_SIZE,
  });

  const first = items[0];
  const receivedAt = first
    ? effectiveReceivedAt(first.receivedAt)
    : new Date().toISOString();
  const deliveredIdsAtReceivedAt = items
    .filter((item) => effectiveReceivedAt(item.receivedAt) === receivedAt)
    .map((item) => item.id);

  await store.updateNewEmailCheckpoint(account.email, {
    receivedAt,
    deliveredIdsAtReceivedAt,
  });
}

async function hydrateAndAdvance(
  store: AccountStore,
  provider: EmailProvider,
  account: AccountRecord,
  selected: Candidate[],
): Promise<NewEmailOutput[]> {
  if (selected.length === 0) return [];

  const hydrated: Array<{
    candidate: Candidate;
    email: NewEmailOutput;
    fullId: string;
  }> = [];

  for (const candidate of selected) {
    const full = await provider.readEmail(account, candidate.summary.id);
    hydrated.push({
      candidate,
      email: formatNewEmail(account.email, full, candidate.summary),
      fullId: full.id,
    });
  }

  const claims: NewEmailClaimCandidate[] = hydrated.map(({ candidate, fullId }) => ({
    summaryId: candidate.summary.id,
    receivedAt: candidate.timestamp,
    ids: [candidate.summary.id, fullId],
  }));
  const claimed = new Set(await store.claimNewEmails(account.email, claims));

  return hydrated
    .filter(({ candidate }) => claimed.has(candidate.summary.id))
    .map(({ email }) => email);
}

function formatNewEmail(
  account: string,
  msg: EmailFull,
  summary: EmailSummary,
): NewEmailOutput {
  const body = selectBody(msg, "markdown");
  const bodyTruncated = body.length > BODY_LIMIT;
  return {
    account,
    id: msg.id,
    subject: msg.subject,
    from: msg.from,
    to: msg.to,
    cc: msg.cc,
    bcc: msg.bcc,
    receivedAt: msg.receivedAt ?? summary.receivedAt,
    preview: msg.preview,
    isRead: msg.isRead,
    hasAttachments: msg.hasAttachments,
    folder: msg.folder,
    attachments: msg.attachments,
    body: bodyTruncated ? body.slice(0, BODY_LIMIT) : body,
    bodyFormat: "markdown",
    bodyTruncated,
    bodyOriginalLength: body.length,
  };
}

function normalizeCheckpoint(
  checkpoint: AccountRecord["newEmailCheckpoint"],
): NewEmailCheckpoint | null {
  const receivedAt = normalizeTimestamp(checkpoint?.receivedAt);
  if (!receivedAt) return null;
  return {
    receivedAt,
    deliveredIdsAtReceivedAt: checkpoint?.deliveredIdsAtReceivedAt ?? [],
  };
}

function effectiveReceivedAt(receivedAt: string | undefined): string {
  return normalizeTimestamp(receivedAt) ?? MISSING_RECEIVED_AT;
}

function normalizeTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function oldestCandidatesFirst(items: Candidate[]): Candidate[] {
  return [...items].sort((a, b) => {
    const byTimestamp = compareTimestamp(a.timestamp, b.timestamp);
    if (byTimestamp !== 0) return byTimestamp;
    return a.summary.id.localeCompare(b.summary.id);
  });
}

function compareNewEmailOutputOldestFirst(
  a: NewEmailOutput,
  b: NewEmailOutput,
): number {
  const byTimestamp = compareTimestamp(
    effectiveReceivedAt(a.receivedAt),
    effectiveReceivedAt(b.receivedAt),
  );
  if (byTimestamp !== 0) return byTimestamp;
  return a.id.localeCompare(b.id);
}

function compareTimestamp(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
