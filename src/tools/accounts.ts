import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { promises as fs } from "node:fs";
import { z } from "zod";

import type { AccountRecord } from "../store/account-store.js";
import type { IAccountStore, IAgentStore } from "../mode/types.js";
import type { Registry } from "../providers/registry.js";
import type { ProviderId } from "../providers/types.js";
import type { ResolvedTools } from "../config.js";
import type { AgentContext } from "./agent-context.js";
import {
  checkAccountAccess,
  checkProvisioning,
} from "./agent-context.js";
import {
  ok,
  fail,
  errMsg,
  providerIdEnum,
  accountSummaryOutputSchema,
  accountFullOutputSchema,
  styleOutputSchema,
  shouldRegister,
} from "./shared.js";

export function registerAccountTools(
  server: McpServer,
  ctx: {
    store: IAccountStore;
    agentStore?: IAgentStore | null;
    registry: Registry;
    tools: ResolvedTools;
    agentContext?: AgentContext | null;
  },
): void {
  const { store, registry, tools, agentContext, agentStore } = ctx;

  // ---------- list_accounts ----------

  const listAccountsOutputSchema = z.object({
    accounts: z.array(accountSummaryOutputSchema),
  });

  if (shouldRegister("list_accounts", tools)) {
    server.registerTool(
      "list_accounts",
      {
        description:
          "List all email accounts known to this server (no secrets). " +
          "Use the returned `email` value as the `account` argument to other tools.",
        inputSchema: z.object({}),
        outputSchema: listAccountsOutputSchema,
      },
      async () => {
        const rows = (await store.listAccounts()).map((a) => ({
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

  const addAccountOutputSchema = z.object({
      status: z.enum(["pending", "ready"]),
      handle: z.string().optional(),
      verification: z
        .object({
          userCode: z.string(),
          verificationUri: z.string(),
          expiresAt: z.string(),
          message: z.string(),
        })
        .optional(),
      account: accountFullOutputSchema.optional(),
    });

  if (shouldRegister("add_account", tools)) {
    server.registerTool(
      "add_account",
      {
        description:
          "Start adding an email account. For Outlook this returns a device code " +
          "the user must enter at the verification URL; then call `complete_add_account` " +
          "with the returned `handle` to finalize. Disabled in --read-only mode.",
        inputSchema: z.object({
          provider: providerIdEnum.describe("Email backend. 'outlook' (Microsoft Graph) and 'imap' are fully implemented."),
          email: z
            .string()
            .email()
            .optional()
            .describe(
              "Optional hint — the provider will verify it against the auth result.",
            ),
          config: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              "Provider-specific config (e.g. IMAP host/port). Unused for Outlook.",
            ),
        }),
        outputSchema: addAccountOutputSchema,
      },
      async (args) => {
        const permErr = checkProvisioning(agentContext ?? null);
        if (permErr) return fail(permErr);
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
    account: accountFullOutputSchema.optional(),
    error: z.string().optional(),
  });

  if (shouldRegister("complete_add_account", tools)) {
    server.registerTool(
      "complete_add_account",
      {
        description:
          "Poll/finalize a pending add_account flow. Returns `pending` until the user " +
          "completes the device-code step, then `ready` with the persisted account.",
        inputSchema: z.object({
          provider: providerIdEnum,
          handle: z.string().min(1),
        }),
        outputSchema: completeAddAccountOutputSchema,
      },
      async (args) => {
        const permErr = checkProvisioning(agentContext ?? null);
        if (permErr) return fail(permErr);
        const provider = registry.get(args.provider as ProviderId);
        if (!provider.completeAddAccount) {
          return fail(
            `provider ${args.provider} has no async add-account flow`,
          );
        }
        try {
          const res = await provider.completeAddAccount(args.handle);
          // Auto-assign the newly provisioned account to the calling agent.
          if (res.status === "ready" && res.account && agentContext && agentStore) {
            agentStore
              .assignAccount(agentContext.agentId, res.account.email)
              .catch(() => {
                /* best-effort — account is provisioned either way */
              });
          }
          return ok(res, res as unknown as Record<string, unknown>);
        } catch (err) {
          return fail(errMsg(err));
        }
      },
    );
  }

  // ---------- account settings ----------

  const accountSettingsOutputSchema = z.object({
    signature: z.string().nullable(),
    style: styleOutputSchema.nullable(),
  });

  if (shouldRegister("get_account_settings", tools)) {
    server.registerTool(
      "get_account_settings",
      {
        description:
          "Get signature (HTML) and style preferences for an account.",
        inputSchema: z.object({ account: z.string().email() }),
        outputSchema: accountSettingsOutputSchema,
      },
      async (args) => {
        try {
          const accessErr = checkAccountAccess(agentContext ?? null, args.account);
          if (accessErr) return fail(accessErr);
          const acct = await store.getAccount(args.account);
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
          "Use `signaturePath` to load a signature from a file (useful for signatures with base64 images). " +
          "`signature` and `signaturePath` are mutually exclusive. " +
          "Disabled in --read-only mode.",
        inputSchema: z
          .object({
            account: z.string().email(),
            signature: z
              .string()
              .optional()
              .describe(
                "HTML snippet — may contain formatting, images, links. " +
                  "Pass an empty string to clear. " +
                  "Mutually exclusive with `signaturePath`.",
              ),
            signaturePath: z
              .string()
              .optional()
              .describe(
                "Path to a file containing the signature HTML. " +
                  "The file content is read and stored as the signature. " +
                  "Useful when the signature contains large base64 images. " +
                  "Mutually exclusive with `signature`.",
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
          })
          .refine(
            (data) => !(data.signature !== undefined && data.signaturePath),
            {
              message:
                "signature and signaturePath are mutually exclusive — use one or the other",
            },
          ),
        outputSchema: accountSettingsOutputSchema,
      },
      async (args) => {
        try {
          const accessErr = checkAccountAccess(agentContext ?? null, args.account);
          if (accessErr) return fail(accessErr);
          const acct = await store.getAccount(args.account);
          if (!acct)
            return fail(`no account registered for "${args.account}"`);
          let resolvedSignature: string | undefined = acct.signature;
          if (args.signaturePath) {
            resolvedSignature = await fs.readFile(args.signaturePath, "utf-8");
          } else if (args.signature !== undefined) {
            resolvedSignature = args.signature || undefined;
          }
          const updated = await store.upsertAccount({
            ...acct,
            signature: resolvedSignature,
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

  const removeAccountOutputSchema = z.object({
    removed: z.boolean(),
    email: z.string(),
  });

  if (shouldRegister("remove_account", tools)) {
    server.registerTool(
      "remove_account",
      {
        description:
          "Forget an account and delete its stored tokens. Disabled in --read-only mode.",
        inputSchema: z.object({ email: z.string().email() }),
        outputSchema: removeAccountOutputSchema,
      },
      async (args) => {
        const permErr = checkProvisioning(agentContext ?? null);
        if (permErr) return fail(permErr);
        const removed = await store.removeAccount(args.email);
        const data = { removed, email: args.email };
        return ok(data, data);
      },
    );
  }
}
