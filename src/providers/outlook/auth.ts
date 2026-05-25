import {
  PublicClientApplication,
  type Configuration,
  type AuthenticationResult,
  type AccountInfo,
} from "@azure/msal-node";

/**
 * Public client app id. Default is the well-known `ms-365` client id used by
 * the softeria/ms-365-mcp-server project — it's a public client registered
 * for personal MSA + multi-tenant work/school. Users can override via
 * MS_CLIENT_ID for their own Entra app registrations.
 */
const DEFAULT_CLIENT_ID = "084a3e9f-a9f4-43f7-89f9-d229cf97853e";
// ^ Pre-registered public client app (same one used by softeria/ms-365-mcp-server).
//   Supports personal MSA + multi-tenant work/school via device-code flow.
//   Operators should set MS_CLIENT_ID to a client they control for production.

const DEFAULT_SCOPES = [
  "offline_access",
  "User.Read",
  "Mail.ReadWrite",
  "Mail.Send",
];

export interface DeviceCodeBegin {
  userCode: string;
  verificationUri: string;
  message: string;
  expiresAt: string; // ISO
  /** Resolves with the auth result once the user completes the flow. */
  result: Promise<{ tokens: SerializedTokens; account: AccountInfo }>;
  /** Aborts the in-flight polling promise. */
  cancel(): void;
}

export interface SerializedTokens {
  /** MSAL cache JSON, encrypted at rest by the account store. */
  msalCache: string;
  /** Home account id used to look up the account in the rehydrated cache. */
  homeAccountId: string;
  /** Tenant id captured at sign-in. */
  tenantId: string;
  /** Username captured at sign-in (typically the primary email). */
  username: string;
  scopes: string[];
}

function makeConfig(prevCacheJson?: string, clientIdOverride?: string, tenantOverride?: string): Configuration {
  const clientId = clientIdOverride || process.env.MS_CLIENT_ID || DEFAULT_CLIENT_ID;
  const tenant = tenantOverride || process.env.MS_TENANT_ID || "common";
  return {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenant}`,
    },
    cache: prevCacheJson
      ? {
          // msal-node supports an in-memory cache plugin; we hydrate manually
          // below via deserialize after construction.
        }
      : undefined,
  };
}

export function buildPca(prevCacheJson?: string, clientIdOverride?: string, tenantOverride?: string): PublicClientApplication {
  const pca = new PublicClientApplication(makeConfig(prevCacheJson, clientIdOverride, tenantOverride));
  if (prevCacheJson) {
    pca.getTokenCache().deserialize(prevCacheJson);
  }
  return pca;
}

/**
 * Start a device-code flow. The returned `result` promise resolves once the
 * user has entered the code and consented; callers should poll it (or await it)
 * via `complete_add_account`.
 */
export function beginDeviceCode(
  scopes: string[] = DEFAULT_SCOPES,
  clientIdOverride?: string,
  tenantOverride?: string,
): DeviceCodeBegin {
  const pca = buildPca(undefined, clientIdOverride, tenantOverride);
  let resolve!: (v: { tokens: SerializedTokens; account: AccountInfo }) => void;
  let reject!: (err: unknown) => void;
  const result = new Promise<{ tokens: SerializedTokens; account: AccountInfo }>(
    (res, rej) => {
      resolve = res;
      reject = rej;
    },
  );

  // We capture the deviceCodeCallback synchronously to surface the user-facing
  // info back out via this object before awaiting the long-running poll.
  let userCode = "";
  let verificationUri = "";
  let message = "";
  let expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  let aborted = false;

  const ready = new Promise<void>((r) => {
    pca
      .acquireTokenByDeviceCode({
        scopes,
        deviceCodeCallback: (info) => {
          if (!info.userCode || !info.verificationUri) {
            // MSAL may fire the callback with an empty object if the
            // downstream HTTP request fails — reject so the caller
            // gets a clear error instead of silent empty strings.
            reject(
              new Error(
                "Microsoft device-code endpoint returned no code. " +
                  "Check MS_CLIENT_ID is a valid Azure Entra public-client application.",
              ),
            );
            return;
          }
          userCode = info.userCode;
          verificationUri = info.verificationUri;
          message = info.message;
          if (info.expiresIn) {
            expiresAt = new Date(Date.now() + info.expiresIn * 1000).toISOString();
          }
          r();
        },
      })
      .then((authResult: AuthenticationResult | null) => {
        if (aborted) return;
        if (!authResult || !authResult.account) {
          reject(new Error("device-code flow returned no account"));
          return;
        }
        const cache = pca.getTokenCache().serialize();
        const tokens: SerializedTokens = {
          msalCache: cache,
          homeAccountId: authResult.account.homeAccountId,
          tenantId: authResult.account.tenantId,
          username: authResult.account.username,
          scopes,
        };
        resolve({ tokens, account: authResult.account });
      })
      .catch((err) => {
        if (!aborted) reject(err);
      });
  });

  // Surface device-code info synchronously via a wrapper Promise:
  // we return the object but its strings are populated once `ready` settles.
  // To keep the API simple, we attach a getter that callers must `await` on.
  // Instead of getters, we wait for `ready` inside the begin helper:
  return {
    // these are placeholders until ready resolves
    get userCode() {
      return userCode;
    },
    get verificationUri() {
      return verificationUri;
    },
    get message() {
      return message;
    },
    get expiresAt() {
      return expiresAt;
    },
    result,
    cancel() {
      aborted = true;
    },
    // hidden helper for the caller to await initial code
    // (typed via a cast below where used)
    ...({ _ready: ready } as Record<string, unknown>),
  } as DeviceCodeBegin;
}

/** Await `_ready` so the user-code fields are populated. */
export async function awaitDeviceCodeReady(b: DeviceCodeBegin): Promise<void> {
  const r = (b as unknown as { _ready: Promise<void> })._ready;
  await r;
}

/**
 * Acquire a fresh access token for a stored account, refreshing silently from
 * the persisted MSAL cache. Returns the (possibly-updated) cache so the caller
 * can write it back to the store.
 */
export async function acquireAccessToken(
  tokens: SerializedTokens,
  scopes: string[] = DEFAULT_SCOPES,
  clientIdOverride?: string,
  tenantOverride?: string,
): Promise<{ accessToken: string; tokens: SerializedTokens }> {
  const pca = buildPca(tokens.msalCache, clientIdOverride, tenantOverride);
  const cache = pca.getTokenCache();
  const account =
    (await cache.getAccountByHomeId(tokens.homeAccountId)) ??
    (await cache.getAllAccounts()).find((a) => a.username === tokens.username);
  if (!account) {
    throw new Error("no MSAL account in cache — re-run add_account");
  }
  const res = await pca.acquireTokenSilent({ account, scopes });
  if (!res?.accessToken) {
    throw new Error("acquireTokenSilent returned no access token");
  }
  const next: SerializedTokens = {
    ...tokens,
    msalCache: cache.serialize(),
    scopes,
  };
  return { accessToken: res.accessToken, tokens: next };
}
