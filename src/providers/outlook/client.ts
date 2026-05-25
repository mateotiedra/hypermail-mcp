import "isomorphic-fetch";
import {
  Client,
  type AuthenticationProvider,
} from "@microsoft/microsoft-graph-client";

import type { AccountStore, AccountRecord } from "../../store/account-store.js";
import { acquireAccessToken, type SerializedTokens } from "./auth.js";

/**
 * Builds a Graph `Client` bound to a stored account. The client uses an
 * `AuthenticationProvider` that calls msal silently on every request, and
 * writes the (possibly-refreshed) cache back into the AccountStore.
 *
 * Clients are cached per email since the underlying SDK reuses connections.
 */
export class OutlookClientFactory {
  private readonly cache = new Map<string, Client>();

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
    const provider: AuthenticationProvider = {
      getAccessToken: async () => {
        const fresh = store.getAccount(account.email) ?? account;
        const tokens = fresh.tokens as unknown as SerializedTokens;
        const { accessToken, tokens: nextTokens } = await acquireAccessToken(
          tokens,
          undefined,
          this.clientId,
          this.tenantId,
        );
        // Persist refreshed cache opportunistically; failures here shouldn't
        // break the in-flight Graph call.
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
