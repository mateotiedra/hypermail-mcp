import { OAuth2Client } from "google-auth-library";

const GOOGLE_DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_OAUTH2_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
];

export interface DeviceCodeBegin {
  userCode: string;
  verificationUri: string;
  message: string;
  expiresAt: string; // ISO
  /** Resolves with the tokens and email once the user completes the flow. */
  result: Promise<{ tokens: SerializedGmailTokens; email: string }>;
  /** Aborts the in-flight polling promise. */
  cancel(): void;
}

export interface SerializedGmailTokens {
  /** Client ID used to authenticate this account. */
  clientId: string;
  /** Client secret, if any (optional for installed/TV apps). */
  clientSecret?: string;
  /** Current access token. */
  accessToken: string;
  /** Long-lived refresh token. */
  refreshToken: string;
  /** Expiry timestamp in milliseconds since epoch. */
  expiryDate: number;
  /** Scopes granted. */
  scopes: string[];
  /** Email address associated with this account. */
  email: string;
}

/** Type guard — validates that an unknown value has the shape of SerializedGmailTokens. */
export function isSerializedGmailTokens(
  obj: unknown,
): obj is SerializedGmailTokens {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.clientId === "string" &&
    (o.clientSecret === undefined || typeof o.clientSecret === "string") &&
    typeof o.accessToken === "string" &&
    typeof o.refreshToken === "string" &&
    typeof o.expiryDate === "number" &&
    Array.isArray(o.scopes) &&
    typeof o.email === "string"
  );
}

/**
 * Build an {@link OAuth2Client} hydrated with stored tokens.
 * Returns a fresh client that can be used for silent refresh.
 */
export function buildOAuth2Client(
  tokens?: SerializedGmailTokens,
): OAuth2Client {
  const client = new OAuth2Client({
    clientId: tokens?.clientId,
    clientSecret: tokens?.clientSecret,
  });
  if (tokens) {
    client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiryDate,
      scope: tokens.scopes.join(" "),
    });
  }
  return client;
}

/** Fetch the email address associated with an access token via the Gmail profile endpoint. */
async function getEmailFromToken(accessToken: string): Promise<string> {
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Failed to get Gmail profile (${res.status}): ${body}`,
    );
  }
  const data = (await res.json()) as { emailAddress: string };
  return data.emailAddress;
}

/**
 * Start a Google OAuth 2.0 device-authorisation flow.
 *
 * The returned `result` promise resolves once the user has entered the code
 * and consented; callers should poll it (or await it) via `complete_add_account`.
 */
export function beginDeviceCode(
  scopes: string[] = DEFAULT_SCOPES,
  clientIdOverride?: string,
  clientSecretOverride?: string,
): DeviceCodeBegin {
  const clientId = clientIdOverride || process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "GOOGLE_CLIENT_ID is required for Gmail OAuth — set it in env or provider config",
    );
  }
  const clientSecret =
    clientSecretOverride || process.env.GOOGLE_CLIENT_SECRET || undefined;

  let resolve!: (v: { tokens: SerializedGmailTokens; email: string }) => void;
  let reject!: (err: unknown) => void;
  const result = new Promise<{ tokens: SerializedGmailTokens; email: string }>(
    (res, rej) => {
      resolve = res;
      reject = rej;
    },
  );

  // Placeholders populated once the device-code HTTP call completes.
  let userCode = "";
  let verificationUri = "";
  let message = "";
  let expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  let aborted = false;

  const ready = (async () => {
    try {
      // ── Step 1: request device code ──
      const dcParams = new URLSearchParams();
      dcParams.set("client_id", clientId);
      if (clientSecret) dcParams.set("client_secret", clientSecret);
      dcParams.set("scope", scopes.join(" "));

      const dcRes = await fetch(GOOGLE_DEVICE_CODE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: dcParams.toString(),
      });

      if (!dcRes.ok) {
        const errBody = (await dcRes.json().catch(() => ({}))) as {
          error?: string;
          error_description?: string;
        };
        throw new Error(
          `Google device-code request failed: ` +
            `${errBody.error_description ?? errBody.error ?? dcRes.statusText}`,
        );
      }

      const dcData = (await dcRes.json()) as {
        device_code: string;
        user_code: string;
        verification_url: string;
        expires_in: number;
        interval?: number;
      };

      userCode = dcData.user_code;
      verificationUri = dcData.verification_url;
      const deviceCode = dcData.device_code;
      let interval = dcData.interval ?? 5;
      if (dcData.expires_in) {
        expiresAt = new Date(
          Date.now() + dcData.expires_in * 1000,
        ).toISOString();
      }
      message = `Go to ${verificationUri} and enter code: ${userCode}`;

      // ── Step 2: poll for tokens ──
      const tokenParams = new URLSearchParams();
      tokenParams.set("client_id", clientId);
      if (clientSecret) tokenParams.set("client_secret", clientSecret);
      tokenParams.set("device_code", deviceCode);
      tokenParams.set(
        "grant_type",
        "urn:ietf:params:oauth:grant-type:device_code",
      );

      const deadline = Date.now() + (dcData.expires_in * 1000);
      while (Date.now() < deadline && !aborted) {
        await new Promise((r) => setTimeout(r, interval * 1000));
        if (aborted) return;

        const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: tokenParams.toString(),
        });

        const tokenData = (await tokenRes.json()) as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
          scope?: string;
          error?: string;
        };

        if (tokenData.access_token) {
          const email = await getEmailFromToken(tokenData.access_token);
          const tokens: SerializedGmailTokens = {
            clientId,
            clientSecret,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token ?? "",
            expiryDate: tokenData.expires_in
              ? Date.now() + tokenData.expires_in * 1000
              : Date.now() + 3600_000,
            scopes: tokenData.scope
              ? tokenData.scope.split(" ")
              : scopes,
            email,
          };
          resolve({ tokens, email });
          return;
        }

        switch (tokenData.error) {
          case "authorization_pending":
            break; // keep polling
          case "slow_down":
            interval += 1; // Google says to back off
            break;
          case "expired_token":
            throw new Error("Device code expired — please try again");
          case "access_denied":
            throw new Error("User denied access");
          default:
            throw new Error(
              `Token request failed: ${tokenData.error ?? "unknown error"}`,
            );
        }
      }

      if (!aborted) {
        throw new Error("Device code expired — please try again");
      }
    } catch (err) {
      if (!aborted) reject(err);
    }
  })();

  return {
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
 * the persisted refresh token. Returns the (possibly-updated) tokens so the
 * caller can write them back to the store.
 */
export async function acquireAccessToken(
  tokens: SerializedGmailTokens,
  scopes: string[] = DEFAULT_SCOPES,
): Promise<{ accessToken: string; tokens: SerializedGmailTokens }> {
  const client = buildOAuth2Client(tokens);
  const res = await client.getAccessToken();
  if (!res.token) {
    throw new Error(
      "Failed to acquire access token — refresh token may be revoked; re-run add_account",
    );
  }

  const creds = client.credentials;
  const next: SerializedGmailTokens = {
    ...tokens,
    accessToken: res.token,
    refreshToken: creds.refresh_token ?? tokens.refreshToken,
    expiryDate: creds.expiry_date ?? Date.now() + 3600_000,
    scopes,
  };
  return { accessToken: res.token, tokens: next };
}

/**
 * Revoke a refresh token so the stored account is fully de-authorized.
 * Best-effort — failures are swallowed since we'll delete the stored tokens
 * regardless.
 */
export async function revokeRefreshToken(
  tokens: SerializedGmailTokens,
): Promise<void> {
  try {
    await fetch(GOOGLE_OAUTH2_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refreshToken }).toString(),
    });
  } catch {
    /* best-effort */
  }
}
