import { describe, it, expect, vi, afterEach } from "vitest";

import {
  beginAuthorizationCode,
  completeAuthorizationCode,
} from "./auth.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Gmail authorization-code OAuth", () => {
  it("builds a Gmail OAuth URL with PKCE, state, and the Gmail modify scope", () => {
    const flow = beginAuthorizationCode(undefined, "client-id", "client-secret");
    const url = new URL(flow.verificationUri);

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.modify");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBe(flow.state);
    expect(url.searchParams.get("redirect_uri")).toBe(flow.redirectUri);
    expect(flow.userCode).toBe("");
    expect(flow.message).toContain("paste the final redirected URL");
  });

  it("exchanges a pasted redirect URL for tokens after validating state", async () => {
    const flow = beginAuthorizationCode(undefined, "client-id", "client-secret");
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === "https://oauth2.googleapis.com/token") {
        const body = init?.body as URLSearchParams;
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("client_id")).toBe("client-id");
        expect(body.get("client_secret")).toBe("client-secret");
        expect(body.get("code")).toBe("auth-code");
        expect(body.get("redirect_uri")).toBe(flow.redirectUri);
        expect(body.get("code_verifier")).toBe(flow.codeVerifier);
        return new Response(JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/gmail.modify",
        }), { status: 200 });
      }
      if (href === "https://gmail.googleapis.com/gmail/v1/users/me/profile") {
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer access-token");
        return new Response(JSON.stringify({ emailAddress: "User@Gmail.com" }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const redirectUrl = `${flow.redirectUri}?code=auth-code&state=${flow.state}`;
    const result = await completeAuthorizationCode(flow, { authorizationResponse: redirectUrl });

    expect(result.email).toBe("User@Gmail.com");
    expect(result.tokens.clientId).toBe("client-id");
    expect(result.tokens.clientSecret).toBe("client-secret");
    expect(result.tokens.accessToken).toBe("access-token");
    expect(result.tokens.refreshToken).toBe("refresh-token");
    expect(result.tokens.scopes).toEqual(["https://www.googleapis.com/auth/gmail.modify"]);
  });

  it("rejects pasted redirect URLs with a mismatched state", async () => {
    const flow = beginAuthorizationCode(undefined, "client-id");

    await expect(
      completeAuthorizationCode(flow, {
        authorizationResponse: `${flow.redirectUri}?code=auth-code&state=wrong-state`,
      }),
    ).rejects.toThrow("OAuth state mismatch");
  });
});
