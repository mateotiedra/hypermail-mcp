import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AccountStore } from "../store/account-store.js";
import type { Registry } from "../providers/registry.js";
import type { ProviderId } from "../providers/types.js";
import type { ResolvedTools } from "../config.js";
import {
  ok,
  fail,
  errMsg,
  accountSummaryOutputSchema,
  styleOutputSchema,
  shouldRegister,
} from "./shared.js";

export function registerAccountTools(
  server: McpServer,
  ctx: {
    store: AccountStore;
    registry: Registry;
    tools: ResolvedTools;
  },
): void {
  const { store, registry, tools } = ctx;

  // ---------- list_accounts ----------

  const listAccountsOutputSchema = {
    accounts: z.array(accountSummaryOutputSchema),
  };

  if (shouldRegister("list_accounts", tools)) {
    server.registerTool(
      "list_accounts",
      {
        description:
          "List all email accounts known to this server (no secrets). " +
          "Use the returned `email` value as the `account` argument to other tools.",
        inputSchema: {},
        outputSchema: listAccountsOutputSchema,
      },
      async () => {
        const rows = store.listAccounts().map((a) => ({
          email: a.email,
          provider: a.provider,
          displayName: a.displayName,
          addedAt: a.addedAt,
          hasSignature: !!a.signature,
          hasStyle: !!(
            a.style &&
            (a.style.fontFamily || a.style.fontSize || a.style.fontColor)
          ),
        }));
        const data = { accounts: rows };
        return ok(data, data);
      },
    );
  }

  // ---------- add_account ----------

  const addAccountOutputSchema = z.discriminatedUnion("status", [
    z.object({
      status: z.literal("pending"),
      handle: z.string(),
      verification: z.object({
        userCode: z.string(),
        verificationUri: z.string(),
        expiresAt: z.string(),
        message: z.string(),
      }),
    }),
    z.object({
      status: z.literal("ready"),
      account: z.object({
        email: z.string(),
        provider: z.enum(["outlook", "imap", "gmail"]),
        displayName: z.string().optional(),
        tokens: z.record(z.unknown()),
        addedAt: z.string(),
        signature: z.string().optional(),
        style: styleOutputSchema.optional(),
      }),
    }),
  ]);

  if (shouldRegister("add_account", tools)) {
    server.registerTool(
      "add_account",
      {
        description:
          "Start adding an email account. For Outlook this returns a device code " +
          "the user must enter at the verification URL; then call `complete_add_account` " +
          "with the returned `handle` to finalize. Disabled in --read-only mode.",
        inputSchema: {
          provider: z
            .enum(["outlook", "imap", "gmail"])
            .describe("Email backend. v1 only fully implements 'outlook'."),
          email: z
            .string()
            .email()
            .optional()
            .describe(
              "Optional hint — the provider will verify it against the auth result.",
            ),
          config: z
            .record(z.unknown())
            .optional()
            .describe(
              "Provider-specific config (e.g. IMAP host/port). Unused for Outlook.",
            ),
        },
        outputSchema: addAccountOutputSchema,
      },
      async (args) => {
        const provider = registry.get(args.provider as ProviderId);
        try {
          const res = await provider.addAccount({
            email: args.email,
            config: args.config,
          });
          return ok(res, res as unknown as Record<string, unknown>);
        } catch (err) {
          return fail(errMsg(err));
        }
      },
    );
  }

  // ---------- complete_add_account ----------

  const completeAddAccountOutputSchema = z.object({
    status: z.enum(["pending", "ready", "expired", "error"]),
    account: z
      .object({
        email: z.string(),
        provider: z.enum(["outlook", "imap", "gmail"]),
        displayName: z.string().optional(),
        tokens: z.record(z.unknown()),
        addedAt: z.string(),
        signature: z.string().optional(),
        style: styleOutputSchema.optional(),
      })
      .optional(),
    error: z.string().optional(),
  });

  if (shouldRegister("complete_add_account", tools)) {
    server.registerTool(
      "complete_add_account",
      {
        description:
          "Poll/finalize a pending add_account flow. Returns `pending` until the user " +
          "completes the device-code step, then `ready` with the persisted account.",
        inputSchema: {
          provider: z.enum(["outlook", "imap", "gmail"]),
          handle: z.string().min(1),
        },
        outputSchema: completeAddAccountOutputSchema,
      },
      async (args) => {
        const provider = registry.get(args.provider as ProviderId);
        if (!provider.completeAddAccount) {
          return fail(
            `provider ${args.provider} has no async add-account flow`,
          );
        }
        try {
          const res = await provider.completeAddAccount(args.handle);
          return ok(res, res as unknown as Record<string, unknown>);
        } catch (err) {
          return fail(errMsg(err));
        }
      },
    );
  }

  // ---------- account settings ----------

  const accountSettingsOutputSchema = {
    signature: z.string().nullable(),
    style: styleOutputSchema.nullable(),
  };

  if (shouldRegister("get_account_settings", tools)) {
    server.registerTool(
      "get_account_settings",
      {
        description:
          "Get signature (HTML) and style preferences for an account.",
        inputSchema: { account: z.string().email() },
        outputSchema: accountSettingsOutputSchema,
      },
      async (args) => {
        try {
          const acct = store.getAccount(args.account);
          if (!acct)
            return fail(`no account registered for "${args.account}"`);
          const data = {
            signature: acct.signature ?? null,
            style: acct.style ?? null,
          };
          return ok(data, data as Record<string, unknown>);
        } catch (err) {
          return fail(errMsg(err));
        }
      },
    );
  }

  if (shouldRegister("set_account_settings", tools)) {
    server.registerTool(
      "set_account_settings",
      {
        description:
          "Set signature (HTML snippet) and/or style preferences for an account. " +
          "Disabled in --read-only mode.",
        inputSchema: {
          account: z.string().email(),
          signature: z
            .string()
            .optional()
            .describe(
              "HTML snippet — may contain formatting, images, links. Pass null to clear.",
            ),
          style: z
            .object({
              fontFamily: z.string().optional(),
              fontSize: z.string().optional(),
              fontColor: z.string().optional(),
            })
            .optional()
            .describe(
              "Font preferences applied to outgoing HTML emails. Pass null to clear.",
            ),
        },
        outputSchema: accountSettingsOutputSchema,
      },
      async (args) => {
        try {
          const acct = store.getAccount(args.account);
          if (!acct)
            return fail(`no account registered for "${args.account}"`);
          const updated = await store.upsertAccount({
            ...acct,
            signature: args.signature ?? acct.signature,
            style: args.style ?? acct.style,
          });
          const data = {
            signature: updated.signature ?? null,
            style: updated.style ?? null,
          };
          return ok(data, data as Record<string, unknown>);
        } catch (err) {
          return fail(errMsg(err));
        }
      },
    );
  }

  // ---------- remove_account ----------

  const removeAccountOutputSchema = {
    removed: z.boolean(),
    email: z.string(),
  };

  if (shouldRegister("remove_account", tools)) {
    server.registerTool(
      "remove_account",
      {
        description:
          "Forget an account and delete its stored tokens. Disabled in --read-only mode.",
        inputSchema: { email: z.string().email() },
        outputSchema: removeAccountOutputSchema,
      },
      async (args) => {
        const removed = await store.removeAccount(args.email);
        const data = { removed, email: args.email };
        return ok(data, data);
      },
    );
  }
}
