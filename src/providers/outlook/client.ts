import "isomorphic-fetch";
import {
  Client,
  type AuthenticationProvider,
} from "@microsoft/microsoft-graph-client";

import type { AccountStore, AccountRecord } from "../../store/account-store.js";
import { acquireAccessToken, isSerializedTokens, type SerializedTokens } from "./auth.js";

/**
 * Builds a Graph `Client` bound to a stored account. The client uses an
 * `AuthenticationProvider` that calls msal silently on every request, and
 * writes the (possibly-refreshed) cache back into the AccountStore.
 *
 * Clients are cached per email since the underlying SDK reuses connections.
 */
export class OutlookClientFactory {
  private readonly cache = new Map<string, Client>();
  /** Serialize token refreshes per email to prevent concurrent-refresh races. */
  private readonly refreshLocks = new Map<string, Promise<string>>();

  constructor(
    private readonly store: AccountStore,
    private readonly clientId?: string,
    private readonly tenantId?: string,
  ) {}

  get(account: AccountRecord): Client {
    const key = account.email.toLowerCase();
    const existing = this.cache.get(key);
    if (existing) return existing;

    const store = this.store;
    const refreshLocks = this.refreshLocks;
    const provider: AuthenticationProvider = {
      getAccessToken: async () => {
        const existing = refreshLocks.get(key);
        if (existing) {
          try {
            return await existing;
          } catch {
            // previous refresh failed — fall through to retry
          }
        }
        const promise = (async (): Promise<string> => {
          const fresh = store.getAccount(account.email) ?? account;
          if (!isSerializedTokens(fresh.tokens)) {
            throw new Error(
              "Outlook account tokens are missing or corrupted — re-run add_account",
            );
          }
          const tokens: SerializedTokens = fresh.tokens;
          const { accessToken, tokens: nextTokens } = await acquireAccessToken(
            tokens,
            undefined,
            this.clientId,
            this.tenantId,
          );
          if (nextTokens.msalCache !== tokens.msalCache) {
            store
              .upsertAccount({
                ...fresh,
                tokens: nextTokens as unknown as Record<string, unknown>,
              })
              .catch(() => {
                /* swallow — next call will refresh again */
              });
          }
          return accessToken;
        })();
        refreshLocks.set(key, promise);
        try {
          return await promise;
        } finally {
          refreshLocks.delete(key);
        }
      },
    };

    const client = Client.initWithMiddleware({ authProvider: provider });
    this.cache.set(key, client);
    return client;
  }

  /** Drop a cached client (e.g. after removeAccount). */
  invalidate(email: string): void {
    this.cache.delete(email.toLowerCase());
  }
}
