import type { AccountStore, AccountRecord } from "../store/account-store.js";
import type { EmailProvider, ProviderId } from "./types.js";
import type { ProvidersConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { OutlookProvider } from "./outlook/index.js";
import { ImapProvider } from "./imap/index.js";
import { GmailProvider } from "./gmail/index.js";

export interface Registry {
  get(id: ProviderId): EmailProvider;
  resolveByEmail(email: string): { provider: EmailProvider; account: AccountRecord };
  list(): EmailProvider[];
}

export interface BuildRegistryOptions {
  store: AccountStore;
  providers?: ProvidersConfig;
  logger?: Logger;
}

export function buildRegistry(opts: BuildRegistryOptions): Registry {
  const outlookCfg = opts.providers?.outlook;
  const providers = new Map<ProviderId, EmailProvider>();
  providers.set("outlook", new OutlookProvider({
    store: opts.store,
    clientId: outlookCfg?.clientId,
    tenantId: outlookCfg?.tenantId,
  }));
  providers.set("imap", new ImapProvider(opts.store, opts.logger));
  const gmailCfg = opts.providers?.gmail;
  providers.set("gmail", new GmailProvider({
    store: opts.store,
    clientId: gmailCfg?.clientId,
    clientSecret: gmailCfg?.clientSecret,
    redirectUri: gmailCfg?.redirectUri,
  }));

  function get(id: ProviderId): EmailProvider {
    const p = providers.get(id);
    if (!p) throw new Error(`unknown provider: ${id}`);
    return p;
  }

  function resolveByEmail(email: string): {
    provider: EmailProvider;
    account: AccountRecord;
  } {
    const account = opts.store.getAccount(email);
    if (!account) {
      throw new Error(
        `no account registered for "${email}". Call add_account first.`,
      );
    }
    return { provider: get(account.provider), account };
  }

  return {
    get,
    resolveByEmail,
    list: () => Array.from(providers.values()),
  };
}
