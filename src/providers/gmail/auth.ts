import { createHash, randomBytes, randomInt } from "node:crypto";

import { OAuth2Client } from "google-auth-library";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_OAUTH2_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
];

const DEFAULT_FLOW_TTL_MS = 20 * 60_000;

export interface AuthorizationCodeBegin {
  userCode: string;
  verificationUri: string;
  message: string;
  expiresAt: string; // ISO
  state: string;
  codeVerifier: string;
  redirectUri: string;
  scopes: string[];
  clientId: string;
  clientSecret?: string;
  cancel(): void;
}

export interface AuthorizationCodeCompletionInput {
  /** Full redirected URL copied from the browser after Google consent. */
  authorizationResponse?: string;
  /** Raw authorization code, for clients that extract it themselves. */
  code?: string;
  /** OAuth state returned alongside the raw authorization code. */
  state?: string;
}

export interface SerializedGmailTokens {
  /** Client ID used to authenticate this account. */
  clientId: string;
  /** Client secret, if any. */
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

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function randomBase64Url(bytes = 32): string {
  return base64Url(randomBytes(bytes));
}

function codeChallenge(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

function defaultRedirectUri(): string {
  // A loopback URI is valid for Google installed-app OAuth clients. Hypermail
  // does not need to receive the callback for remote/headless MCP use: the user
  // can copy the final redirected URL and pass it to complete_add_account.
  return `http://127.0.0.1:${randomInt(49152, 65536)}/oauth2callback`;
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
 * Start a Google OAuth 2.0 authorization-code flow for Gmail.
 *
 * Google rejects Gmail API scopes on the device-code endpoint, so Gmail uses a
 * browser URL plus manual completion. This works even when the MCP server is on
 * a VPS: users can approve the URL on any machine and paste the final redirected
 * URL back to the agent/client.
 */
export function beginAuthorizationCode(
  scopes: string[] = DEFAULT_SCOPES,
  clientIdOverride?: string,
  clientSecretOverride?: string,
): AuthorizationCodeBegin {
  const clientId = clientIdOverride;
  if (!clientId) {
    throw new Error(
      "HYPERMAIL_PROVIDERS_GMAIL_CLIENT_ID is required for Gmail OAuth — set it via HYPERMAIL_PROVIDERS_GMAIL_CLIENT_ID or provider config",
    );
  }

  const state = randomBase64Url(24);
  const codeVerifier = randomBase64Url(64);
  const redirectUri = defaultRedirectUri();
  const expiresAt = new Date(Date.now() + DEFAULT_FLOW_TTL_MS).toISOString();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: codeChallenge(codeVerifier),
    code_challenge_method: "S256",
  });

  const verificationUri = `${GOOGLE_AUTH_URL}?${params.toString()}`;
  return {
    userCode: "",
    verificationUri,
    message:
      "Open this URL in a browser to authorize Gmail access. After approval, " +
      "paste the final redirected URL back to the agent so it can complete the account setup.",
    expiresAt,
    state,
    codeVerifier,
    redirectUri,
    scopes,
    clientId,
    clientSecret: clientSecretOverride || undefined,
    cancel() {
      // Nothing asynchronous is running in the manual OAuth flow.
    },
  };
}

function parseAuthorizationCompletion(
  flow: AuthorizationCodeBegin,
  input: AuthorizationCodeCompletionInput,
): { code: string; state?: string } {
  if (input.authorizationResponse) {
    let url: URL;
    try {
      url = new URL(input.authorizationResponse);
    } catch {
      throw new Error("authorizationResponse must be a full redirected URL");
    }
    const error = url.searchParams.get("error");
    if (error) {
      const description = url.searchParams.get("error_description");
      throw new Error(
        `Google OAuth failed: ${description || error}`,
      );
    }
    const code = url.searchParams.get("code");
    if (!code) {
      throw new Error("authorizationResponse is missing the OAuth code");
    }
    return { code, state: url.searchParams.get("state") ?? undefined };
  }

  if (input.code) {
    return { code: input.code, state: input.state };
  }

  throw new Error(
    "Paste the final redirected URL from Google as authorizationResponse, or provide code and state",
  );
}

export async function completeAuthorizationCode(
  flow: AuthorizationCodeBegin,
  input: AuthorizationCodeCompletionInput,
): Promise<{ tokens: SerializedGmailTokens; email: string }> {
  const { code, state } = parseAuthorizationCompletion(flow, input);
  if (state !== undefined && state !== flow.state) {
    throw new Error("OAuth state mismatch — restart Gmail account setup");
  }

  const tokenParams = new URLSearchParams();
  tokenParams.set("client_id", flow.clientId);
  if (flow.clientSecret) tokenParams.set("client_secret", flow.clientSecret);
  tokenParams.set("code", code);
  tokenParams.set("redirect_uri", flow.redirectUri);
  tokenParams.set("grant_type", "authorization_code");
  tokenParams.set("code_verifier", flow.codeVerifier);

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenParams,
  });

  const tokenData = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(
      "Token request failed: " +
        (tokenData.error_description ?? tokenData.error ?? tokenRes.statusText),
    );
  }

  const email = await getEmailFromToken(tokenData.access_token);
  const tokens: SerializedGmailTokens = {
    clientId: flow.clientId,
    clientSecret: flow.clientSecret,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? "",
    expiryDate: tokenData.expires_in
      ? Date.now() + tokenData.expires_in * 1000
      : Date.now() + 3600_000,
    scopes: tokenData.scope ? tokenData.scope.split(" ") : flow.scopes,
    email,
  };
  return { tokens, email };
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
