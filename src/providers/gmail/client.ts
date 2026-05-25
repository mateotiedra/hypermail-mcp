import { gmail_v1, google } from "googleapis";

import type { AccountStore, AccountRecord } from "../../store/account-store.js";
import {
  acquireAccessToken,
  buildOAuth2Client,
  isSerializedGmailTokens,
  type SerializedGmailTokens,
} from "./auth.js";

/**
 * Cached per-account entry: an OAuth2Client + a Gmail API instance.
 * The OAuth2Client handles token refresh automatically; we listen for token
 * events to persist refreshed credentials back to the AccountStore.
 */
interface GmailClientEntry {
  auth: ReturnType<typeof buildOAuth2Client>;
  gmail: gmail_v1.Gmail;
}

/**
 * Builds a Google `gmail_v1.Gmail` client bound to a stored account.
 * The client auto-refreshes access tokens via `google-auth-library` and
 * persists refreshed tokens back into the AccountStore.
 *
 * Clients are cached per email since the underlying library reuses connections.
 */
export class GmailClientFactory {
  private readonly cache = new Map<string, GmailClientEntry>();

  constructor(
    private readonly store: AccountStore,
    private readonly clientId?: string,
    private readonly clientSecret?: string,
  ) {}

  get(account: AccountRecord): GmailClientEntry {
    const key = account.email.toLowerCase();
    const existing = this.cache.get(key);
    if (existing) return existing;

    if (!isSerializedGmailTokens(account.tokens)) {
      throw new Error(
        "Gmail account tokens are missing or corrupted — re-run add_account",
      );
    }
    const tokens: SerializedGmailTokens = account.tokens;

    // Use stored clientId/clientSecret, falling back to constructor args
    const resolvedClientId = tokens.clientId || this.clientId;
    const resolvedSecret = tokens.clientSecret || this.clientSecret;

    const auth = buildOAuth2Client({
      ...tokens,
      clientId: resolvedClientId ?? tokens.clientId,
      clientSecret: resolvedSecret,
    });

    // Listen for token refresh events and persist the new tokens.
    const store = this.store;
    auth.on("tokens", (updated) => {
      if (!updated.refresh_token && !updated.access_token) return;
      const fresh = store.getAccount(account.email) ?? account;
      const currentTokens = isSerializedGmailTokens(fresh.tokens)
        ? (fresh.tokens as unknown as SerializedGmailTokens)
        : tokens;

      const nextTokens: SerializedGmailTokens = {
        ...currentTokens,
        accessToken: updated.access_token ?? currentTokens.accessToken,
        refreshToken:
          updated.refresh_token ?? currentTokens.refreshToken,
        expiryDate:
          updated.expiry_date ?? currentTokens.expiryDate,
        scopes: updated.scope
          ? updated.scope.split(" ")
          : currentTokens.scopes,
      };

      store
        .upsertAccount({
          ...fresh,
          tokens: nextTokens as unknown as Record<string, unknown>,
        })
        .catch(() => {
          /* swallow — next call will refresh again */
        });
    });

    const gmail = google.gmail({ version: "v1", auth });
    const entry: GmailClientEntry = { auth, gmail };
    this.cache.set(key, entry);
    return entry;
  }

  /** Drop a cached client (e.g. after removeAccount). */
  invalidate(email: string): void {
    this.cache.delete(email.toLowerCase());
  }
}
